import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { SweepEvent, SweepStatus } from "../shared/events.ts";
import { REPO_ROOT, SWEEP_DIR, ensureDirs } from "./config.ts";
import { getDb } from "./db.ts";

/**
 * The whole-game sweep runs as a plain child process, not as an agent tool call.
 * A 64-ply game at depth 18 takes minutes; behind a tool call that is an opaque
 * hang, whereas scan_game.py streams "scanned i/N positions" to stderr, which is
 * exactly the progress signal a UI needs. The agent still gets the deep probe
 * (probe_moments.py) — that's the part requiring judgment about which plies matter.
 */
const SCAN_SCRIPT = ".claude/skills/stockfish-local/scripts/scan_game.py";
const PROBE_SCRIPT = ".claude/skills/stockfish-local/scripts/probe_moments.py";
const DEFAULT_DEPTH = 18;

export const sweepBus = new EventEmitter();
// Both the games list and every open review subscribe to /api/sweeps/stream, so
// a handful of tabs passes the default cap of 10 while working correctly.
sweepBus.setMaxListeners(50);

const running = new Set<string>();

export function scanPath(gameId: string): string {
  return join(SWEEP_DIR, `${gameId}.json`);
}

export function sweepStatus(gameId: string): SweepStatus | null {
  const row = getDb()
    .prepare("SELECT game_id, depth, status, progress, error FROM sweeps WHERE game_id = ?")
    .get(gameId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return {
    gameId: row.game_id as string,
    depth: row.depth as number,
    status: row.status as SweepStatus["status"],
    progress: row.progress as number,
    error: row.error as string | null,
  };
}

function setStatus(
  gameId: string,
  patch: Partial<Pick<SweepStatus, "status" | "progress" | "error">> & { depth?: number },
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sweeps (game_id, depth, status, progress, scan_path, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET
       depth = excluded.depth,
       status = COALESCE(excluded.status, sweeps.status),
       progress = excluded.progress,
       error = excluded.error`,
  ).run(
    gameId,
    patch.depth ?? DEFAULT_DEPTH,
    patch.status ?? "queued",
    patch.progress ?? 0,
    scanPath(gameId),
    patch.error ?? null,
    Date.now(),
  );
}

function emit(event: SweepEvent): void {
  sweepBus.emit("event", event);
}

/**
 * A sweep is a child process, so it dies with the server. Rows left at "running"
 * have nothing behind them: the UI renders a progress bar for that status and no
 * event will ever arrive to move it, so the row would sit frozen forever with no
 * way to restart it. Mark them failed at boot, which restores the sweep button.
 */
export function reconcileInterruptedSweeps(): number {
  const info = getDb()
    .prepare("UPDATE sweeps SET status = 'failed', error = ? WHERE status = 'running'")
    .run("The server restarted while this sweep was running. Start it again.");
  return Number(info.changes);
}

/** Stockfish is installed by the stockfish-local skill; say so rather than failing opaquely. */
export function stockfishMissingHelp(): string {
  return [
    "Stockfish is not on PATH, so the engine sweep cannot run.",
    "",
    "  macOS:         brew install stockfish",
    "  Debian/Ubuntu: apt-get install -y stockfish",
    "",
    "Otherwise download a build from https://stockfishchess.org/download/ and put it on PATH.",
  ].join("\n");
}

export function checkStockfish(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("sh", ["-c", "command -v stockfish"], { stdio: "ignore" });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

export interface StartSweepResult {
  status: "started" | "already-running" | "already-done" | "unavailable";
  message?: string;
}

/**
 * Kick off a sweep in the background. Returns immediately; progress arrives on
 * `sweepBus`. Re-running a completed sweep is a no-op unless `force` is set —
 * these are expensive and deterministic enough to cache on disk.
 */
export async function startSweep(
  gameId: string,
  moves: string,
  opts: { depth?: number; force?: boolean } = {},
): Promise<StartSweepResult> {
  const depth = opts.depth ?? DEFAULT_DEPTH;

  if (running.has(gameId)) return { status: "already-running" };
  if (!opts.force && existsSync(scanPath(gameId)) && sweepStatus(gameId)?.status === "done") {
    return { status: "already-done" };
  }
  if (!moves.trim()) {
    return { status: "unavailable", message: "This game has no recorded moves to sweep." };
  }

  // Claim the slot before the first await: two clicks close together would both
  // clear the guard above and spawn a second scan writing the same file.
  running.add(gameId);
  if (!(await checkStockfish())) {
    running.delete(gameId);
    setStatus(gameId, { status: "failed", error: stockfishMissingHelp(), depth });
    return { status: "unavailable", message: stockfishMissingHelp() };
  }

  ensureDirs();
  setStatus(gameId, { status: "running", progress: 0, depth });

  const out = createWriteStream(scanPath(gameId));
  const child = spawn(
    "uv",
    ["run", "--with", "chess", "python", SCAN_SCRIPT, "--moves", moves, "--depth", String(depth)],
    { cwd: REPO_ROOT },
  );

  child.stdout.pipe(out);

  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
    // scan_game.py rewrites a single line: "\r  scanned 12/65 positions"
    const matches = [...chunk.matchAll(/scanned (\d+)\/(\d+)/g)];
    const last = matches.at(-1);
    if (!last) return;
    const progress = Number(last[1]) / Number(last[2]);
    setStatus(gameId, { status: "running", progress, depth });
    emit({ type: "sweep_progress", gameId, progress });
  });

  // A spawn failure emits `error` and *then* `close`. Without this the useful
  // "is uv installed?" message is immediately overwritten by "exited -2" with an
  // empty stderr tail — exactly the case the message exists for.
  let failed = false;

  child.on("error", (err) => {
    failed = true;
    running.delete(gameId);
    const message = `Could not start the sweep: ${err.message}. Is \`uv\` installed?`;
    setStatus(gameId, { status: "failed", progress: 0, error: message, depth });
    emit({ type: "sweep_failed", gameId, error: message });
  });

  child.on("close", (code) => {
    running.delete(gameId);
    if (failed) {
      out.end();
      return;
    }
    if (code !== 0) {
      out.end();
      const message = `scan_game.py exited ${code}.\n${stderrTail.trim()}`;
      setStatus(gameId, { status: "failed", error: message, depth });
      emit({ type: "sweep_failed", gameId, error: message });
      return;
    }
    // Announce only once the file is actually on disk. The child closing does not
    // mean the piped write stream has flushed, and a reader reacting to
    // sweep_done would hit truncated JSON — which readScan turns into a silent null.
    const announceDone = () => {
      setStatus(gameId, { status: "done", progress: 1, depth });
      emit({ type: "sweep_done", gameId });
    };
    // pipe() ends `out` itself, so "finish" may already have gone by.
    if (out.writableFinished) announceDone();
    else out.once("finish", announceDone);
    out.end();
  });

  return { status: "started" };
}

export interface ScanRow {
  ply: number;
  movenum: number;
  color: "W" | "B";
  san: string;
  loss: number;
  mate_before: boolean;
  mate_after: boolean;
  engine_best: string | null;
  wcp_after: number;
  fen_before: string;
  fen_after: string;
}

export interface ScanFile {
  depth: number;
  plies: number;
  rows: ScanRow[];
}

export function readScan(gameId: string): ScanFile | null {
  try {
    return JSON.parse(readFileSync(scanPath(gameId), "utf8")) as ScanFile;
  } catch {
    return null;
  }
}

export { PROBE_SCRIPT, SCAN_SCRIPT, DEFAULT_DEPTH };
