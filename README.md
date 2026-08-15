# Chess Coach

A set of Claude Code skills that turn Claude Code into a chess coach. It fetches your recent games from Lichess and walks through them with you — critical moments, what you were thinking, and takeaways — with local Stockfish analysis at the moments that matter.

## Usage

Run Claude Code in this repo and give it your Lichess username:

```
claude
```

Then just tell it your username to start reviewing games, working on openings, or drilling puzzles.

## The improvement hub (web UI)

The same coach, with a screen. A local single-user app that lists your recent games, runs the
engine sweep with a progress bar, streams a review into a chat pane, and shows which habits
keep recurring across the coaching log.

```bash
pnpm install
pnpm dev          # API on :3001, UI on http://localhost:5173
```

For a single-port build: `pnpm build`, then `pnpm dev:server` and open <http://localhost:3001>.

The backend runs the Claude Agent SDK against this repo, so it loads `.claude/skills/` and
`CLAUDE.md` directly — the review you get in the browser is driven by the same skills as the
one you get in the terminal, not a reimplementation of them.

**What it needs**

- A Lichess API token in `.claude/settings.local.json` under `env.LICHESS_API_TOKEN` (the same
  place the `lichess-fetch` skill reads it from). The UI shows setup instructions if it's missing.
- `stockfish` on PATH for engine sweeps (`brew install stockfish` / `apt-get install -y stockfish`).
- `uv` for the analysis scripts.
- Claude credentials for the agent — an `ANTHROPIC_API_KEY`, or an existing Claude Code login.

Your notes stay where they were. `notes/game-log.md` remains the source of truth the coach
reads and writes to — newest entry first — and the hub derives a read-only index from it,
rebuilt whenever the file changes. That index is the only part of `data/` that is
disposable.

`data/` is untracked but **not** disposable as a whole. Alongside the index it holds your
fetched games, every review transcript, and the completed engine sweeps in
`data/sweeps/` — each of which cost minutes of engine time and none of which can be
rebuilt from the log. To rebuild just the index, call `POST /api/log/reindex` or restart
the server; deleting `data/` throws away the rest.
