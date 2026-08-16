---
name: game-review
description: Build a published game-review page for a chess game — annotated board diagrams, a diverging evaluation trace, and Socratic critical-moment cards. Use when the user asks for a review they can keep, share, or read later ("write it up", "make me an artifact", "can I get this as a page"). Not needed for a normal conversational review.
---

Turns the output of a `stockfish-local` two-pass sweep into a single self-contained HTML page,
published as an Artifact.

**Reviews are conversational by default.** Reach for this only when the user asks for something
durable. A quick "was that a blunder?" never needs a page.

## Prerequisites

Run the two-pass sweep in `stockfish-local` first — you need `scan.json` (whole-game trace) and
the deeper probe output (lines to quote). Writing the page before the analysis exists means
inventing evaluations, which is the one unforgivable error here.

## Steps

**1. Find the story before writing anything.** Read the sweep and ask what single habit connects
the worst moves. A review that lists five unrelated errors teaches nothing; one that shows the
same mistake recurring in five places changes how someone plays. If the moments genuinely don't
share a theme, say so plainly rather than inventing one. Check `notes/game-log.md` too — a habit
this game shares with earlier ones is the strongest thesis a page can have, and it belongs in the
headline rather than buried in the takeaways.

**2. Pick 4–6 moments.** Include the ones that *teach*, not just the ones that lose the most.
A near-miss where the opponent failed to punish is often more instructive than the final blunder,
and a move where two natural-looking options differ by one square is the most instructive of all.

**3. Assemble the page** from `template.html`, substituting the `{{PLACEHOLDERS}}`:

| Placeholder | Content |
|---|---|
| `{{TITLE}}` | browser-tab title |
| `{{EYEBROW}}` | players, time control |
| `{{HEADLINE}}` | the thesis, not "Game Review" — wrap one word in `<em>` for the accent |
| `{{DEK}}` | the finding in two sentences |
| `{{META}}` | `<span>` per fact: ratings, opening, result |
| `{{GAME_URL}}` | `https://lichess.org/<gameId>` |
| `{{ENGINE_NOTE}}` | e.g. `Stockfish 18, depth 20 · clamped to ±6.00` |
| `{{TRACE_SVG}}` | output of `scripts/eval_trace.py` |
| `{{THESIS}}` | opening prose; give the first `<p>` `class="lede"` |
| `{{MOMENTS}}` | one moment block each — the commented template is at the foot of `template.html` |
| `{{TAKEAWAYS}}` | 2 `.card`s, then the `.drill` — puzzle themes to practise (required) |
| `{{FOOTER_LEFT}}` | analysis provenance, e.g. `Stockfish 18 · depth 20–22 · MultiPV 3` |
| `{{FOOTER_RIGHT}}` | link text for the game, e.g. `lichess.org/<gameId>` |

Diagrams come from `scripts/render_board.py` (importable as `board_html(fen, highlight, flip)`).
Highlight the squares the point turns on — the hanging pawn, the file, the escape square.

To diagram a move that *wasn't* played — the engine's recommendation, the line the moment turns
on — get its positions from `scripts/replay_line.py`, which replays notation against the real
game rather than making you assemble FENs by hand:

```bash
uv run --with chess python .claude/skills/game-review/scripts/replay_line.py \
    --moves "<the game's SAN moves>" --line "13... Rd8 14.Qxd8 Rxd8"
```

The move number on the first move is what places the line in the game. Each step comes back with
its FEN and UCI, so the diagram and its highlighted squares both fall out of the same call.
(Importable as `replay_line(game_moves, line)`.) It earns its keep in the hub too: a FEN quoted
in a review chat is clickable, so this is how a "what should have happened" position gets onto
the board there.

**4. Verify in both themes before publishing.**

```bash
uv run --with pillow python .claude/skills/game-review/scripts/preview.py reviews/<name>.html
```

Audits theme-token completeness and screenshots both themes. It exits non-zero on failure —
fix before publishing. Then **actually look at the PNGs**; the audit checks colour, not layout.

**5. Publish** with the `Artifact` tool. Write the file under `reviews/`, use a chess favicon,
and keep the same file path when updating so the URL is stable.

Running inside the improvement hub, there is no `Artifact` tool — the Agent SDK doesn't provide
one. Write the file to `reviews/<name>.html` and stop there; the hub serves that directory at
`/reviews/<name>.html`. Everything above this step is unchanged.

## What makes these pages work

- **Socratic structure is the point.** Each moment states what was played, asks what the user was
  thinking, and hides the engine's answer behind `<details>`. Flattening that into "here's the
  blunder, here's the fix" throws away the only thing that makes a written review better than an
  engine dump.
- **One theme, carried through.** The headline, the thesis, and the takeaways should all be the
  same idea at different magnifications.
- **End with something to go and do.** The `.drill` block prescribes one or two Lichess puzzle
  themes, taken from the tag table in `notes/game-log.md` and linked as
  `https://lichess.org/training/<theme>`. Pick for the habit in the headline, not for the
  single worst move — the page's whole argument is that the habit is the problem. Two themes
  maximum; a list of six is reading, not training. Never invent a theme key: an unrecognised
  one silently serves generic puzzles instead of 404ing, so check it against the table (which
  carries the command for refreshing itself from Lichess). If the habit is one puzzles can't
  fix — opening prep, trade judgment — say so in the drill and prescribe the honest
  alternative rather than a theme that nearly fits.
- **Link every diagram into the game** at the ply *before* the move (`lichess.org/<id>#<ply-1>`),
  so the reader arrives with the decision still open and can try their answer.
- **Name the blunder, then reframe it.** "You had the right idea; `Kf1` keeps it" beats "`Kh2`
  loses 2.5 pawns."
- **Say when the opponent erred too.** A review that only lists the user's mistakes reads as
  punishment and misrepresents the game.

## Gotchas that cost real time

- **The eval trace is diverging, not an area chart.** Two fills either side of the midline —
  light above (White better), dark below. One flat fill for both sides erases the encoding.
  `eval_trace.py` handles this; don't hand-roll it.
- **Board glyphs:** use the solid Unicode set for *both* colours and tint with CSS. The outline
  glyphs (♔♕♖) render faintly and inconsistently across system fonts.
- **Never define a colour only inside `@media` or `[data-theme]`.** In the un-stamped "system"
  state it won't apply, and the page renders one theme's text on the other's ground. `preview.py`
  catches this.
- **Severity never rides on colour alone** — the `?` / `??` glyphs carry it. The marker colours in
  `template.html` were validated for colour-blind separation (ΔE 25 deutan); if you change them,
  re-validate rather than eyeballing.
