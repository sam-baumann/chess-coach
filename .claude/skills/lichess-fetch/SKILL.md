---
name: lichess-fetch
description: Fetch chess game and player data from the Lichess API — recent games, ratings, openings, move lists. Use whenever the user shares a Lichess username or URL, or asks to pull games/stats from Lichess.
---

Fetch data directly from the Lichess HTTP API with `curl` via Bash — there is no server or SDK involved. For anything beyond what's covered here, consult the full spec at `specs/lichess-api.json` in the **project root** (not under this skill directory) — base URL `https://lichess.org`.

## Setup (first use in this project)

These curl calls authenticate via `$LICHESS_API_TOKEN`, injected through `.claude/settings.local.json`'s `env` key (gitignored, never committed). Before the first fetch in a session, check it's actually set:

```bash
[ -n "$LICHESS_API_TOKEN" ] && [ "$LICHESS_API_TOKEN" != "REPLACE_ME" ] && echo ok || echo missing
```

If it prints `missing`, stop and walk the user through setup instead of guessing at query params or retrying — unauthenticated requests to `/api/games/user/` are unreliable (expect stray 404s, not just 429s):

1. Create a personal API token at `https://lichess.org/account/oauth/token/create` — no scopes needed, this only reads public game history.
2. Open `.claude/settings.local.json` in this repo and replace `"REPLACE_ME"` under `"env": { "LICHESS_API_TOKEN": ... }` with the real token. Do this directly in an editor, not by pasting the token into chat — it's a secret and chat transcripts are stored.
3. Start a new Claude Code session (env vars from settings load at startup, so the current session won't pick it up).

If the file or key is missing entirely, recreate it:
```json
{ "env": { "LICHESS_API_TOKEN": "REPLACE_ME" } }
```

## Remembering the user's own username

The first time the user identifies a Lichess username as *their own* (e.g. "my username is X", "here's my account: X", or they confirm a username you ask them to clarify is theirs), save it to `.claude/lichess-user.local.md` in the project root so you don't have to ask again next session:

```bash
echo "<username>" > .claude/lichess-user.local.md
```

This file is gitignored (`.claude/*.local.md`) — it's local to this machine, never committed.

Before asking "what's your Lichess username?", check whether it's already stored:

```bash
cat .claude/lichess-user.local.md 2>/dev/null
```

If it exists, use that username directly rather than asking. If the user gives a different username in the moment, use the one they gave you for that request — and if it looks like it's now *their* account (not an opponent or a game they're reviewing), overwrite the stored file with the new value.

## Fetching a user's recent games

```bash
curl -s -H "Accept: application/x-ndjson" \
  -H "Authorization: Bearer $LICHESS_API_TOKEN" \
  "https://lichess.org/api/games/user/<username>?max=10&moves=true&opening=true&tags=false"
```

Query params:
- `max` — number of games (default 10, cap at 30 to keep the response manageable)
- `moves=true` — include the full move list in SAN
- `opening=true` — include ECO/opening name
- `tags=false` — skip PGN tag pairs, not needed for coaching
- `perfType` — restrict to one of `ultraBullet`, `bullet`, `blitz`, `rapid`, `classical`, `correspondence`, `chess960`, `crazyhouse`, `antichess`, `atomic`, `horde`, `kingOfTheHill`, `racingKings`, `threeCheck`
- `rated=true|false` — only rated or only casual
- `color=white|black` — only games played as that color

## Response format

The response is **NDJSON** — one JSON object per line, newest game first. Split on newlines and `JSON.parse`/`jq` each line individually; it is not a single JSON array. Fields worth pulling out per game for a review:

- `players.white` / `players.black` — each has `user.name` and `rating` (or `aiLevel` for a Stockfish opponent)
- `winner` — `"white"` / `"black"` / absent on a draw
- `opening.name` — opening name (e.g. "Italian Game")
- `moves` — full move list as a space-separated SAN string
- `speed`, `rated`, `status`
- `id` — game id; the browsable URL is `https://lichess.org/<id>`

## Errors

- `404` — check `$LICHESS_API_TOKEN` is set first (see Setup above); unauthenticated requests to this endpoint can 404 even for valid usernames. Only conclude the username is wrong after confirming the token is set and valid.
- `429` — rate limited; wait roughly a minute before retrying, don't hammer it.
- Any other non-2xx — surface the status code and move on; don't retry silently.

## Other endpoints

`specs/lichess-api.json` (project root) covers the rest of the API (single game by id, user profile, puzzles, etc.) if a coaching flow needs more than recent-games history — look up the relevant path there rather than guessing at parameters.
