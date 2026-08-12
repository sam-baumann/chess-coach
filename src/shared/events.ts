/**
 * The wire vocabulary between server and browser.
 *
 * Deliberately small. The Agent SDK's `SDKMessage` union has ~35 members and
 * changes with the SDK; the browser only needs to know how to render a review,
 * so the server narrows it to the handful of events below. Nothing here imports
 * from the SDK — that keeps the browser bundle free of server types.
 */

/** A game as the UI sees it. `moves` is the space-separated SAN list. */
export interface Game {
  id: string;
  playedAt: number;
  white: string;
  black: string;
  whiteRating: number | null;
  blackRating: number | null;
  winner: "white" | "black" | null;
  speed: string;
  rated: boolean;
  opening: string | null;
  moves: string;
  /** Which side the hub's own user played, when known. */
  userColor: "white" | "black" | null;
  sweep: SweepStatus | null;
}

export interface SweepStatus {
  gameId: string;
  depth: number;
  status: "queued" | "running" | "done" | "failed";
  /** 0–1, derived from scan_game.py's stderr progress line. */
  progress: number;
  error: string | null;
}

/**
 * One entry from notes/game-log.md. Field names mirror the six-line format the
 * log's own header prescribes — the log is the source of truth, this is a view.
 */
export interface LogEntry {
  id: number;
  date: string;
  kind: "game" | "player-review";
  colour: string | null;
  opponent: string | null;
  opponentRating: number | null;
  opening: string | null;
  result: string | null;
  gameUrl: string | null;
  themes: string[];
  struggled: string;
  heldUp: string;
  workOn: string;
}

/** A tag from the log header's vocabulary table, with its Lichess drill themes. */
export interface ThemeVocabEntry {
  tag: string;
  /** Empty when the header records an explicit "—" (not a puzzle problem). */
  puzzleThemes: string[];
}

export interface Trends {
  themeCounts: { tag: string; count: number }[];
  /**
   * The single habit worth raising, or null. Populated only when the log's own
   * threshold is met: three-plus games, or two of the last three. Below that the
   * log is explicit that naming a pattern invents one.
   */
  recurring: {
    tag: string;
    count: number;
    reason: "three-or-more" | "two-of-last-three";
    puzzleThemes: string[];
  } | null;
  ratingSeries: { playedAt: number; rating: number; speed: string }[];
  entryCount: number;
}

/** Events pushed over SSE while a sweep runs. */
export type SweepEvent =
  | { type: "sweep_progress"; gameId: string; progress: number }
  | { type: "sweep_done"; gameId: string }
  | { type: "sweep_failed"; gameId: string; error: string };

/** Events pushed over SSE while the agent works on a review. */
export type ReviewEvent =
  | { type: "session"; sessionId: string; agentSessionId: string; skills: string[] }
  /** Incremental assistant text. Concatenate deltas sharing a `blockId`. */
  | { type: "assistant_delta"; blockId: string; text: string }
  /** A complete assistant message; supersedes any deltas with the same blockId. */
  | { type: "assistant_text"; blockId: string; text: string }
  | { type: "thinking"; blockId: string }
  | { type: "tool_start"; toolUseId: string; name: string; summary: string }
  | { type: "tool_end"; toolUseId: string; isError: boolean }
  | { type: "turn_done"; costUsd: number | null }
  | { type: "error"; message: string };

export interface ReviewMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface ReviewSession {
  id: string;
  gameId: string;
  agentSessionId: string | null;
  title: string | null;
  createdAt: number;
  messages: ReviewMessage[];
}
