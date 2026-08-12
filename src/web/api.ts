import type {
  Game,
  LogEntry,
  ReviewEvent,
  ReviewSession,
  SweepEvent,
  ThemeVocabEntry,
  Trends,
} from "@shared/events.ts";

export interface ApiError {
  error: string;
  help?: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    const err = new Error(body.error ?? res.statusText) as Error & { help?: string };
    err.help = body.help;
    throw err;
  }
  return (await res.json()) as T;
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export interface Health {
  ok: boolean;
  username: string | null;
  hasLichessToken: boolean;
  hasStockfish: boolean;
}

export const api = {
  health: () => fetch("/api/health").then(json<Health>),

  games: (limit = 30) => fetch(`/api/games?limit=${limit}`).then(json<{ games: Game[] }>),

  refresh: (username?: string, max = 20) =>
    post("/api/games/refresh", { username, max }).then(json<{ fetched: number; games: Game[] }>),

  game: (id: string) =>
    fetch(`/api/games/${id}`).then(
      json<{ game: Game; scan: { rows: { ply: number; fen_after: string }[] } | null; sessions: ReviewSession[] }>,
    ),

  startSweep: (id: string, force = false) => post(`/api/games/${id}/sweep`, { force }).then(json<{ status: string }>),

  createReview: (gameId: string) => post("/api/reviews", { gameId }).then(json<{ session: ReviewSession }>),

  review: (id: string) => fetch(`/api/reviews/${id}`).then(json<{ session: ReviewSession }>),

  say: (id: string, text: string) => post(`/api/reviews/${id}/messages`, { text }).then(json<{ ok: true }>),

  log: () => fetch("/api/log").then(json<{ entries: LogEntry[]; vocab: ThemeVocabEntry[] }>),

  trends: () => fetch("/api/trends").then(json<Trends>),
};

/** Subscribe to an SSE endpoint. Returns an unsubscribe function. */
function subscribe<T>(url: string, onEvent: (event: T) => void): () => void {
  const source = new EventSource(url);
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data) as T);
    } catch {
      // A heartbeat comment never reaches onmessage; anything unparseable is a bug
      // on the server side, and dropping it beats tearing down the stream.
    }
  };
  return () => source.close();
}

export const streamSweeps = (onEvent: (e: SweepEvent) => void) =>
  subscribe<SweepEvent>("/api/sweeps/stream", onEvent);

export const streamReview = (id: string, onEvent: (e: ReviewEvent) => void) =>
  subscribe<ReviewEvent>(`/api/reviews/${id}/stream`, onEvent);
