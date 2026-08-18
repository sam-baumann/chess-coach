import { useEffect, useState } from "react";
import { describeEval, formatEval } from "../evalscore.ts";

/**
 * The evaluation trace is produced by the game-review skill's eval_trace.py.
 * It is a *diverging* chart — two fills either side of the midline, light above
 * for White, dark below for Black — not an area chart; one flat fill for both
 * sides erases the encoding. Reusing the script keeps that decision in one place.
 *
 * `marks` are "ply:glyph" pairs, e.g. ["13:?", "39:??"]. Severity rides on the
 * glyph as well as the colour, so the marks stay legible without colour vision.
 *
 * The playhead is drawn over the SVG rather than inside it. eval_trace.py is
 * shared with the published pages, which have no current ply — and the trace is
 * emitted with preserveAspectRatio="none" against a 0..W viewBox, so a plain
 * percentage lands exactly where the engine's own x for that ply lands.
 */
export function EvalTrace({
  gameId,
  marks = [],
  ply,
  plyCount,
  wcp,
}: {
  gameId: string;
  marks?: string[];
  /** Board index to mark, 0 being the starting position. */
  ply?: number;
  /** Number of scanned plies — the trace's last x. */
  plyCount?: number;
  /** Centipawns at `ply`, White's point of view, for the corner readout. */
  wcp?: number | null;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      mark: marks.join(","),
      aria: "Evaluation through the game, White above the midline and Black below",
    });

    fetch(`/api/games/${gameId}/trace.svg?${params}`)
      .then(async (res) => {
        if (res.ok) return res.text();
        // Only a 404 means "no sweep". Anything else is a real failure — most
        // likely eval_trace.py refusing a game too short to draw — and telling
        // the user to run a sweep they've already run isn't actionable.
        if (res.status === 404) {
          throw new Error("No sweep yet — run one to see the evaluation trace.");
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The trace could not be drawn (${res.status}).`);
      })
      .then((text) => {
        if (!cancelled) {
          setSvg(text);
          setError(null);
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [gameId, marks.join(",")]);

  if (error) return <p className="muted">{error}</p>;
  if (!svg) return <p className="muted">Loading trace…</p>;

  // Row i of the scan sits at x = W·i/(n-1), and row i is the position after
  // ply i+1 — so ply p is row p-1. Ply 0 is the start, which has no row of its
  // own and pins to the left edge.
  const head =
    ply != null && plyCount != null && plyCount > 1
      ? Math.min(100, Math.max(0, ((Math.max(1, ply) - 1) / (plyCount - 1)) * 100))
      : null;

  // The chart says which way the game is going; the number says by how much.
  // Reading a magnitude off a clamped ±6.00 curve is guesswork, and it is the
  // figure the coach quotes in the chat — so it belongs on screen, not inferred.
  const score = formatEval(wcp);

  return (
    <div className="chart-box">
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {head != null && <span className="playhead" style={{ left: `${head}%` }} aria-hidden="true" />}
      {score !== null && (
        <output className="eval-readout" title={describeEval(wcp)}>
          {score}
        </output>
      )}
    </div>
  );
}
