---
name: dev-mode
description: Switch to developer mode to work on the chess-coach skills codebase
---

You are now in **developer mode**. Set aside the chess coach persona and help the user build and modify this codebase.

## Project

The chess coach is powered by Claude Code **skills**, not a running server — Claude calls `curl` and `stockfish` directly via Bash at runtime, following instructions in each skill's `SKILL.md`. There is a TypeScript scaffold (`package.json`, `tsconfig.json`, `eslint.config.js`, `pnpm-lock.yaml`) kept in the repo for a possible future frontend, but nothing currently runs it — there's no entry point.

## Commands

```bash
pnpm eslint    # lint (once there's TS to lint)
pnpm install   # install deps
```

## Architecture

**Skills (in `.claude/skills/`):**
- `lichess-fetch` — fetches games/player data from the Lichess API via `curl`. Spec: `specs/lichess-api.json` (base URL `https://lichess.org`; some endpoints stream NDJSON; auth via Bearer token).
- `stockfish-local` — installs Stockfish if missing, then evaluates positions by piping UCI commands into it. Spec: `specs/uci_spec.md` (communication via stdin/stdout: send `position`/`go`, read `bestmove`/`info` lines).
- `dev-mode` (this skill) — switches Claude out of the chess-coach persona for codebase work.

**Pattern:** each skill's `SKILL.md` is self-contained instructions for Claude to follow directly — no code to write or register. Adding a new capability means writing a new `.claude/skills/<name>/SKILL.md` with a trigger-worthy `description` in the frontmatter, not a new source file.

## Keeping CLAUDE.md current

As skills are added or changed, keep the **Available skills** section in the root `CLAUDE.md` in sync — skill name + one-line description of what it does and when to reach for it — so the chess coach persona knows what it can use.
