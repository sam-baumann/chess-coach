/**
 * Turning a position reference in the coach's prose into something the board can
 * do.
 *
 * Split out of the chat pane because this is the rule that decides whether a
 * click shows the right position, and getting it wrong is invisible: the board
 * moves either way. It used to resolve a numbered move by its number alone, so
 * "10.a3" — a move the game never played — put the played 10.Qb3 on the board
 * and captioned it a3. The notation, not the number, decides.
 */
import { plyLabel, plyOf, sameMove } from "./ply.ts";

/**
 * What a numbered move reference turns out to denote. The coach names the move
 * it wishes had been played as freely as the one that was, and the two have to
 * end up in different places: only one of them is a position the game holds.
 */
export type MoveTarget =
  | { kind: "game"; ply: number }
  /** Notation for a move the game didn't play, as written ("10.a3"). */
  | { kind: "variation"; line: string }
  | null;

export type Jump = {
  /** Board index for a FEN the sweep actually produced, or null if unknown. */
  resolveFen: (fen: string) => number | null;
  /** Where a numbered move reference points, or null if it points nowhere. */
  resolveMove: (moveNumber: number, black: boolean | null, san: string | null) => MoveTarget;
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
   * board's owner does — hence a line in, nothing back.
   */
  onVariation?: (line: string) => void;
};

export interface JumpContext {
  /** The game's positions, ply 0 first. Empty until the sweep has run. */
  fens: string[];
  /** The game's SAN moves. Available with or without a sweep. */
  moves: string[];
  userColor: "white" | "black" | null;
  onJump: (ply: number) => void;
  onFen: (fen: string) => void;
  onVariation: (line: string) => void;
}

/**
 * Without the sweep there are no scanned positions to jump to, so references
 * into the game resolve to null and stay plain text rather than becoming buttons
 * that do nothing — but a what-if resolves either way, since showing a position
 * the game never reached needs no scan.
 */
export function buildJump({
  fens,
  moves,
  userColor,
  onJump,
  onFen,
  onVariation,
}: JumpContext): Jump {
  const swept = fens.length > 1;

  // Keyed on the first four FEN fields: the half-move and full-move counters
  // differ between what the agent quotes and what the scan stored often enough
  // to matter, and they don't identify the position anyway.
  const key = (fen: string) => fen.trim().split(/\s+/).slice(0, 4).join(" ");
  const byFen = new Map(fens.map((f, i) => [key(f), i]));

  return {
    resolveFen: (fen) => (swept ? byFen.get(key(fen)) ?? null : null),

    resolveMove: (moveNumber, black, san) => {
      // A bare "move 13" doesn't say which side; the coach is nearly always
      // talking about the user's own move, so that is the reading taken.
      const side = black ?? userColor === "black";
      const ply = plyOf(moveNumber, side);
      if (ply < 1 || ply > moves.length) return null;

      // The move number alone cannot tell "the move you played" from "the move
      // that wins" — both are written `10.<something>` and land on the same ply.
      // Only the notation separates them, so it decides: the move on the
      // scoresheet moves the scrubber, any other move is a line to replay.
      if (san && !sameMove(san, moves[ply - 1])) {
        return { kind: "variation", line: `${moveNumber}${side ? "..." : "."}${san}` };
      }
      return swept && ply < fens.length ? { kind: "game", ply } : null;
    },

    label: (ply) => plyLabel(ply, moves),
    onJump,
    onFen,
    onVariation,
  };
}
