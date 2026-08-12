import { useEffect, useMemo, useState } from "react";
import type { Game, ReviewSession } from "@shared/events.ts";
import { api, streamSweeps } from "../api.ts";
import { Board } from "./Board.tsx";
import { ChatPane } from "./ChatPane.tsx";
import { EvalTrace } from "./EvalTrace.tsx";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function ReviewView({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [fens, setFens] = useState<string[]>([]);
  const [ply, setPly] = useState(0);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sweepProgress, setSweepProgress] = useState<number | null>(null);

  const load = useMemo(
    () => async () => {
      const r = await api.game(gameId);
      setGame(r.game);
      setFens(r.scan ? [START_FEN, ...r.scan.rows.map((row) => row.fen_after)] : []);
      setSession(r.sessions[0] ?? null);
    },
    [gameId],
  );

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);

  // A sweep started from the games list may still be running when the review is
  // opened; reload the positions once it lands.
  useEffect(() => {
    return streamSweeps((e) => {
      if (!("gameId" in e) || e.gameId !== gameId) return;
      if (e.type === "sweep_progress") setSweepProgress(e.progress);
      if (e.type === "sweep_done") {
        setSweepProgress(null);
        void load();
      }
      if (e.type === "sweep_failed") {
        setSweepProgress(null);
        setError(e.error);
      }
    });
  }, [gameId, load]);

  async function startReview() {
    setError(null);
    try {
      const r = await api.createReview(gameId);
      setSession(r.session);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!game) return <p className="muted">{error ?? "Loading…"}</p>;

  const swept = game.sweep?.status === "done";
  const moves = game.moves.split(" ").filter(Boolean);
  const currentFen = fens[ply] ?? START_FEN;

  return (
    <section>
      <div className="toolbar">
        <button className="btn ghost" onClick={onBack}>
          ← games
        </button>
        <strong>
          {game.white} vs {game.black}
        </strong>
        <span className="muted">
          {game.opening ?? "unknown opening"} · {game.speed} ·{" "}
          {game.winner ? `${game.winner} won` : "draw"}
        </span>
        <a
          className="mono"
          style={{ fontSize: 12, color: "var(--accent)" }}
          href={`https://lichess.org/${game.id}`}
          target="_blank"
          rel="noreferrer"
        >
          lichess.org/{game.id}
        </a>
      </div>

      {error && <div className="card notice" style={{ marginBottom: 18 }}>{error}</div>}

      <div className="review">
        <div>
          <Board fen={currentFen} caption={`Position after ${ply} plies`} flip={game.userColor === "black"} />

          {swept ? (
            <>
              <div className="toolbar" style={{ marginTop: 14 }}>
                <button className="btn ghost" onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0}>
                  ‹
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, fens.length - 1)}
                  value={ply}
                  onChange={(e) => setPly(Number(e.target.value))}
                  style={{ flex: 1 }}
                  aria-label="Ply"
                />
                <button
                  className="btn ghost"
                  onClick={() => setPly((p) => Math.min(fens.length - 1, p + 1))}
                  disabled={ply >= fens.length - 1}
                >
                  ›
                </button>
                <span className="num">
                  {ply === 0 ? "start" : `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."} ${moves[ply - 1] ?? ""}`}
                </span>
              </div>

              <h2 style={{ marginTop: 26 }}>Evaluation</h2>
              <EvalTrace gameId={gameId} />
            </>
          ) : (
            <div className="card" style={{ marginTop: 16 }}>
              {sweepProgress != null ? (
                <>
                  <p className="muted" style={{ margin: "0 0 10px" }}>
                    Sweeping the game at depth 18 — {Math.round(sweepProgress * 100)}%
                  </p>
                  <div className="bar" style={{ width: "100%" }}>
                    <i style={{ width: `${sweepProgress * 100}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <p className="muted" style={{ margin: "0 0 12px" }}>
                    No engine sweep yet. The sweep ranks every move by centipawn loss so the
                    critical moments are found rather than guessed at — it takes a few minutes.
                  </p>
                  <button className="btn" onClick={() => void api.startSweep(gameId).catch((e: Error) => setError(e.message))}>
                    run the sweep
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          {session ? (
            <ChatPane session={session} />
          ) : (
            <div className="card">
              <h2>Review</h2>
              <p className="muted">
                Start a review and the coach walks the game with you — critical moments first, and
                a question before the engine line.
              </p>
              <button className="btn" onClick={() => void startReview()}>
                start the review
              </button>
              {!swept && (
                <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                  Running the sweep first gives the coach the whole-game trace to work from.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
