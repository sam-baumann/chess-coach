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

## Usage notes

- Analyze specific critical-moment FENs, not every move of the game — this stays consistent with the "scan for critical moments" game-review flow in the root `CLAUDE.md`.
- FENs can be derived from a PGN/move list; if the user only gave a move list, convert to FEN (or use `position startpos moves ...`) rather than asking them to supply one.
