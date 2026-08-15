import { useEffect, useState } from "react";
import type { Game, SweepEvent } from "@shared/events.ts";
import { api, streamSweeps, type Health } from "../api.ts";

function resultBadge(game: Game): { label: string; cls: string } {
  if (!game.winner) return { label: "draw", cls: "draw" };
  if (!game.userColor) return { label: `${game.winner} won`, cls: "draw" };
  return game.winner === game.userColor
    ? { label: "win", cls: "win" }
    : { label: "loss", cls: "loss" };
}

function SweepCell({ game, onSweep }: { game: Game; onSweep: (id: string) => void }) {
  const s = game.sweep;
  if (!s || s.status === "queued") {
    return (
      <button
        className="btn ghost"
        onClick={(e) => {
          e.stopPropagation();
          onSweep(game.id);
        }}
      >
        sweep
      </button>
    );
  }
  if (s.status === "running") {
    return (
      <div className="bar" title={`${Math.round(s.progress * 100)}%`}>
        <i style={{ width: `${Math.max(3, s.progress * 100)}%` }} />
      </div>
    );
  }
  if (s.status === "failed") return <span className="badge failed">failed</span>;
  return <span className="badge done">swept</span>;
}

export function GamesList({
  health,
  onOpen,
}: {
  health: Health | null;
  onOpen: (gameId: string) => void;
}) {
  const [games, setGames] = useState<Game[]>([]);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; help?: string } | null>(null);

  useEffect(() => {
    void api.games().then((r) => setGames(r.games));
  }, []);

  useEffect(() => {
    if (health?.username) setUsername(health.username);
  }, [health?.username]);

  // Sweeps run for minutes in a child process; this keeps the badges live
  // without polling.
  useEffect(() => {
    const stop = streamSweeps((e: SweepEvent) => {
      setGames((prev) =>
        prev.map((g) => {
          if (g.id !== ("gameId" in e ? e.gameId : "")) return g;
          if (e.type === "sweep_progress") {
            return { ...g, sweep: { ...(g.sweep ?? blankSweep(g.id)), status: "running", progress: e.progress } };
          }
          if (e.type === "sweep_done") {
            return { ...g, sweep: { ...(g.sweep ?? blankSweep(g.id)), status: "done", progress: 1 } };
          }
          return { ...g, sweep: { ...(g.sweep ?? blankSweep(g.id)), status: "failed", error: e.error } };
        }),
      );
    });
    return stop;
  }, []);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.refresh(username || undefined);
      setGames(r.games);
    } catch (err) {
      const e = err as Error & { help?: string };
      setError({ message: e.message, help: e.help });
    } finally {
      setBusy(false);
    }
  }

  async function sweep(id: string) {
    setError(null);
    try {
      // "already-done" comes back as a 200. Showing a progress bar for it leaves
      // the row stuck at 0% forever — nothing is running to emit further events.
      const { status } = await api.startSweep(id);
      const sweep: NonNullable<Game["sweep"]> =
        status === "already-done"
          ? { ...blankSweep(id), status: "done", progress: 1 }
          : { ...blankSweep(id), status: "running" };
      setGames((prev) => prev.map((g) => (g.id === id ? { ...g, sweep } : g)));
    } catch (err) {
      setError({ message: (err as Error).message });
    }
  }

  return (
    <section>
      <div className="toolbar">
        <input
          type="text"
          value={username}
          placeholder="lichess username"
          onChange={(e) => setUsername(e.target.value)}
          aria-label="Lichess username"
        />
        <button className="btn" onClick={() => void refresh()} disabled={busy}>
          {busy ? "fetching…" : "fetch recent games"}
        </button>
        {health && !health.hasStockfish && (
          <span className="muted">Stockfish not on PATH — sweeps will fail</span>
        )}
      </div>

      {error && (
        <div className="card notice" style={{ marginBottom: 18 }}>
          <strong className="err">{error.message}</strong>
          {error.help && <pre>{error.help}</pre>}
        </div>
      )}

      {games.length === 0 ? (
        <p className="muted">
          No games yet. Enter your Lichess username above and fetch — the hub pulls your recent
          games and keeps them alongside the coach&rsquo;s notes.
        </p>
      ) : (
        <table className="games">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Opening</th>
              <th>Result</th>
              <th>Time</th>
              <th>Engine</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const badge = resultBadge(g);
              const opponent =
                g.userColor === "white" ? g.black : g.userColor === "black" ? g.white : `${g.white} / ${g.black}`;
              // Null userColor means neither player is the hub's user, so there
              // is no "opponent" rating to show — the cell names both players.
              const oppRating =
                g.userColor === "white" ? g.blackRating : g.userColor === "black" ? g.whiteRating : null;
              return (
                <tr key={g.id} onClick={() => onOpen(g.id)}>
                  <td className="num">{new Date(g.playedAt).toLocaleDateString()}</td>
                  <td>
                    {opponent} {oppRating != null && <span className="num">({oppRating})</span>}
                  </td>
                  <td className="opening">{g.opening ?? "—"}</td>
                  <td>
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="num">{g.speed}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <SweepCell game={g} onSweep={(id) => void sweep(id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function blankSweep(gameId: string): NonNullable<Game["sweep"]> {
  return { gameId, depth: 18, status: "queued", progress: 0, error: null };
}
