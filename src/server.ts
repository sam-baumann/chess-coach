import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const LICHESS_BASE_URL = "https://lichess.org";

interface LichessPlayer {
  user?: { name: string; id: string };
  rating?: number;
  aiLevel?: number;
}

interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  perf: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: "white" | "black";
  opening?: { eco: string; name: string; ply: number };
  moves?: string;
}

function describePlayer(player: LichessPlayer) {
  if (player.user) {
    return { name: player.user.name, rating: player.rating ?? null };
  }
  if (player.aiLevel !== undefined) {
    return { name: `Stockfish level ${player.aiLevel}`, rating: null };
  }
  return { name: "Anonymous", rating: player.rating ?? null };
}

function summarizeGame(game: LichessGame) {
  return {
    id: game.id,
    url: `${LICHESS_BASE_URL}/${game.id}`,
    playedAt: new Date(game.lastMoveAt).toISOString(),
    speed: game.speed,
    perf: game.perf,
    rated: game.rated,
    variant: game.variant,
    status: game.status,
    winner: game.winner ?? (game.status === "draw" || game.status === "stalemate" ? "draw" : null),
    white: describePlayer(game.players.white),
    black: describePlayer(game.players.black),
    opening: game.opening?.name ?? null,
    moves: game.moves ?? "",
  };
}

const server = new McpServer({ name: "chess-coach", version: "1.0.0" });

server.registerTool(
  "fetch_recent_games",
  {
    title: "Fetch recent Lichess games",
    description:
      "Fetch a Lichess user's most recent games, newest first. " +
      "Each game includes players, ratings, result, opening name, and the full move list in SAN, " +
      "so a selected game can be reviewed without another fetch.",
    inputSchema: {
      username: z.string().min(1).describe("Lichess username"),
      max: z.number().int().min(1).max(30).optional()
        .describe("Number of games to fetch (default 10, max 30)"),
      perfType: z.enum([
        "ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence",
        "chess960", "crazyhouse", "antichess", "atomic", "horde",
        "kingOfTheHill", "racingKings", "threeCheck",
      ]).optional().describe("Only games of this speed or variant"),
      rated: z.boolean().optional().describe("Only rated (true) or casual (false) games"),
      color: z.enum(["white", "black"]).optional().describe("Only games played as this color"),
    },
  },
  async ({ username, max, perfType, rated, color }) => {
    const params = new URLSearchParams({
      max: String(max ?? 10),
      moves: "true",
      opening: "true",
      tags: "false",
    });
    if (perfType !== undefined) params.set("perfType", perfType);
    if (rated !== undefined) params.set("rated", String(rated));
    if (color !== undefined) params.set("color", color);

    const headers: Record<string, string> = { Accept: "application/x-ndjson" };
    if (process.env.LICHESS_API_TOKEN) {
      headers.Authorization = `Bearer ${process.env.LICHESS_API_TOKEN}`;
    }

    const url = `${LICHESS_BASE_URL}/api/games/user/${encodeURIComponent(username)}?${params}`;
    const response = await fetch(url, { headers });

    if (response.status === 404) {
      return {
        content: [{ type: "text", text: `Lichess user "${username}" not found.` }],
        isError: true,
      };
    }
    if (response.status === 429) {
      return {
        content: [{ type: "text", text: "Lichess rate limit hit — wait a minute before retrying." }],
        isError: true,
      };
    }
    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Lichess API error: ${response.status} ${response.statusText}` }],
        isError: true,
      };
    }

    const body = await response.text();
    const games = body
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as LichessGame)
      .map(summarizeGame);

    if (games.length === 0) {
      return {
        content: [{ type: "text", text: `No games found for "${username}" with the given filters.` }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(games, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("chess-coach MCP server running on stdio");
