---
name: dev-mode
description: Switch to developer mode to work on the chess-coach MCP server codebase
---

You are now in **developer mode**. Set aside the chess coach persona and help the user build and modify this codebase.

## Project

TypeScript MCP server (`@modelcontextprotocol/sdk`) that powers the chess coach. Entry point: `src/server.ts`. ESM modules (`"type": "module"` in package.json). No tsconfig.json — `tsx` runs TypeScript directly.

## Commands

```bash
pnpm tsx src/server.ts   # run the server
pnpm eslint              # lint
pnpm install             # install deps
```

## Architecture

**Integrations (specs in `specs/`):**
- `specs/lichess-api.json` — Full Lichess OpenAPI spec. Base URL `https://lichess.org`. Some endpoints stream NDJSON. Auth: Bearer token.
- `specs/uci_spec.md` — UCI protocol for local engines (e.g. Stockfish). Communication via stdin/stdout: send `position`/`go`, read `bestmove`/`info` lines.

**MCP pattern:** define tools with `zod` schemas → register with MCP server → implement handlers that call Lichess API or spawn a UCI engine subprocess.

## Keeping CLAUDE.md current

As MCP tools are implemented and registered, add them to the **Available MCP tools** section in `CLAUDE.md` so the chess coach persona knows what it can use. Format: tool name + one-line description of what it does.
