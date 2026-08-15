import { useEffect, useMemo, useState } from "react";
import type { Game, ReviewSession } from "@shared/events.ts";
import { api, streamSweeps } from "../api.ts";
import { plyLabel } from "../ply.ts";
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
        // Caught: these reloads fire exactly when a server restart is likely, and
        // an unhandled rejection would leave the pre-sweep card on screen for a
        // game that just finished, with nothing telling the user to reload.
        void load().catch((err: Error) => setError(err.message));
      }
      if (e.type === "sweep_failed") {
        setSweepProgress(null);
        setError(e.error);
        // Reload too: `running` falls back to game.sweep.progress, so without a
        // refresh the panel keeps showing a frozen bar at the last percentage
        // and the retry button stays unreachable.
        void load().catch(() => {
          /* the sweep error above is the more useful message */
        });
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

  // A sweep already running when this view opened emits nothing until its next
  // progress tick, so fall back to the status the server returned with the game —
  // otherwise the panel claims "No engine sweep yet" while one is underway.
  const running =
    sweepProgress ?? (game.sweep?.status === "running" ? game.sweep.progress : null);

  // Keyed on the scan actually being there, not on the last run's status. A failed
  // re-sweep leaves the *previous* scan intact on disk (sweep.ts writes to a
  // .partial file and renames only on success) — gating on status === "done"
  // would hide a board and trace the server is still happily serving.
  const swept = fens.length > 1;
  const moves = game.moves.split(" ").filter(Boolean);
  const currentFen = fens[ply] ?? START_FEN;

  return (
    <section className="review-page">
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
        <div className="board-col">
          <Board fen={currentFen} caption={`Position after ${ply} plies`} flip={game.userColor === "black"} />

          {swept ? (
            <>
              {/* The scan below is the previous one; say so rather than letting a
                  failed re-sweep look like it succeeded. */}
              {game.sweep?.status === "failed" && (
                <p className="err" style={{ margin: "12px 0 0", fontSize: 13 }}>
                  The last sweep failed — showing the previous one.{" "}
                  <button
                    className="btn ghost"
                    onClick={() =>
                      void api
                        .startSweep(gameId, true)
                        .then(() => setSweepProgress(0))
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    retry
                  </button>
                </p>
              )}
              <div className="ply-nav">
                <button className="btn ghost" onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0}>
                  ‹
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, fens.length - 1)}
                  value={ply}
                  onChange={(e) => setPly(Number(e.target.value))}
                  aria-label="Ply"
                />
                <button
                  className="btn ghost"
                  onClick={() => setPly((p) => Math.min(fens.length - 1, p + 1))}
                  disabled={ply >= fens.length - 1}
                >
                  ›
                </button>
                {/* Fixed-width in CSS — see .ply-nav .num. */}
                <span className="num" title={plyLabel(ply, moves)}>
                  {plyLabel(ply, moves)}
                </span>
              </div>

              <h2 style={{ marginTop: 26 }}>Evaluation</h2>
              <EvalTrace gameId={gameId} ply={ply} plyCount={fens.length - 1} />
            </>
          ) : (
            <div className="card" style={{ marginTop: 16 }}>
              {running != null ? (
                <>
                  <p className="muted" style={{ margin: "0 0 10px" }}>
                    Sweeping the game at depth {game.sweep?.depth ?? 18} — {Math.round(running * 100)}%
                  </p>
                  <div className="bar" style={{ width: "100%" }}>
                    <i style={{ width: `${Math.max(3, running * 100)}%` }} />
                  </div>
                </>
              ) : (
                <>
                  {game.sweep?.status === "failed" && (
                    <p className="err" style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
                      The last sweep failed. {game.sweep.error}
                    </p>
                  )}
                  <p className="muted" style={{ margin: "0 0 12px" }}>
                    No engine sweep yet. The sweep ranks every move by centipawn loss so the
                    critical moments are found rather than guessed at — it takes a few minutes.
                  </p>
                  <button
                    className="btn"
                    onClick={() =>
                      void api
                        .startSweep(gameId, game.sweep?.status === "failed")
                        .then(() => setSweepProgress(0))
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    {game.sweep?.status === "failed" ? "retry the sweep" : "run the sweep"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="chat-col">
          {session ? (
            <ChatPane
              session={session}
              moves={moves}
              fens={fens}
              userColor={game.userColor}
              onJump={setPly}
            />
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
