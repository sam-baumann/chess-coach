import { useEffect, useState } from "react";

/**
 * The diagram markup comes from the game-review skill's render_board.py, fetched
 * as HTML and injected. Reimplementing it in JSX would mean re-deriving two
 * things it already documents and gets right: both colours use the solid Unicode
 * glyph set tinted by CSS (outline glyphs render faintly and inconsistently
 * across system fonts), and a square is dark when row+col is odd with rank 8 as
 * row 0. The styling lives in theme.css, lifted from the same template.
 *
 * The HTML is a fixed grid of divs and spans generated from a FEN by a script we
 * control, so injecting it is safe here.
 */
export function Board({
  fen,
  highlight = [],
  flip = false,
  caption = "",
}: {
  fen: string;
  highlight?: string[];
  flip?: boolean;
  caption?: string;
}) {
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ fen, highlight: highlight.join(","), caption });
    if (flip) params.set("flip", "true");

    fetch(`/api/diagram?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`diagram failed (${res.status})`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setHtml(text);
          setError(null);
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
    // highlight is an array literal at most call sites; key on its content.
  }, [fen, flip, caption, highlight.join(",")]);

  if (error) return <p className="err">{error}</p>;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
