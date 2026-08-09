---
name: lichess-fetch
description: Fetch chess game and player data from the Lichess API — recent games, ratings, openings, move lists. Use whenever the user shares a Lichess username or URL, or asks to pull games/stats from Lichess.
---

Fetch data directly from the Lichess HTTP API with `curl` via Bash — there is no server or SDK involved. For anything beyond what's covered here, consult the full spec at `specs/lichess-api.json` (base URL `https://lichess.org`).

## Fetching a user's recent games

```bash
curl -s -H "Accept: application/x-ndjson" \
  ${LICHESS_API_TOKEN:+-H "Authorization: Bearer $LICHESS_API_TOKEN"} \
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

`LICHESS_API_TOKEN` is optional; include the `Authorization: Bearer` header only when it's set in the environment (unauthenticated requests work fine for public game history, just with lower rate limits).

## Response format

The response is **NDJSON** — one JSON object per line, newest game first. Split on newlines and `JSON.parse`/`jq` each line individually; it is not a single JSON array. Fields worth pulling out per game for a review:

- `players.white` / `players.black` — each has `user.name` and `rating` (or `aiLevel` for a Stockfish opponent)
- `winner` — `"white"` / `"black"` / absent on a draw
- `opening.name` — opening name (e.g. "Italian Game")
- `moves` — full move list as a space-separated SAN string
- `speed`, `rated`, `status`
- `id` — game id; the browsable URL is `https://lichess.org/<id>`

## Errors

- `404` — username doesn't exist; tell the user and ask them to double check it.
- `429` — rate limited; wait roughly a minute before retrying, don't hammer it.
- Any other non-2xx — surface the status code and move on; don't retry silently.

## Other endpoints

`specs/lichess-api.json` covers the rest of the API (single game by id, user profile, puzzles, etc.) if a coaching flow needs more than recent-games history — look up the relevant path there rather than guessing at parameters.
