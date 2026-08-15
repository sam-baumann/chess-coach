/**
 * Finding position references in the coach's prose.
 *
 * Kept apart from the renderer because this is the part that can be wrong in a
 * way nobody notices: a pattern that is too greedy turns "version 1.2" into a
 * board jump, and one that is too strict leaves the FEN the user complained
 * about sitting there as slashes. Pure string in, matches out — so it is
 * testable without a DOM.
 */

/* Piece placement + side + castling + en passant. The move counters are
   optional: agents quote FENs with and without them, and the first four fields
   already identify the position. */
export const FEN_PATTERN = String.raw`(?:[rnbqkpRNBQKP1-8]{1,8}/){7}[rnbqkpRNBQKP1-8]{1,8}\s+[wb]\s+(?:K?Q?k?q?|-)\s+(?:-|[a-h][36])(?:\s+\d+\s+\d+)?`;

/* "13.Bxc6+", "13... Qc1+", "13. O-O". The dots carry the side to move, which
   is why these resolve exactly while a bare "move 13" has to guess. The
   destination square is required, which is what keeps "version 1.2" out. */
const NUMBERED = String.raw`(\d{1,3})\s*(\.{3}|\.)\s*(?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?`;

/* "move 13" / "moves 13" — no side, so the caller decides. */
const BARE = String.raw`\bmoves?\s+(\d{1,3})\b`;

const REF = new RegExp(`(${FEN_PATTERN})|(?:${NUMBERED})|(?:${BARE})`, "g");

/** True when the whole string is a FEN and nothing else. */
export function isBareFen(text: string): boolean {
  return new RegExp(`^${FEN_PATTERN}$`).test(text.trim());
}

export type Ref =
  | { kind: "fen"; start: number; end: number; raw: string }
  | { kind: "move"; start: number; end: number; raw: string; moveNumber: number; black: boolean | null };

/** Every position reference in `text`, in order, non-overlapping. */
export function findRefs(text: string): Ref[] {
  const out: Ref[] = [];
  REF.lastIndex = 0;

  for (let m = REF.exec(text); m; m = REF.exec(text)) {
    const [raw, fen, numbered, dots, bare] = m;
    const span = { start: m.index, end: m.index + raw.length, raw };

    if (fen !== undefined) {
      out.push({ kind: "fen", ...span });
    } else if (numbered !== undefined) {
      out.push({ kind: "move", ...span, moveNumber: Number(numbered), black: dots === "..." });
    } else if (bare !== undefined) {
      out.push({ kind: "move", ...span, moveNumber: Number(bare), black: null });
    }
  }
  return out;
}
