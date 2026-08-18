import { copyFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root — the directory holding .claude/, notes/, specs/. */
export const REPO_ROOT = resolve(here, "..", "..");

export const DATA_DIR = join(REPO_ROOT, "data");
export const SWEEP_DIR = join(DATA_DIR, "sweeps");
export const DB_PATH = join(DATA_DIR, "hub.db");
export const GAME_LOG_PATH = join(REPO_ROOT, "notes", "game-log.md");
/**
 * The log's header — entry format, tag vocabulary, recurrence rule — kept as a
 * tracked seed because the log itself is not. Entries are the user's own game
 * history, so `notes/game-log.md` is gitignored and a fresh clone has only this.
 */
export const GAME_LOG_TEMPLATE_PATH = join(REPO_ROOT, "notes", "game-log.template.md");
export const REVIEWS_DIR = join(REPO_ROOT, "reviews");
export const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");

export const PORT = Number(process.env.PORT ?? 3001);

export function ensureDirs(): void {
  mkdirSync(SWEEP_DIR, { recursive: true });
  // Git doesn't track empty directories, so this may be absent on a fresh clone.
  // Creating it lets the /reviews/ static route register unconditionally at boot.
  mkdirSync(REVIEWS_DIR, { recursive: true });
  ensureGameLog();
}

/**
 * Seed the game log from its template when it is absent — the state of every
 * fresh clone, since the log is gitignored. Without this the parser and the
 * watcher would both be pointing at a file that never exists until the coach
 * writes its first entry, and the trends view would open on an error rather
 * than on an empty log.
 *
 * Never overwrites: an existing log holds the user's entries.
 */
export function ensureGameLog(): void {
  if (existsSync(GAME_LOG_PATH)) return;
  try {
    copyFileSync(GAME_LOG_TEMPLATE_PATH, GAME_LOG_PATH);
  } catch (err) {
    // A missing template is a broken checkout, not a reason to refuse to boot;
    // the log reader already treats an unreadable file as an empty one.
    console.error("[config] could not seed", GAME_LOG_PATH, err);
  }
}

/**
 * The Lichess token lives in `.claude/settings.local.json` under `env`, which is
 * how the lichess-fetch skill already sources it and is already gitignored.
 * Reading it from there rather than inventing a second `.env` keeps one place to
 * rotate the secret. An env var still wins, for running the server elsewhere.
 */
export function lichessToken(): string | null {
  const fromEnv = process.env.LICHESS_API_TOKEN;
  if (fromEnv && fromEnv !== "REPLACE_ME") return fromEnv;

  try {
    const raw = readFileSync(join(REPO_ROOT, ".claude", "settings.local.json"), "utf8");
    const parsed = JSON.parse(raw) as { env?: Record<string, string> };
    const token = parsed.env?.LICHESS_API_TOKEN;
    if (token && token !== "REPLACE_ME") return token;
  } catch {
    // Missing or unparseable file is the same as an unset token.
  }
  return null;
}

/**
 * The username the coach treats as "the user", stored by lichess-fetch in
 * `.claude/lichess-user.local.md`. Reusing that file means the UI and a terminal
 * session agree on whose games these are without a second prompt.
 */
export function storedUsername(): string | null {
  try {
    const raw = readFileSync(join(REPO_ROOT, ".claude", "lichess-user.local.md"), "utf8");
    const name = raw.trim().split("\n")[0]?.trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Setup guidance surfaced verbatim in the UI when the token is missing, so the
 * hub tells the same story the skill does rather than a bare 404.
 */
export const TOKEN_SETUP_HELP = [
  "No Lichess API token found.",
  "",
  "1. Create a personal API token at https://lichess.org/account/oauth/token/create — no scopes needed; this only reads public game history.",
  '2. Open .claude/settings.local.json in this repo and replace "REPLACE_ME" under "env": { "LICHESS_API_TOKEN": ... } with the real token.',
  "3. Restart the hub server so it picks up the new value.",
  "",
  'If the file is missing entirely, create it with: { "env": { "LICHESS_API_TOKEN": "REPLACE_ME" } }',
].join("\n");
