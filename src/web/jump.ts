/**
 * Turning a position reference in the coach's prose into something the board can
 * do.
 *
 * Split out of the chat pane because this is the rule that decides whether a
 * click shows the right position, and getting it wrong is invisible: the board
 * moves either way.
 *
 * There are exactly two kinds of reference, and both are stated by the coach
 * rather than recognised in the prose. A tagged move — `[dxc4](A:14:..)` — names
 * the line it belongs to (`game` for the move actually played), its move number
 * and its side, which is everything needed to point at one half-move; see
 * lines.ts. A quoted FEN names a position outright. Nothing else in a message is
 * a reference, so notation the coach didn't tag stays the text the user reads,
 * and the wrong-position bugs this file used to be about — a move number
 * matching the played move and the suggested one, a move inside a line whose
 * position the game never held — can no longer be expressed.
 */
import { GAME, type DeclaredLine, type Tag } from "./lines.ts";
import { plyLabel, plyOf, sameMove } from "./ply.ts";

/** What a tagged move turns out to denote. */
export type MoveTarget =
  | { kind: "game"; ply: number }
  /**
   * A position off the game: the whole line to replay, and which half-move of it
   * the tag named. The moves before it are what make the position exist.
   */
  | { kind: "variation"; line: string; step: number }
  | null;

export type Jump = {
  /** Board index for a FEN the sweep actually produced, or null if unknown. */
  resolveFen: (fen: string) => number | null;
  /**
   * Where a tagged move points, or null if it points nowhere. `text` is what the
   * link says, checked against the move the tag names; `lines` are the message's
   * declarations.
   */
  resolveTag: (tag: Tag, text: string, lines: DeclaredLine[]) => MoveTarget;
  /** Scoresheet notation for a board index, used as the link's text. */
  label: (ply: number) => string;
  onJump: (ply: number) => void;
  /**
   * Put a position that isn't in the game on the board — the coach's "what if",
   * quoted as a FEN. There is no ply for these, so they can't go through onJump.
   */
  onFen?: (fen: string) => void;
  /**
   * The same, for a what-if written as notation rather than a FEN. The position
   * has to be replayed from the line before it can be shown, which is work the
   * board's owner does — hence a line in, nothing back. `step` is the half-move
   * of that line to stop at, counting from 0.
   */
  onVariation?: (line: string, step: number) => void;
};

export interface JumpContext {
  /** The game's positions, ply 0 first. Empty until the sweep has run. */
  fens: string[];
  /** The game's SAN moves. Available with or without a sweep. */
  moves: string[];
  onJump: (ply: number) => void;
  onFen: (fen: string) => void;
  onVariation: (line: string, step: number) => void;
}

/**
 * Without the sweep there are no scanned positions to jump to, so references
 * into the game resolve to null and stay plain text rather than becoming buttons
 * that do nothing — but a move in a declared line resolves either way, since
 * showing a position the game never reached needs no scan.
 */
export function buildJump({ fens, moves, onJump, onFen, onVariation }: JumpContext): Jump {
  const swept = fens.length > 1;

  // Keyed on the first four FEN fields: the half-move and full-move counters
  // differ between what the agent quotes and what the scan stored often enough
  // to matter, and they don't identify the position anyway.
  const key = (fen: string) => fen.trim().split(/\s+/).slice(0, 4).join(" ");
  const byFen = new Map(fens.map((f, i) => [key(f), i]));

  return {
    resolveFen: (fen) => (swept ? byFen.get(key(fen)) ?? null : null),

    resolveTag: (tag, text, lines) => {
      const ply = plyOf(tag.moveNumber, tag.black);

      if (tag.line === GAME) {
        if (ply < 1 || ply > moves.length || !swept || ply >= fens.length) return null;
        return agrees(text, moves[ply - 1]) ? { kind: "game", ply } : null;
      }

      const line = lines.find((l) => l.id === tag.line);
      if (!line) return null;
      const step = line.steps.findIndex((s) => s.ply === ply);
      if (step === -1 || !agrees(text, line.steps[step].san)) return null;
      return { kind: "variation", line: line.notation, step };
    },

    label: (ply) => plyLabel(ply, moves),
    onJump,
    onFen,
    onVariation,
  };
}

/**
 * Whether a link's text is consistent with the move its tag points at.
 *
 * The tag says *where* and the text says *what*, so a disagreement means one of
 * them is wrong and there is no way to tell which — a mislabelled tag then costs
 * the link rather than showing a position the sentence isn't about. Text that
 * isn't notation at all ("the knight jump") makes no claim to check, and passes.
 */
function agrees(text: string, san: string): boolean {
  const written = /^\s*(?:\d{1,3}\s*(?:\.{1,3}|…)\s*)?(\S+?)\s*$/.exec(text)?.[1];
  if (!written || !/^[KQRBNOa-h]/.test(written)) return true;
  return sameMove(written, san);
}
