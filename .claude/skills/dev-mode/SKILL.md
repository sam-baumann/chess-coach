---
name: dev-mode
description: Switch to developer mode to work on the chess-coach skills codebase
---

You are now in **developer mode**. Set aside the chess coach persona and help the user build and modify this codebase.

## Project

Two surfaces over one set of skills.

**In a Claude Code session**, the coach is powered by the **skills** alone — no server: Claude
calls `curl` and `stockfish` directly via Bash, following each skill's `SKILL.md`.

**In the hub** (`src/`), a local web app wraps the same skills. Its backend embeds the Claude
Agent SDK, which loads `.claude/skills/` straight off the filesystem, so the skills and
`CLAUDE.md` drive the review there too — nothing is reimplemented. See **The hub** below.

## Commands

```bash
pnpm install     # install deps
pnpm dev         # hub: Fastify on :3001 + Vite on :5173
pnpm build       # build the SPA into dist/web (then :3001 serves it too)
pnpm typecheck   # both tsconfig projects
pnpm lint        # eslint
pnpm test        # node:test — game-log parser + recurrence rule
```

## Architecture

**Skills (in `.claude/skills/`):**
- `lichess-fetch` — fetches games/player data from the Lichess API via `curl`. Spec: `specs/lichess-api.json` (base URL `https://lichess.org`; some endpoints stream NDJSON; auth via Bearer token).
- `stockfish-local` — installs Stockfish if missing, then evaluates positions by piping UCI commands into it. Spec: `specs/uci_spec.md` (communication via stdin/stdout: send `position`/`go`, read `bestmove`/`info` lines). Also ships `scripts/scan_game.py` and `scripts/probe_moments.py` for the two-pass whole-game sweep.
- `game-review` — builds a published review page from a completed sweep. Ships `template.html` plus `scripts/` for board diagrams, the evaluation trace, replaying a line into positions, and a both-themes preview/audit.
- `dev-mode` (this skill) — switches Claude out of the chess-coach persona for codebase work.

**Coaching state (outside `.claude/`) — all of it gitignored, none of it repo content:**
- `notes/game-log.md` — six-line note per analysed game (themes, what was struggled with,
  what to work on), newest first. The coach reads it before a review and adds an entry at
  the top after one, so recurring habits surface across sessions. **Gitignored**: the
  entries are the user's game history, and a public clone must not carry them.
- `notes/game-log.template.md` — tracked, and the spec: entry format, tag vocabulary, and
  the recurrence threshold for raising a theme. `ensureGameLog()` copies it to the log on
  first boot, and `gamelog.test.ts` asserts the format against it. Edit the format here —
  a change made only in a local log reaches nobody. Keep it and the **Keeping the game
  log** section of `CLAUDE.md` in agreement.
- `reviews/` — published `game-review` pages, also gitignored for the same reason (they
  carry the user's username, their opponents', and game URLs).

**Pattern:** each skill's `SKILL.md` is self-contained instructions for Claude to follow directly — nothing to register, and no build step. Adding a capability means writing a new `.claude/skills/<name>/SKILL.md` with a trigger-worthy `description` in the frontmatter.

## The hub (`src/`)

A local, single-user web app: browse recent games, watch an engine sweep run, review a game in
a streaming chat, and see which habits recur across the log.

```
src/shared/events.ts   wire types shared by both sides
src/server/            Fastify API (config, db, gamelog, lichess, sweep, agent, render, routes)
src/web/               React + Vite SPA
data/                  gitignored — hub.db and sweeps/<gameId>.json
```

**The division of labour is the design.** Deterministic work is plain code; only judgment goes
to the agent. Fetching Lichess games is a `fetch()` in `lichess.ts`; the whole-game sweep is a
spawned `scan_game.py` in `sweep.ts` (minutes long, so it needs a progress bar rather than an
opaque tool call); parsing the log is `gamelog.ts`. The agent picks the critical moments, asks
the Socratic questions, finds the one habit, and writes the log entry — and it still gets Bash
and the skills, so it runs `probe_moments.py` at depth on the plies it chooses.

**`agent.ts` is the integration point.** `query()` runs with `cwd` at the repo root and
`settingSources: ['user', 'project']` — that is what loads `.claude/skills/` and `CLAUDE.md`.
Setting `settingSources: []` would silently disable both and leave a generic assistant. One
long-lived `Query` per review, fed by a push queue so follow-up turns don't re-pay startup;
the agent's own session id is persisted so a restart can `resume`. The ~35-member `SDKMessage`
union is narrowed to the handful of events in `src/shared/events.ts` — the browser never sees
SDK types. Tool events are part of that vocabulary on purpose: without them a two-minute
engine probe is indistinguishable from a hang.

**SQLite is derived, never canonical.** `notes/game-log.md` stays the source of truth for
coaching state — the agent writes it, `gamelog.ts` reparses it on `fs.watch`, and the `log_*`
tables are rebuilt wholesale. The app never writes markdown back. If the hub ever seems to
want the log in a different shape, that's a signal the hub is wrong, not the log. Two parser
details carry real weight and are covered by tests: everything before the
`<!-- Entries below` marker is skipped (the header holds an example entry and the whole tag
vocabulary — counting either corrupts every statistic), and the recurrence rule is the log's
own (three-plus games, or two of the last three) rather than "most common tag so far".

**Board diagrams and the eval trace shell out to the `game-review` scripts** rather than being
rebuilt in React — `render_board.py` and `eval_trace.py` already encode the solid-glyph,
square-parity, and diverging-fill decisions. A FEN in the coach's reply is clickable whether or
not the scan holds it: one in the scan moves the scrubber, one the game never reached goes on
the board on its own (framed, ply readout saying so) until any game navigation takes it back.
That is the whole variation feature — no replay endpoint, no strip; the agent gets the FENs
itself from `game-review/scripts/replay_line.py`. `src/web/theme.css` lifts the palette from
`game-review/template.html` verbatim, all three blocks, so the app and the published pages
match; dropping the un-stamped `prefers-color-scheme` block is the regression to watch for.

A skill may also carry **helper scripts** in its own `scripts/` directory, for work that is
slow, fiddly, or easy to get subtly wrong when re-derived from prose each time (engine
sweeps, SVG geometry, accessibility audits). Run them with `uv run --with <pkg>` — never
install into system Python. Keep them argparse CLIs that are also importable, so Claude can
either shell out or `from render_board import board_html`. Prose in `SKILL.md` should say
*when and why*; the script holds the *how*.

## Keeping CLAUDE.md current

As skills are added or changed, keep the **Available skills** section in the root `CLAUDE.md` in sync — skill name + one-line description of what it does and when to reach for it — so the chess coach persona knows what it can use.
