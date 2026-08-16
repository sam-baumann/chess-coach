#!/usr/bin/env python3
"""Replay a variation — a line the game did NOT play — into positions.

The engine's recommendation arrives as notation ("13...Rd8 14.Qxd8 Rxd8"), which
is exactly the form a reader cannot see. This turns it into the positions it
means, so each half-move can be put on a board.

    uv run --with chess python replay_line.py \
        --moves "e4 e5 Nf3 ..." --line "13... Rd8 14. Qxd8 Rxd8"

Emits JSON on stdout: the branch point, then one step per half-move with its
SAN, UCI, label and FEN.

Where the line branches from is read off the FIRST move's number — "13..." means
the position after White's 13th, which is the only reading that makes the line an
alternative to what was actually played. Pass --from-ply (or --from-fen) instead
when the notation carries no number.

Importable:  from replay_line import replay_line
"""
import argparse, json, re, sys

import chess

# Move-number prefixes: "13.", "13...", "13…". Either may be glued to the move
# ("13...Rd8") or stand alone as its own token, and engines print both.
PREFIX = re.compile(r"^(\d{1,3})\s*(\.{3}|…|\.)\s*")
# "!", "?", "!?", "?!" are commentary. "+" and "#" are part of the SAN and stay.
SUFFIX = re.compile(r"[!?]+[,;]?$|[,;]$")


class LineError(ValueError):
    """A variation that cannot be replayed — reported to the caller, not raised past it."""


def parse_line(text):
    """('13... Rd8 14.Qxd8') -> (start_ply, ['Rd8', 'Qxd8']).

    start_ply is the board index the line branches from: 0 is the initial
    position, N is the position after N half-moves. It is None when the notation
    carries no move number.
    """
    start_ply, sans = None, []
    for raw in text.replace("…", "...").split():
        token = raw
        m = PREFIX.match(token)
        while m:
            if start_ply is None and not sans:
                number, dots = int(m.group(1)), m.group(2)
                black = dots != "."
                # Move N for White is board index 2N-1; the position *before* it
                # is 2N-2. For Black, one further on.
                start_ply = (number - 1) * 2 + (1 if black else 0)
            token = token[m.end():]
            m = PREFIX.match(token)
        token = SUFFIX.sub("", token).strip()
        if token:
            sans.append(token)
    if not sans:
        raise LineError("no moves in the line")
    return start_ply, sans


def replay_line(game_moves, line, from_ply=None, from_fen=None, limit=12):
    """Replay `line` from a position in `game_moves`. Returns the JSON payload."""
    parsed_ply, sans = parse_line(line)
    truncated = len(sans) > limit
    sans = sans[:limit]

    if from_fen:
        board = chess.Board(from_fen)
        start_ply = from_ply
    else:
        start_ply = from_ply if from_ply is not None else parsed_ply
        if start_ply is None:
            raise LineError(
                "the first move needs its move number, e.g. '13... Rd8', so the "
                "line can be placed in the game"
            )
        if start_ply < 0 or start_ply > len(game_moves):
            raise LineError(
                f"the line branches at half-move {start_ply}, but the game is "
                f"{len(game_moves)} half-moves long"
            )
        board = chess.Board()
        for san in game_moves[:start_ply]:
            board.push_san(san)

    start_fen = board.fen()
    steps = []
    for san in sans:
        try:
            move = board.parse_san(san)
        except (ValueError, AssertionError) as err:
            # Says where in the line it broke, because the usual cause is a line
            # attached to the wrong move number, not a typo in the move — and
            # python-chess's own "invalid san: 'Rd8'" cannot tell those apart.
            # This message is shown to the reader, so it stays free of FENs.
            where = (
                "in the position the line starts from" if not steps
                else f"in the position after {len(steps)} move(s) of the line"
            )
            raise LineError(f"{san} is not legal {where}") from err
        # The label is built before the push, while the board still knows whose
        # move it is. Every step carries its own full label — the strip shows them
        # as separate chips, so "Rxd8" with the number only on the first would be
        # unreadable on its own.
        dots = "." if board.turn == chess.WHITE else "..."
        number = board.fullmove_number
        san_clean = board.san(move)
        board.push(move)
        steps.append({
            "san": san_clean,
            "uci": move.uci(),
            "label": f"{number}{dots}{san_clean}",
            "fen": board.fen(),
        })

    return {
        "startPly": start_ply,
        "startFen": start_fen,
        "steps": steps,
        "truncated": truncated,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--moves", default="", help="the game's SAN moves, space-separated")
    ap.add_argument("--line", required=True, help="the variation, e.g. '13... Rd8 14.Qxd8 Rxd8'")
    ap.add_argument("--from-ply", type=int, help="branch point as a half-move index (0 = start)")
    ap.add_argument("--from-fen", help="branch point as a FEN, overriding --moves/--from-ply")
    ap.add_argument("--max", type=int, default=12, dest="limit",
                    help="half-moves to keep (default 12); the rest are reported as truncated")
    args = ap.parse_args()

    try:
        payload = replay_line(
            args.moves.split(), args.line,
            from_ply=args.from_ply, from_fen=args.from_fen, limit=args.limit,
        )
    except LineError as err:
        sys.exit(str(err))
    except ValueError as err:  # an unparseable --from-fen, or a corrupt game move list
        sys.exit(f"could not replay the line: {err}")

    json.dump(payload, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
