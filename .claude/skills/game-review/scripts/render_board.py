#!/usr/bin/env python3
"""Render a FEN as a self-contained HTML chess diagram (no images, no JS).

    uv run python render_board.py "<FEN>" --highlight f2,g1 --flip

Importable too:  from render_board import board_html

The board is an 8x8 CSS grid of Unicode glyphs, styled by the `.board` rules in
template.html. Two things here are easy to get wrong:

1. Both colours use the SOLID glyph set (♚♛♜♝♞♟) tinted via CSS, never the
   outline set (♔♕♖). Outline glyphs render too faintly on a light square and
   their shapes vary wildly between system fonts.
2. a8 is a light square and a1 is dark. With rank 8 as row 0, that means a
   square is dark when (row + col) is odd.
"""
import argparse

SOLID = {"k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♟"}
FILES = "abcdefgh"


def board_html(fen, highlight=(), flip=False, caption=""):
    """FEN (or just its placement field) -> a <div class="board"> string."""
    rows = fen.split()[0].split("/")
    if len(rows) != 8:
        raise ValueError(f"expected 8 ranks in FEN placement, got {len(rows)}")

    grid = []
    for row in rows:
        cells = []
        for ch in row:
            if ch.isdigit():
                cells.extend([None] * int(ch))
            else:
                cells.append(ch)
        if len(cells) != 8:
            raise ValueError(f"rank '{row}' expands to {len(cells)} squares, not 8")
        grid.append(cells)

    if flip:
        grid = [list(reversed(r)) for r in reversed(grid)]

    highlight = set(highlight)
    out = [f'<div class="board" role="img" aria-label="{caption or "chess position"}">']
    for r in range(8):
        for c in range(8):
            rank = (r + 1) if flip else (8 - r)
            file_ = FILES[7 - c] if flip else FILES[c]
            square = f"{file_}{rank}"
            classes = "sq " + ("d" if (r + c) % 2 else "l")
            if square in highlight:
                classes += " hl"
            piece = grid[r][c]
            if piece:
                side = "w" if piece.isupper() else "b"
                inner = f'<span class="pc {side}">{SOLID[piece.lower()]}</span>'
            else:
                inner = ""
            out.append(f'<div class="{classes}" data-sq="{square}">{inner}</div>')
    out.append("</div>")
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fen")
    ap.add_argument("--highlight", default="", help="comma-separated squares, e.g. f2,g1")
    ap.add_argument("--flip", action="store_true", help="view from Black's side")
    ap.add_argument("--caption", default="", help="aria-label for the diagram")
    args = ap.parse_args()
    squares = [s.strip() for s in args.highlight.split(",") if s.strip()]
    print(board_html(args.fen, squares, args.flip, args.caption))


if __name__ == "__main__":
    main()
