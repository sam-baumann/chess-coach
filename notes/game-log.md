# Game log

One entry per analysed game, **newest first**. The point of this file is recurrence: a
single bad move teaches nothing, the same bad move in five games is a training plan.

Read it before every review. Append to it after every review.

## Entry format

Copy this shape exactly — the fixed field names are what make the log greppable.

```
## YYYY-MM-DD · <colour> vs <opponent> (<rating>) · <opening> · <result>
Game: <url or "pasted PGN">
Themes: <tag>, <tag>
Struggled: <one sentence, with move numbers>
Held up: <one sentence — what actually worked>
Work on: <one actionable sentence>
```

Keep it to those six lines. The full analysis lives in the conversation or in a
`reviews/` page; this is the index, not the review.

- **Themes** are tags from the vocabulary below. Reuse existing tags rather than
  inventing near-synonyms — `king-safety` and `exposed-king` as separate tags means a
  recurring problem never surfaces as one. Add a new tag to the list below only when
  nothing existing fits.
- **Held up** is not optional. A log of pure failure misreads the games and reads as
  punishment.
- If a game is already logged (same `Game:` URL), edit that entry instead of adding a
  second one.
- A multi-game player review gets one entry, with `## YYYY-MM-DD · player review ·
  <N> games` as the heading and the game URLs on the `Game:` line.

## Tag vocabulary

Each tag carries the Lichess puzzle themes that drill it, so a review can end with
something the user can actually go and do. Train a theme at
`https://lichess.org/training/<theme>` — the theme key goes in the URL verbatim.

| Tag | Puzzle themes to practise |
|---|---|
| `king-safety` | `exposedKing`, `kingsideAttack`, `defensiveMove` |
| `loose-pieces` | `hangingPiece`, `fork`, `trappedPiece` |
| `hanging-material` | `hangingPiece`, `capturingDefender` |
| `calculation-depth` | `long`, `mateIn3`, `quietMove` |
| `missed-tactic` | `fork`, `pin`, `skewer`, `discoveredAttack` |
| `opening-prep` | — not a puzzle problem |
| `pawn-structure` | `advancedPawn`, `promotion`, `pawnEndgame` |
| `piece-activity` | `trappedPiece`, `quietMove` |
| `endgame-technique` | `endgame`, `rookEndgame`, `pawnEndgame` |
| `converting-won-positions` | `crushing`, `advantage` |
| `time-pressure` | `oneMove`, `short` (or Puzzle Storm) |
| `premature-attack` | `defensiveMove`, `quietMove` |
| `passive-defence` | `defensiveMove`, `intermezzo` |
| `trade-decisions` | `capturingDefender` (partial — see below) |
| `prophylaxis` | `quietMove`, `defensiveMove` |

Two rules when prescribing from this table:

- **Prescribe at most two themes.** "Do `fork` and `hangingPiece` for a week" gets done;
  a list of six is a reading exercise, not a training plan.
- **Some tags don't drill.** `opening-prep` has no puzzle theme, and `pawn-structure` or
  `trade-decisions` only half-map. Prescribe the honest thing (a line to look up, a
  position to play out) rather than reaching for a theme that nearly fits.

When a new tag is added above, give it a puzzle theme here or an explicit `—`. Check the
key against the live list first:

```bash
curl -sL https://lichess.org/training/themes \
  | grep -o 'href="/training/[A-Za-z0-9]*"' | sed 's|.*/training/||;s|"||' | sort -u
```

A key that isn't a real theme doesn't 404 — Lichess quietly serves generic puzzles
instead, so a typo looks like it worked and the user drills the wrong thing.

## Reading the log for themes

Before a review, scan the `Themes:` lines:

```bash
sed -n '/^<!-- Entries below/,$p' notes/game-log.md \
  | grep '^Themes:' | sed 's/^Themes://' | tr ',' '\n' | tr -d ' ' \
  | sort | uniq -c | sort -rn
```

(The `sed` range skips this header, so the example entry above isn't counted.)

A tag is worth raising with the user when it appears in **three or more games**, or in
**two of the last three**. Below that it's noise — mentioning it invents a pattern out
of coincidence, which is worse than saying nothing.

---

<!-- Entries below, newest first. -->
