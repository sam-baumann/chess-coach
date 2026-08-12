import { useEffect, useState } from "react";

/**
 * The evaluation trace is produced by the game-review skill's eval_trace.py.
 * It is a *diverging* chart — two fills either side of the midline, light above
 * for White, dark below for Black — not an area chart; one flat fill for both
 * sides erases the encoding. Reusing the script keeps that decision in one place.
 *
 * `marks` are "ply:glyph" pairs, e.g. ["13:?", "39:??"]. Severity rides on the
 * glyph as well as the colour, so the marks stay legible without colour vision.
 */
export function EvalTrace({ gameId, marks = [] }: { gameId: string; marks?: string[] }) {
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
        if (!res.ok) throw new Error("No sweep yet — run one to see the evaluation trace.");
        return res.text();
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
  return <div className="chart-box" dangerouslySetInnerHTML={{ __html: svg }} />;
}
