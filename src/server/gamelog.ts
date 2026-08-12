import { readFileSync, watch } from "node:fs";
import type { LogEntry, ThemeVocabEntry, Trends } from "../shared/events.ts";
import { GAME_LOG_PATH } from "./config.ts";
import { getDb } from "./db.ts";

/**
 * Everything before this marker is the log's *specification* — the entry format,
 * an example entry, and the tag vocabulary table. Parsing entries out of it would
 * count the example as a real game and every tag in the vocabulary table as an
 * occurrence, corrupting the recurrence statistics the log exists to produce.
 * The log's own header prescribes exactly this cut (`sed -n '/^<!-- Entries below/,$p'`).
 */
const ENTRIES_MARKER = "<!-- Entries below";

/** The heading separator in the log format is U+00B7 MIDDLE DOT, not a hyphen. */
const SEP = "·";

export interface ParsedLog {
  entries: Omit<LogEntry, "id">[];
  vocab: ThemeVocabEntry[];
}

function splitRegions(text: string): { header: string; body: string } {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trimStart().startsWith(ENTRIES_MARKER));
  if (idx === -1) {
    // No marker: treat the whole file as header so we never invent entries out
    // of a malformed log. Better to show zero than to show the example entry.
    return { header: text, body: "" };
  }
  return {
    header: lines.slice(0, idx + 1).join("\n"),
    body: lines.slice(idx + 1).join("\n"),
  };
}

/**
 * Pull the tag vocabulary out of the header's markdown table. Rows look like
 *   | `king-safety` | `exposedKing`, `kingsideAttack`, `defensiveMove` |
 *   | `opening-prep` | — not a puzzle problem |
 * Only backtick-quoted tokens count as theme keys, which correctly yields an
 * empty list for the em-dash rows and ignores the prose asides on rows like
 * `time-pressure` ("(or Puzzle Storm)") and `trade-decisions` ("(partial …)").
 */
export function parseVocab(header: string): ThemeVocabEntry[] {
  const out: ThemeVocabEntry[] = [];
  const seen = new Set<string>();
  for (const line of header.split("\n")) {
    const row = line.trim();
    if (!row.startsWith("|") || !row.endsWith("|")) continue;
    const cells = row.slice(1, -1).split("|");
    if (cells.length < 2) continue;

    const tagMatch = /^\s*`([a-z0-9-]+)`\s*$/.exec(cells[0]);
    if (!tagMatch) continue; // header row, separator row, or a non-tag table
    const tag = tagMatch[1];
    if (seen.has(tag)) continue;
    seen.add(tag);

    const themes = [...cells[1].matchAll(/`([A-Za-z0-9]+)`/g)].map((m) => m[1]);
    out.push({ tag, puzzleThemes: themes });
  }
  return out;
}

function parseHeading(heading: string): Pick<
  LogEntry,
  "date" | "kind" | "colour" | "opponent" | "opponentRating" | "opening" | "result"
> | null {
  const parts = heading
    .replace(/^##\s*/, "")
    .split(SEP)
    .map((p) => p.trim());
  const date = parts[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return null;

  const base = {
    date,
    colour: null as string | null,
    opponent: null as string | null,
    opponentRating: null as number | null,
    opening: null as string | null,
    result: null as string | null,
  };

  // Multi-game sweep variant: "## YYYY-MM-DD · player review · <N> games"
  if (parts[1]?.toLowerCase() === "player review") {
    return { ...base, kind: "player-review", result: parts[2] ?? null };
  }

  const vs = /^(\S+)\s+vs\s+(.+?)(?:\s*\((\d+)\))?$/.exec(parts[1] ?? "");
  return {
    ...base,
    kind: "game",
    colour: vs?.[1] ?? null,
    opponent: vs?.[2]?.trim() ?? null,
    opponentRating: vs?.[3] ? Number(vs[3]) : null,
    opening: parts[2] ?? null,
    result: parts[3] ?? null,
  };
}

const FIELDS = {
  "Game:": "gameUrl",
  "Themes:": "themes",
  "Struggled:": "struggled",
  "Held up:": "heldUp",
  "Work on:": "workOn",
} as const;

/**
 * Parse the six-line entry blocks. Tolerant of a missing field (renders blank)
 * but strict about the heading — an unparseable heading drops the block rather
 * than producing an entry with a bogus date that would skew "last three games".
 */
export function parseGameLog(text: string): ParsedLog {
  const { header, body } = splitRegions(text);
  const vocab = parseVocab(header);
  const entries: Omit<LogEntry, "id">[] = [];

  const lines = body.split("\n");
  let current: (Omit<LogEntry, "id"> & { lineStart: number }) | null = null;

  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };

  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      flush();
      const head = parseHeading(line);
      if (!head) return;
      current = {
        ...head,
        gameUrl: null,
        themes: [],
        struggled: "",
        heldUp: "",
        workOn: "",
        lineStart: i,
      };
      return;
    }
    if (!current) return;

    for (const [prefix, field] of Object.entries(FIELDS)) {
      if (!line.startsWith(prefix)) continue;
      const value = line.slice(prefix.length).trim();
      if (field === "themes") {
        current.themes = value
          .split(",")
          .map((t) => t.trim().replace(/^`|`$/g, ""))
          .filter(Boolean);
      } else if (field === "gameUrl") {
        current.gameUrl = value || null;
      } else {
        current[field] = value;
      }
      return;
    }
  });
  flush();

  return { entries, vocab };
}

/** Truncate-and-reparse. The file is small; incremental sync would be more bug than benefit. */
export function rebuildIndex(): ParsedLog {
  let text: string;
  try {
    text = readFileSync(GAME_LOG_PATH, "utf8");
  } catch {
    text = ""; // No log yet — an empty index, not a crash.
  }
  const parsed = parseGameLog(text);
  const db = getDb();

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM log_entry_themes");
    db.exec("DELETE FROM log_entries");
    db.exec("DELETE FROM theme_vocab");

    const insVocab = db.prepare("INSERT INTO theme_vocab (tag, puzzle_themes) VALUES (?, ?)");
    for (const v of parsed.vocab) insVocab.run(v.tag, v.puzzleThemes.join(","));

    const insEntry = db.prepare(`
      INSERT INTO log_entries
        (heading_date, kind, colour, opponent, opponent_rating, opening, result,
         game_url, struggled, held_up, work_on, line_start, ordinal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insTheme = db.prepare("INSERT INTO log_entry_themes (entry_id, tag) VALUES (?, ?)");

    parsed.entries.forEach((e, ordinal) => {
      const { lastInsertRowid } = insEntry.run(
        e.date,
        e.kind,
        e.colour,
        e.opponent,
        e.opponentRating,
        e.opening,
        e.result,
        e.gameUrl,
        e.struggled,
        e.heldUp,
        e.workOn,
        (e as { lineStart?: number }).lineStart ?? 0,
        ordinal,
      );
      for (const tag of e.themes) insTheme.run(lastInsertRowid, tag);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return parsed;
}

/**
 * Rebuild whenever the agent appends an entry, so the trends view updates
 * mid-session without a restart. Editors often fire several events for one save,
 * hence the debounce.
 */
export function watchGameLog(onRebuild?: () => void): void {
  let timer: NodeJS.Timeout | null = null;
  try {
    watch(GAME_LOG_PATH, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          rebuildIndex();
          onRebuild?.();
        } catch (err) {
          console.error("[gamelog] rebuild failed:", err);
        }
      }, 150);
    });
  } catch (err) {
    console.error("[gamelog] cannot watch", GAME_LOG_PATH, err);
  }
}

export function listEntries(): LogEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, heading_date, kind, colour, opponent, opponent_rating, opening,
              result, game_url, struggled, held_up, work_on
         FROM log_entries ORDER BY ordinal ASC`,
    )
    .all() as Record<string, string | number | null>[];

  const themeStmt = getDb().prepare("SELECT tag FROM log_entry_themes WHERE entry_id = ?");
  return rows.map((r) => ({
    id: r.id as number,
    date: r.heading_date as string,
    kind: r.kind as LogEntry["kind"],
    colour: r.colour as string | null,
    opponent: r.opponent as string | null,
    opponentRating: r.opponent_rating as number | null,
    opening: r.opening as string | null,
    result: r.result as string | null,
    gameUrl: r.game_url as string | null,
    themes: (themeStmt.all(r.id) as { tag: string }[]).map((t) => t.tag),
    struggled: r.struggled as string,
    heldUp: r.held_up as string,
    workOn: r.work_on as string,
  }));
}

export function themeVocab(): Map<string, string[]> {
  const rows = getDb().prepare("SELECT tag, puzzle_themes FROM theme_vocab").all() as {
    tag: string;
    puzzle_themes: string;
  }[];
  return new Map(rows.map((r) => [r.tag, r.puzzle_themes ? r.puzzle_themes.split(",") : []]));
}

/**
 * The recurrence rule, implemented exactly as notes/game-log.md states it: a tag
 * is worth raising at three-or-more appearances, or in two of the last three
 * entries. Anything below that is noise, and the log is explicit that mentioning
 * it invents a pattern out of coincidence — so this returns null rather than
 * "the most common tag so far".
 */
export function countThemes(entries: Pick<LogEntry, "themes">[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    // A tag repeated on one entry is still one game.
    for (const tag of new Set(e.themes)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The recurrence rule, implemented exactly as notes/game-log.md states it: a tag
 * is worth raising at three-or-more appearances, or in two of the last three
 * entries. Anything below that is noise, and the log is explicit that mentioning
 * it invents a pattern out of coincidence — so this returns null rather than
 * "the most common tag so far".
 *
 * `entries` must be newest-first, matching the file's own ordering.
 */
export function pickRecurring(
  entries: Pick<LogEntry, "themes">[],
  vocab: Map<string, string[]>,
): Trends["recurring"] {
  const themeCounts = countThemes(entries);

  for (const { tag, count } of themeCounts) {
    if (count >= 3) {
      return { tag, count, reason: "three-or-more", puzzleThemes: vocab.get(tag) ?? [] };
    }
  }

  const recent = countThemes(entries.slice(0, 3));
  for (const { tag, count } of themeCounts) {
    if ((recent.find((r) => r.tag === tag)?.count ?? 0) >= 2) {
      return { tag, count, reason: "two-of-last-three", puzzleThemes: vocab.get(tag) ?? [] };
    }
  }

  return null;
}

export function computeTrends(): Trends {
  const entries = listEntries();
  const vocab = themeVocab();
  const themeCounts = countThemes(entries);
  const recurring = pickRecurring(entries, vocab);

  const ratingSeries = (
    getDb()
      .prepare(
        `SELECT played_at, speed,
                CASE user_color WHEN 'white' THEN white_rating ELSE black_rating END AS rating
           FROM games
          WHERE user_color IS NOT NULL AND rating IS NOT NULL
          ORDER BY played_at ASC`,
      )
      .all() as { played_at: number; speed: string; rating: number }[]
  ).map((r) => ({ playedAt: r.played_at, rating: r.rating, speed: r.speed }));

  return { themeCounts, recurring, ratingSeries, entryCount: entries.length };
}
