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
 */

const BOARD_SCRIPT = ".claude/skills/game-review/scripts/render_board.py";
const TRACE_SCRIPT = ".claude/skills/game-review/scripts/eval_trace.py";

export async function boardHtml(
  fen: string,
  highlight: string[] = [],
  flip = false,
  caption = "",
): Promise<string> {
  const args = [BOARD_SCRIPT, fen, "--highlight", highlight.join(",")];
  if (flip) args.push("--flip");
  if (caption) args.push("--caption", caption);
  const { stdout } = await run("python3", args, { cwd: REPO_ROOT, maxBuffer: 1 << 20 });
  return stdout;
}

export async function traceSvg(gameId: string, marks: string[] = [], aria = ""): Promise<string> {
  const args = [TRACE_SCRIPT, scanPath(gameId), "--mark", marks.join(",")];
  if (aria) args.push("--aria", aria);
  const { stdout } = await run("python3", args, { cwd: REPO_ROOT, maxBuffer: 4 << 20 });
  return stdout;
}
