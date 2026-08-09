#!/usr/bin/env python3
"""Re-analyse specific plies from a scan at higher depth, with ranked lines.

The sweep in scan_game.py finds *where* the game turned; this says *what should
have happened* — and it re-verifies the numbers. Shallow sweep evals drift: a
move scored -27.7 at depth 20 came back as -11.9 at depth 22. Always quote the
figure from this pass, never from the sweep.

    uv run --with chess python probe_moments.py scan.json --plies 13,27,39 --depth 22

With no --plies, probes the worst moves by centipawn loss (see --top/--side).
"""
import argparse, json, sys

import chess
import chess.engine

MATE_BASE = 100_000


def fmt_score(score, pov=chess.WHITE):
    s = score.pov(pov)
    if s.is_mate():
        return f"M{s.mate():+d}"
    return f"{s.score() / 100:+.2f}"


def fmt_line(board, pv, limit=8):
    """Render a PV as readable SAN with move numbers."""
    b = board.copy()
    out = []
    for mv in pv[:limit]:
        if b.turn == chess.WHITE:
            prefix = f"{b.fullmove_number}."
        else:
            prefix = f"{b.fullmove_number}..." if not out else ""
        out.append(prefix + b.san(mv))
        b.push(mv)
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scan", help="JSON produced by scan_game.py")
    ap.add_argument("--plies", help="comma-separated ply numbers (1-indexed)")
    ap.add_argument("--top", type=int, default=6, help="worst-N moves if --plies omitted")
    ap.add_argument("--side", choices=["W", "B", "both"], default="both",
                    help="restrict automatic selection to one side")
    ap.add_argument("--depth", type=int, default=22)
    ap.add_argument("--multipv", type=int, default=3)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--hash", type=int, default=512)
    ap.add_argument("--engine", default="stockfish")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = ap.parse_args()

    scan = json.load(open(args.scan))
    rows = {r["ply"]: r for r in scan["rows"]}

    if args.plies:
        plies = [int(p) for p in args.plies.split(",")]
    else:
        cands = [r for r in scan["rows"]
                 if args.side == "both" or r["color"] == args.side]
        plies = sorted(r["ply"] for r in
                       sorted(cands, key=lambda r: -r["loss"])[:args.top])

    eng = chess.engine.SimpleEngine.popen_uci(args.engine)
    eng.configure({"Threads": args.threads, "Hash": args.hash})

    results = []
    for ply in plies:
        r = rows.get(ply)
        if r is None:
            print(f"ply {ply} not in scan", file=sys.stderr)
            continue
        board = chess.Board(r["fen_before"])
        infos = eng.analyse(board, chess.engine.Limit(depth=args.depth),
                            multipv=args.multipv)
        alts = [{"score": fmt_score(i["score"]), "line": fmt_line(board, i["pv"])}
                for i in infos]

        after = chess.Board(r["fen_after"])
        if after.is_game_over():
            played = {"score": "game over", "line": after.result()}
        else:
            i2 = eng.analyse(after, chess.engine.Limit(depth=args.depth))
            played = {"score": fmt_score(i2["score"]),
                      "line": fmt_line(after, i2.get("pv", []))}

        label = f"{r['movenum']}.{'' if r['color'] == 'W' else '..'}{r['san']}"
        results.append({"ply": ply, "move": label, "played": played,
                        "alternatives": alts,
                        "fen_before": r["fen_before"], "fen_after": r["fen_after"]})

        if not args.json:
            print(f"\n=== ply {ply}  {label}   (sweep loss {r['loss'] / 100:.2f})")
            print(f"FEN {r['fen_before']}")
            for k, a in enumerate(alts, 1):
                star = "  <- best" if k == 1 else ""
                print(f"  [{k}] {a['score']:>8}  {a['line']}{star}")
            print(f"  played  {played['score']:>8}  {played['line']}")

    eng.quit()
    if args.json:
        json.dump({"depth": args.depth, "moments": results}, sys.stdout, indent=1)
        print()


if __name__ == "__main__":
    main()
