---
name: stockfish-local
description: Evaluate chess positions or find the best move with a local Stockfish engine, installing Stockfish first if it isn't already available. Use for engine evaluation, blunder-checking, or "what's the best move here" during game review or puzzle work.
---

Drive Stockfish directly over UCI via Bash — no wrapper process to manage, just pipe a command sequence in and read the output. Full protocol reference: `specs/uci_spec.md`.

## 1. Make sure Stockfish is installed

```bash
command -v stockfish || brew install stockfish   # macOS
command -v stockfish || apt-get install -y stockfish   # Debian/Ubuntu
```

If neither package manager applies, tell the user and point them at https://stockfishchess.org/download/ rather than guessing at a build process.

## 2. Evaluate a position

Pipe a full UCI command sequence into one invocation — no need to hold the process open or manage `uciok`/`readyok` handshakes for a single one-off analysis:

```bash
printf 'position fen <FEN>\ngo depth 18\n' | stockfish
```

Or from the start position with a move list:

```bash
printf 'position startpos moves e2e4 e7e5 g1f3\ngo depth 18\n' | stockfish
```

Read the last `bestmove` line for the recommended move (long algebraic, e.g. `e2e4`), and the final `info depth ...` line before it for the evaluation:
- `score cp <n>` — centipawn eval from the side-to-move's perspective (divide by 100 for pawns)
- `score mate <n>` — forced mate in `n` moves (negative if the side to move is getting mated)
- `pv ...` — the principal variation (best line found)

Use `go depth 18` for a solid tactical read at interactive speed; increase depth or use `go movetime <ms>` for a deeper look at a genuinely critical moment.

## 3. Showing alternatives while teaching

Set `MultiPV` before searching to surface more than one candidate move — useful when a position has more than one good option and you want to show why the user's move falls short of the top choice(s):

```bash
printf 'setoption name MultiPV value 3\nposition fen <FEN>\ngo depth 18\n' | stockfish
```

This prints one `info ... multipv <k> ... pv ...` line per candidate at each depth — take the ones from the final (deepest) batch.

## 4. Reviewing a whole game — the two-pass sweep

For a single question ("is this a blunder?") the one-off calls above are enough. For a
**game review**, don't guess at which moves matter by reading the move list — find them
objectively, then go deep only where it counts. Two passes:

**Pass 1 — sweep the whole game and rank every move by centipawn loss.**

```bash
uv run --with chess python .claude/skills/stockfish-local/scripts/scan_game.py \
  --moves "e4 e5 Nf3 Nc6 c3 ..." --depth 18 > scan.json
```

Accepts `--moves "<SAN list>"` (what `lichess-fetch` returns) or `--pgn <file|->`. Emits one
row per ply with `loss`, `engine_best`, and the FEN either side of the move. Each position is
searched once, so a 64-ply game is 65 searches, not 130.

**Pass 2 — re-analyse the worst moves deeper, with ranked alternatives.**

```bash
uv run --with chess python .claude/skills/stockfish-local/scripts/probe_moments.py \
  scan.json --plies 13,27,39,41 --depth 22
```

Omit `--plies` to auto-select the worst by loss (`--top`, `--side W`). Prints the top-3 lines
in readable SAN plus what the played move actually allows. Add `--json` to pipe onward.

### Quote numbers from pass 2, never pass 1

Sweep evals drift with depth, sometimes wildly. The same move in one real review:

| depth 18 | depth 20 | depth 22 |
|---|---|---|
| −1.80 | −22.37 | −6.78 |

All three "agree" it is a blunder; only the deepest is worth putting in front of the user.
Use the sweep to *rank and locate*, the probe to *quote and explain*.

### Practical notes

- **These runs are slow — background them.** A 64-ply sweep at depth 18 takes minutes, and
  depth 20+ can exceed ten. Use `run_in_background: true` and let the completion notify you;
  `scan_game.py` streams progress to stderr so you can check on it with `Read`.
- Raising `--depth` past ~20 on the sweep is usually the wrong trade. Sweep shallow and wide,
  probe deep and narrow.
- Mate scores fold onto the centipawn scale (`MATE_BASE = 100000`), so mates always outrank
  material and sort to the top. Check the `mate_before` / `mate_after` flags before printing a
  `loss` as a pawn count — "loss 992.02" means a forced mate was allowed, not 992 pawns.

## Usage notes

- Outside a full review, analyse specific critical-moment FENs rather than every move — depth
  costs real time. Inside a review, use the two-pass sweep above; picking moments by eye misses
  the quiet ones (a king step that abandons a defender rarely looks like a candidate).
- If the user gave only a move list, convert it yourself — `uv run --with chess` gives you
  `python-chess` for SAN→FEN without installing anything globally. Never ask the user for a FEN
  you could derive. (Project rule: `uv` only, never `pip install` — see root `CLAUDE.md`.)
