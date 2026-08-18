/**
 * Ply arithmetic, shared by the board nav and the chat's position links.
 *
 * A "ply" here is the board index: 0 is the starting position, ply N is the
 * position *after* N half-moves. Move 13 for White is therefore ply 25, and
 * 13... for Black is ply 26.
 */

/** Board index for a numbered move, e.g. (13, false) → 25 for White's 13th. */
export function plyOf(moveNumber: number, black: boolean): number {
  return (moveNumber - 1) * 2 + (black ? 2 : 1);
}

/** "start", or "13. Bxc6+" / "13... Qc1+" — the scoresheet's own notation. */
export function plyLabel(ply: number, moves: string[]): string {
  if (ply <= 0) return "start";
  const san = moves[ply - 1];
  const dots = ply % 2 ? "." : "...";
  return `${Math.ceil(ply / 2)}${dots}${san ? ` ${san}` : ""}`;
}

/**
 * Whether two SANs name the same move — "13.Qb5+" against the scoresheet's
 * "Qb5+".
 *
 * Lenient about the parts that are commentary rather than move: check and mate
 * marks are dropped by some writers and added by others, and `!?` annotations
 * are the coach's opinion. Everything that identifies the move — piece,
 * disambiguation, capture, square, promotion — has to match exactly, because
 * treating a near-miss as the played move is how a what-if ends up silently
 * showing the position it is an alternative to.
 */
export function sameMove(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bare = (san: string) => san.replace(/[!?]+$/, "").replace(/[+#]$/, "");
  return bare(a) === bare(b);
}
