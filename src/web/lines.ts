/**
 * Lines the coach declares, and the half-moves they name.
 *
 * "After 14... d5 15.Nxd4 dxc4 16.bxc4 the centre has gone" names four positions
 * that exist only because of the moves before them. Notation cannot say that on
 * its own — read against the real game, 15.Nxd4 asks for a knight captured two
 * plies earlier — so the coach states the line rather than leaving it to be
 * inferred, in a fenced block the reader never sees:
 *
 *     ```line id=A
 *     14... d5 15.Nxd4 dxc4 16.bxc4
 *     ```
 *
 * The moves are pasted from the engine's own PV (probe_moments.py prints them in
 * exactly this shape), so a declared line is a line something actually played,
 * not one composed by hand. A line may continue another (`from=<id>@<move>`),
 * which is expanded here into one flat line so nothing downstream has to know
 * about the chaining. The block carries notation and nothing else — no FENs:
 * turning notation into positions is replay_line.py's job on the server, which
 * is the only SAN parser in the project and stays that way.
 *
 * Which half-move a given sentence means is stated too, never inferred: the
 * coach tags each mention with the line and the move it names — `[dxc4](A:14:..)`
 * — and parseTag below reads those. Prose is not scanned for moves at all, which
 * is why `dxc4` needs no move number to be a link and why "the d5 pawn" cannot
 * accidentally become one.
 */

/** Half-move prefixes: "14.", "14...", "14…", glued to the move or standing alone. */
const PREFIX = /^(\d{1,3})\s*(\.{3}|…|\.)\s*/;
/** "!", "?", "!?" and trailing punctuation are commentary; "+"/"#" are the move. */
const SUFFIX = /[!?]+[,;)]?$|[,;)]$/;
/** Anchored: a move and nothing else. */
const SAN = /^(?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;

/** How many half-moves of a declared line are kept — long enough for any point worth making. */
export const MAX_STEPS = 24;

export interface LineStep {
  /** Board index *after* this half-move, so it compares directly with plyOf(). */
  ply: number;
  san: string;
}

export interface DeclaredLine {
  /** The block's `id=`, for another line to continue from. Null when it names none. */
  id: string | null;
  /**
   * The line as one flat sequence, inherited prefix included — this is what the
   * server replays and what the board is captioned with.
   */
  notation: string;
  steps: LineStep[];
}

/** The `key=value` pairs on the fence's info string, minus the leading `line`. */
function attrs(info: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const token of info.trim().split(/\s+/).slice(1)) {
    const eq = token.indexOf("=");
    if (eq > 0) out.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return out;
}

/** True when a fenced block is a line declaration rather than code to show. */
export function isLineBlock(info: string): boolean {
  return info.trim().split(/\s+/)[0] === "line";
}

/**
 * ('14... d5 15.Nxd4') → { start: 28, sans: ['d5', 'Nxd4'] }, or null.
 *
 * `start` is the board index the line branches from and is read off the first
 * move's number, the same reading replay_line.py takes: "14..." is the position
 * after White's 14th, which is the only one that makes the line an alternative
 * to what happened. It is null when no number was written, which is legitimate
 * only for a line that continues another.
 */
function tokenise(text: string): { start: number | null; sans: string[] } | null {
  let start: number | null = null;
  const sans: string[] = [];

  for (const raw of text.replace(/…/g, "...").split(/\s+/)) {
    let token = raw;
    for (let m = PREFIX.exec(token); m; m = PREFIX.exec(token)) {
      if (start === null && sans.length === 0) {
        const number = Number(m[1]);
        const black = m[2] !== ".";
        if (number < 1) return null;
        start = (number - 1) * 2 + (black ? 1 : 0);
      }
      token = token.slice(m[0].length);
    }
    token = token.replace(SUFFIX, "").trim();
    if (!token) continue;
    // One bad token invalidates the whole declaration rather than silently
    // shortening it: a line missing its third move would put every later
    // reference on the position before the one it names.
    if (!SAN.test(token)) return null;
    sans.push(token);
  }

  return sans.length ? { start, sans } : null;
}

/** Rebuild scoresheet notation from plies, so the caption reads as the coach wrote it. */
function serialise(steps: LineStep[]): string {
  return steps
    .map((step, i) => {
      const white = step.ply % 2 === 1;
      const number = Math.ceil(step.ply / 2);
      // Numbered on every White move, plus the first move whichever side it is —
      // otherwise a line starting with Black's move loses its only number and
      // cannot be placed in the game at all.
      if (white) return `${number}.${step.san}`;
      return i === 0 ? `${number}...${step.san}` : step.san;
    })
    .join(" ");
}

/**
 * One `line` block into the steps it names, or null if it cannot be read.
 *
 * `earlier` is the lines already declared in the same message, which is what a
 * `from=` continuation is resolved against — forward references would mean
 * reading the whole message before rendering any of it, and the coach writes the
 * branch before the branch off it anyway.
 */
export function parseDeclaration(
  info: string,
  content: string,
  earlier: DeclaredLine[],
): DeclaredLine | null {
  const attr = attrs(info);
  const id = attr.get("id") ?? null;
  const parsed = tokenise(content);
  if (!parsed) return null;

  let prefix: LineStep[] = [];
  const from = attr.get("from");
  if (from) {
    const [parentId, after] = from.split("@");
    const parent = earlier.find((line) => line.id === parentId);
    if (!parent) return null;
    if (after === undefined) {
      prefix = parent.steps;
    } else {
      // The cut is named by the move, not by an index: "from=A@12.Qd2" survives
      // the coach rewriting A, and an index does not.
      const target = after.replace(PREFIX, "").replace(SUFFIX, "");
      const at = parent.steps.findIndex((step) => step.san === target);
      if (at === -1) return null;
      prefix = parent.steps.slice(0, at + 1);
    }
  }

  // A line that continues another needs no number of its own; one that doesn't
  // has nowhere to branch from without one.
  const start = prefix.length ? prefix[prefix.length - 1].ply : parsed.start;
  if (start === null || start < 0) return null;

  const own = parsed.sans.map((san, i) => ({ ply: start + i + 1, san }));
  const steps = [...prefix, ...own].slice(0, MAX_STEPS);
  return { id, notation: serialise(steps), steps };
}

/** The line id a reference to the game as played uses, rather than a declared line. */
export const GAME = "game";

export interface Tag {
  /** A declared line's `id=`, or GAME for the move actually played. */
  line: string;
  moveNumber: number;
  black: boolean;
}

/**
 * The href of a tagged move — `A:14:..`, `game:14:.` — or null for anything else.
 *
 * The move number and side are carried rather than derived because a line can
 * play the same move twice ("dxc4" by White and then by Black), and the notation
 * alone cannot say which one a sentence means. Three dots are accepted for Black
 * alongside two, since that is how the coach writes them everywhere else.
 */
export function parseTag(href: string): Tag | null {
  const m = /^([A-Za-z0-9_-]{1,32}):(\d{1,3}):(\.{1,3})$/.exec(href.trim());
  if (!m) return null;
  const moveNumber = Number(m[2]);
  if (moveNumber < 1) return null;
  return { line: m[1], moveNumber, black: m[3] !== "." };
}
