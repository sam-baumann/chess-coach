import { DatabaseSync } from "node:sqlite";
import { DB_PATH, ensureDirs } from "./config.ts";

/**
 * SQLite is a *derived* store, not the source of truth for coaching state.
 * notes/game-log.md remains canonical — the agent writes it, gamelog.ts reparses
 * it, and the log_* tables are rebuilt wholesale from that parse. Nothing in the
 * app ever writes back to the markdown.
 *
 * The games/sweeps/review_* tables are genuinely new data with nowhere else to
 * live, so those the app does own.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  played_at     INTEGER NOT NULL,
  white         TEXT NOT NULL,
  black         TEXT NOT NULL,
  white_rating  INTEGER,
  black_rating  INTEGER,
  winner        TEXT,
  speed         TEXT,
  rated         INTEGER NOT NULL DEFAULT 0,
  opening       TEXT,
  moves         TEXT NOT NULL,
  user_color    TEXT,
  raw           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS games_played_at ON games(played_at DESC);

CREATE TABLE IF NOT EXISTS sweeps (
  game_id    TEXT PRIMARY KEY,
  depth      INTEGER NOT NULL,
  status     TEXT NOT NULL,
  progress   REAL NOT NULL DEFAULT 0,
  scan_path  TEXT,
  error      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS log_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  heading_date    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  colour          TEXT,
  opponent        TEXT,
  opponent_rating INTEGER,
  opening         TEXT,
  result          TEXT,
  game_url        TEXT,
  struggled       TEXT NOT NULL DEFAULT '',
  held_up         TEXT NOT NULL DEFAULT '',
  work_on         TEXT NOT NULL DEFAULT '',
  line_start      INTEGER NOT NULL,
  ordinal         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS log_entry_themes (
  entry_id INTEGER NOT NULL REFERENCES log_entries(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS log_entry_themes_tag ON log_entry_themes(tag);

CREATE TABLE IF NOT EXISTS theme_vocab (
  tag           TEXT PRIMARY KEY,
  puzzle_themes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_sessions (
  id               TEXT PRIMARY KEY,
  game_id          TEXT NOT NULL,
  agent_session_id TEXT,
  title            TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS review_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS review_messages_session ON review_messages(session_id, id);
`;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
