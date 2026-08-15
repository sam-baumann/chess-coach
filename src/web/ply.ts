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
