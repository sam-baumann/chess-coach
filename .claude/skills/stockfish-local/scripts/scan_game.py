#!/usr/bin/env python3
"""Sweep a whole game with Stockfish and rank every move by centipawn loss.

Finds critical moments objectively instead of eyeballing the move list. Emits
one JSON row per ply on stdout; progress goes to stderr so a long run stays
visible while it works.

    uv run --with chess python scan_game.py --moves "e4 e5 Nf3 ..." > scan.json
    uv run --with chess python scan_game.py --pgn game.pgn --depth 20 > scan.json

Each position is evaluated exactly once: the eval *after* move i is the same
position as the eval *before* move i+1, so N+1 searches cover N moves.
"""
import argparse, io, json, sys

import chess
import chess.engine
import chess.pgn

# Mate scores fold into the centipawn scale so losses stay sortable. A mate in 1
# outranks a mate in 8, and every mate outranks any material advantage.
MATE_BASE = 100_000


def to_cp(score, pov):
    """Signed centipawns from `pov`'s side, with mates mapped onto the scale."""
    s = score.pov(pov)
    if s.is_mate():
        m = s.mate()
        v = MATE_BASE - abs(m) * 100
        return v if m > 0 else -v
    return s.score()


def is_mate_score(cp):
    return abs(cp) > MATE_BASE - 10_000


def load_moves(args):
    """Return a list of SAN strings or Move objects — main() accepts either."""
    if args.moves:
        return args.moves.split()
    text = sys.stdin.read() if args.pgn == "-" else open(args.pgn).read()
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        sys.exit("could not parse a game from the PGN")
    return list(game.mainline_moves())


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--moves", help="space-separated SAN move list")
    src.add_argument("--pgn", help="PGN file, or - for stdin")
    ap.add_argument("--depth", type=int, default=18,
                    help="search depth for the sweep (default 18)")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--hash", type=int, default=512, help="hash table MB")
    ap.add_argument("--engine", default="stockfish")
    args = ap.parse_args()

    moves = load_moves(args)
    board = chess.Board()
    positions = [board.fen()]
    sans, ucis = [], []
    for m in moves:
        mv = board.parse_san(m) if isinstance(m, str) else m
        sans.append(board.san(mv))
        ucis.append(mv.uci())
        board.push(mv)
        positions.append(board.fen())

    eng = chess.engine.SimpleEngine.popen_uci(args.engine)
    eng.configure({"Threads": args.threads, "Hash": args.hash})

    # One search per position, always scored from White's point of view.
    evals, bests = [], []
    total = len(positions)
    for i, fen in enumerate(positions):
        b = chess.Board(fen)
        if b.is_game_over():
            outcome = b.outcome()
            if outcome and outcome.winner is not None:
                evals.append(MATE_BASE if outcome.winner == chess.WHITE else -MATE_BASE)
            else:
                evals.append(0)
            bests.append(None)
        else:
            info = eng.analyse(b, chess.engine.Limit(depth=args.depth))
            evals.append(to_cp(info["score"], chess.WHITE))
            pv = info.get("pv")
            bests.append(b.san(pv[0]) if pv else None)
        print(f"\r  scanned {i + 1}/{total} positions", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)
    eng.quit()

    rows = []
    for i, san in enumerate(sans):
        mover = chess.Board(positions[i]).turn
        sign = 1 if mover == chess.WHITE else -1
        before = evals[i] * sign          # into the mover's point of view
        after = evals[i + 1] * sign
        rows.append({
            "ply": i + 1,
            "movenum": i // 2 + 1,
            "color": "W" if mover == chess.WHITE else "B",
            "san": san,
            "uci": ucis[i],
            # cp from the mover's side; positive means the mover stands better
            "eval_before": before,
            "eval_after": after,
            "loss": before - after,
            "mate_before": is_mate_score(before),
            "mate_after": is_mate_score(after),
            "engine_best": bests[i],
            # White's point of view, for charting a single continuous trace
            "wcp_after": evals[i + 1],
            "fen_before": positions[i],
            "fen_after": positions[i + 1],
        })

    json.dump({"depth": args.depth, "plies": len(rows), "rows": rows}, sys.stdout, indent=1)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
