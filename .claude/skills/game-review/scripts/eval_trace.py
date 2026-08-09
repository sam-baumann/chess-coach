#!/usr/bin/env python3
"""Build the diverging evaluation-trace SVG for a game review.

    uv run python eval_trace.py scan.json --mark 13:?,39:??  > trace.svg

Importable:  from eval_trace import trace_svg

Encoding rules this follows, and why:

* The eval is a POLARITY, not a magnitude — it favours White or Black around a
  neutral zero. So it is a diverging chart: two fills either side of a midline,
  never one flat area. Above the line is filled light (White better), below is
  filled dark (Black better), which is the same convention as the eval bar every
  chess site uses. Using ONE fill colour for both sides destroys the encoding.
* Severity markers carry a `?` / `??` glyph, so the mistake/blunder distinction
  never rides on colour alone. Their colours must also survive colour-blind
  simulation — the pair shipped in template.html was validated at ΔE 25 (deutan).
* Evals are clamped to ±6.00. Beyond that the game is decided and extra range
  only flattens the part of the curve a reader cares about.
"""
import argparse, html, json

W, H, LIMIT = 1000, 200, 600
MID = H / 2


def _x(i, n):
    return W * i / (n - 1) if n > 1 else 0


def _y(cp):
    return MID - (max(-LIMIT, min(LIMIT, cp)) / LIMIT) * (MID - 8)


def trace_svg(rows, marks=None, aria=""):
    """rows: scan_game.py rows. marks: {ply: "?"|"??"}. Returns an SVG string."""
    marks = marks or {}
    n = len(rows)
    if n < 2:
        raise ValueError("need at least two plies to draw a trace")

    pts = [(_x(i, n), _y(r["wcp_after"]), r) for i, r in enumerate(rows)]
    line = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{y:.1f}"
                    for i, (x, y, _) in enumerate(pts))
    area = (f"M0,{MID} " + " ".join(f"L{x:.1f},{y:.1f}" for x, y, _ in pts)
            + f" L{W},{MID} Z")

    markers = []
    for x, y, r in pts:
        glyph = marks.get(r["ply"])
        if not glyph:
            continue
        sev = "blunder" if glyph.strip() == "??" else "mistake"
        # Keep the label off the stem, and inside the viewBox.
        ly = y + 19 if y > MID else y - 12
        if ly > H - 5:
            ly = y - 12
        markers.append(
            f'<g class="mk {sev}">'
            f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x:.1f}" y2="{MID}"/>'
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5"/>'
            f'<text x="{x:.1f}" y="{ly:.1f}">{html.escape(glyph)}</text></g>')

    band = W / (n - 1)
    hover = "".join(
        f'<rect class="hz" x="{_x(i, n) - band / 2:.1f}" y="0" '
        f'width="{band:.1f}" height="{H}" '
        f'data-mv="{r["movenum"]}{"." if r["color"] == "W" else "…"}'
        f'{html.escape(r["san"])}" data-ev="{r["wcp_after"] / 100:+.2f}" '
        f'data-x="{_x(i, n):.1f}" data-y="{_y(r["wcp_after"]):.1f}"/>'
        for i, (_, _, r) in enumerate(pts))

    return f"""<svg id="trace" class="trace" viewBox="0 0 {W} {H}"
     preserveAspectRatio="none" role="img" aria-label="{html.escape(aria)}">
  <defs>
    <clipPath id="above"><rect x="0" y="0" width="{W}" height="{MID}"/></clipPath>
    <clipPath id="below"><rect x="0" y="{MID}" width="{W}" height="{MID}"/></clipPath>
  </defs>
  <path class="area-w" d="{area}" clip-path="url(#above)"/>
  <path class="area-b" d="{area}" clip-path="url(#below)"/>
  <line class="mid" x1="0" y1="{MID}" x2="{W}" y2="{MID}"/>
  <path class="tline" d="{line}"/>
  {''.join(markers)}
  <line id="cross" x1="0" y1="0" x2="0" y2="{H}"/>
  <circle id="dot" r="4.5" cx="0" cy="0"/>
  <text class="axis" x="6" y="15">White better</text>
  <text class="axis" x="6" y="{H - 7}">Black better</text>
  {hover}
</svg>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scan", help="JSON from scan_game.py")
    ap.add_argument("--mark", default="",
                    help='comma-separated ply:glyph pairs, e.g. "13:?,39:??"')
    ap.add_argument("--aria", default="", help="aria-label describing the shape")
    args = ap.parse_args()

    rows = json.load(open(args.scan))["rows"]
    marks = {}
    for part in filter(None, (p.strip() for p in args.mark.split(","))):
        ply, _, glyph = part.partition(":")
        marks[int(ply)] = glyph or "?"
    print(trace_svg(rows, marks, args.aria))


if __name__ == "__main__":
    main()
