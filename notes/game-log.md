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

`king-safety` · `loose-pieces` · `hanging-material` · `calculation-depth` ·
`missed-tactic` · `opening-prep` · `pawn-structure` · `piece-activity` ·
`endgame-technique` · `converting-won-positions` · `time-pressure` ·
`premature-attack` · `passive-defence` · `trade-decisions` · `prophylaxis`

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
