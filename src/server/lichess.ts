import type { Game } from "../shared/events.ts";
import { lichessToken, TOKEN_SETUP_HELP } from "./config.ts";
import { getDb } from "./db.ts";

const BASE = "https://lichess.org";

export class LichessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly help?: string,
  ) {
    super(message);
    this.name = "LichessError";
  }
}

interface RawPlayer {
  user?: { name?: string };
  rating?: number;
  aiLevel?: number;
}

interface RawGame {
  id: string;
  createdAt?: number;
  lastMoveAt?: number;
  winner?: "white" | "black";
  speed?: string;
  rated?: boolean;
  status?: string;
  moves?: string;
  opening?: { name?: string };
  players?: { white?: RawPlayer; black?: RawPlayer };
}

/** Bot opponents carry `aiLevel` instead of `user.name` — name them, don't blank them. */
function playerName(p: RawPlayer | undefined): string {
  if (p?.user?.name) return p.user.name;
  if (typeof p?.aiLevel === "number") return `Stockfish level ${p.aiLevel}`;
  return "Anonymous";
}

export interface FetchOptions {
  username: string;
  max?: number;
  perfType?: string;
  rated?: boolean;
  color?: "white" | "black";
}

/**
 * Pull recent games as NDJSON — one JSON object per line, newest first. This is
 * not a JSON array; parsing the body wholesale fails. Query shape mirrors the
 * lichess-fetch skill so the hub and a terminal session see identical data.
 */
export async function fetchGames(opts: FetchOptions): Promise<Game[]> {
  const token = lichessToken();
  if (!token) throw new LichessError("Lichess API token is not configured", 401, TOKEN_SETUP_HELP);

  const params = new URLSearchParams({
    max: String(Math.min(opts.max ?? 10, 30)),
    moves: "true",
    opening: "true",
    tags: "false",
  });
  if (opts.perfType) params.set("perfType", opts.perfType);
  if (opts.rated !== undefined) params.set("rated", String(opts.rated));
  if (opts.color) params.set("color", opts.color);

  const res = await fetch(
    `${BASE}/api/games/user/${encodeURIComponent(opts.username)}?${params}`,
    {
      headers: {
        Accept: "application/x-ndjson",
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (res.status === 404) {
    // The skill warns this endpoint 404s on auth problems too, so don't assert
    // the username is wrong — say what it actually could be.
    throw new LichessError(
      `Lichess returned 404 for "${opts.username}". This endpoint also 404s when the API token is invalid or expired, so check the token before concluding the username is wrong.`,
      404,
      TOKEN_SETUP_HELP,
    );
  }
  if (res.status === 429) {
    throw new LichessError("Rate limited by Lichess. Wait about a minute before retrying.", 429);
  }
  if (!res.ok) {
    throw new LichessError(`Lichess returned ${res.status}`, res.status);
  }

  const body = await res.text();
  const wanted = opts.username.toLowerCase();

  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RawGame)
    .map((g) => {
      const white = playerName(g.players?.white);
      const black = playerName(g.players?.black);
      const userColor =
        white.toLowerCase() === wanted ? "white" : black.toLowerCase() === wanted ? "black" : null;
      return {
        id: g.id,
        playedAt: g.lastMoveAt ?? g.createdAt ?? Date.now(),
        white,
        black,
        whiteRating: g.players?.white?.rating ?? null,
        blackRating: g.players?.black?.rating ?? null,
        winner: g.winner ?? null,
        speed: g.speed ?? "unknown",
        rated: Boolean(g.rated),
        opening: g.opening?.name ?? null,
        moves: g.moves ?? "",
        userColor,
        sweep: null,
      } satisfies Game;
    });
}

export function upsertGames(games: Game[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO games (id, played_at, white, black, white_rating, black_rating,
                       winner, speed, rated, opening, moves, user_color, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      played_at = excluded.played_at, winner = excluded.winner,
      opening = excluded.opening, moves = excluded.moves,
      user_color = excluded.user_color, raw = excluded.raw
  `);

  db.exec("BEGIN");
  try {
    for (const g of games) {
      stmt.run(
        g.id,
        g.playedAt,
        g.white,
        g.black,
        g.whiteRating,
        g.blackRating,
        g.winner,
        g.speed,
        g.rated ? 1 : 0,
        g.opening,
        g.moves,
        g.userColor,
        JSON.stringify(g),
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return games.length;
}

function rowToGame(r: Record<string, string | number | null>): Game {
  return {
    id: r.id as string,
    playedAt: r.played_at as number,
    white: r.white as string,
    black: r.black as string,
    whiteRating: r.white_rating as number | null,
    blackRating: r.black_rating as number | null,
    winner: r.winner as Game["winner"],
    speed: r.speed as string,
    rated: Boolean(r.rated),
    opening: r.opening as string | null,
    moves: r.moves as string,
    userColor: r.user_color as Game["userColor"],
    sweep: r.status
      ? {
          gameId: r.id as string,
          depth: r.depth as number,
          status: r.status as NonNullable<Game["sweep"]>["status"],
          progress: r.progress as number,
          error: r.error as string | null,
        }
      : null,
  };
}

const GAME_SELECT = `
  SELECT g.*, s.depth, s.status, s.progress, s.error
    FROM games g LEFT JOIN sweeps s ON s.game_id = g.id
`;

export function listGames(limit = 30): Game[] {
  const rows = getDb()
    .prepare(`${GAME_SELECT} ORDER BY g.played_at DESC LIMIT ?`)
    .all(limit) as Record<string, string | number | null>[];
  return rows.map(rowToGame);
}

export function getGame(id: string): Game | null {
  const row = getDb().prepare(`${GAME_SELECT} WHERE g.id = ?`).get(id) as
    | Record<string, string | number | null>
    | undefined;
  return row ? rowToGame(row) : null;
}
