import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { REPO_ROOT } from "./config.ts";
import { scanPath } from "./sweep.ts";

const run = promisify(execFile);

/**
 * Board diagrams and the evaluation trace come from the game-review skill's own
 * scripts rather than being reimplemented in React.
 *
 * Both encode decisions that are easy to get subtly wrong and were already got
 * right once: render_board.py uses the solid Unicode glyph set for both colours
 * (the outline set renders faintly and inconsistently across system fonts) and
 * knows a square is dark when row+col is odd; eval_trace.py draws a *diverging*
 * two-fill chart around the midline, which a single-fill area chart would erase.
 * Shelling out keeps one implementation of each.
 *
 * Invoked through `uv run`, per CLAUDE.md, so these two call sites keep working
 * if either script ever grows a third-party import (preview.py in the same skill
 * directory already needs one).
 */

const BOARD_SCRIPT = ".claude/skills/game-review/scripts/render_board.py";
const TRACE_SCRIPT = ".claude/skills/game-review/scripts/eval_trace.py";
const REPLAY_SCRIPT = ".claude/skills/game-review/scripts/replay_line.py";

export async function boardHtml(
  fen: string,
  highlight: string[] = [],
  flip = false,
  caption = "",
): Promise<string> {
  const args = [BOARD_SCRIPT, fen, "--highlight", highlight.join(",")];
  if (flip) args.push("--flip");
  if (caption) args.push("--caption", caption);
  const { stdout } = await run("uv", ["run", "python", ...args], { cwd: REPO_ROOT, maxBuffer: 1 << 20 });
  return stdout;
}

export async function traceSvg(gameId: string, marks: string[] = [], aria = ""): Promise<string> {
  const args = [TRACE_SCRIPT, scanPath(gameId), "--mark", marks.join(",")];
  if (aria) args.push("--aria", aria);
  const { stdout } = await run("uv", ["run", "python", ...args], { cwd: REPO_ROOT, maxBuffer: 4 << 20 });
  return stdout;
}

/**
 * The position after a move the game did not play — "10.a3" against the game
 * that answered 10.Qb3.
 *
 * Same reason as the two above: replay_line.py already knows how to read a move
 * number as a branch point, which square a bare SAN means in that position, and
 * how to say *where* an illegal line broke. Re-deriving that in TypeScript would
 * mean a second SAN parser, and the second one is the one that is wrong.
 *
 * One half-move is all a single notation reference can name, so the replay is
 * capped there rather than following a whole line the coach didn't write.
 */
export async function variationFen(
  moves: string,
  line: string,
): Promise<{ fen: string; label: string; fromPly: number }> {
  const { stdout } = await run(
    "uv",
    ["run", "--with", "chess", "python", REPLAY_SCRIPT, "--moves", moves, "--line", line, "--max", "1"],
    { cwd: REPO_ROOT, maxBuffer: 1 << 20 },
  );
  const payload = JSON.parse(stdout) as {
    startPly: number;
    steps: { san: string; label: string; fen: string }[];
  };
  const step = payload.steps[0];
  if (!step) throw new Error(`no move to replay in "${line}"`);
  return { fen: step.fen, label: step.label, fromPly: payload.startPly };
}
