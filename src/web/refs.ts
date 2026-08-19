/**
 * Finding the FENs the coach quotes.
 *
 * Kept apart from the renderer because this is the part that can be wrong in a
 * way nobody notices — a pattern that is too strict leaves the FEN the user
 * complained about sitting there as slashes. Pure string in, matches out, so it
 * is testable without a DOM.
 *
 * Moves used to be found here too, by scanning the prose for "13.Bxc6+". They
 * are not any more: a move reference is now a tag the coach writes (see
 * lines.ts), because reading them out of prose meant demanding a move number on
 * every one — the only thing separating a move from "the d5 pawn" — and a move
 * inside a line has no number to demand. A FEN needs no such guard; nothing else
 * looks like one.
 */

/* Piece placement + side + castling + en passant. The move counters are
   optional: agents quote FENs with and without them, and the first four fields
   already identify the position. */
export const FEN_PATTERN = String.raw`(?:[rnbqkpRNBQKP1-8]{1,8}/){7}[rnbqkpRNBQKP1-8]{1,8}\s+[wb]\s+(?:K?Q?k?q?|-)\s+(?:-|[a-h][36])(?:\s+\d+\s+\d+)?`;

const REF = new RegExp(FEN_PATTERN, "g");

/** True when the whole string is a FEN and nothing else. */
export function isBareFen(text: string): boolean {
  return new RegExp(`^${FEN_PATTERN}$`).test(text.trim());
}

export interface Ref {
  start: number;
  end: number;
  raw: string;
}

/** Every FEN in `text`, in order, non-overlapping. */
export function findRefs(text: string): Ref[] {
  const out: Ref[] = [];
  REF.lastIndex = 0;
  for (let m = REF.exec(text); m; m = REF.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return out;
}
