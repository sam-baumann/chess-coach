/**
 * Reading scan_game.py's centipawn numbers back out as a human score.
 *
 * The scan folds mates onto the centipawn scale (MATE_BASE − 100·distance) so
 * losses stay sortable, which means a raw row value of 99_600 is not "+996.00"
 * but mate in four. Undoing that fold is the whole reason this isn't an inline
 * `/ 100`.
 *
 * Always White's point of view, like the trace it sits on: the eval bar every
 * chess site shows works that way, and a readout that silently flipped with the
 * side to move would make the number disagree with the chart beneath it.
 */

/** scan_game.py's MATE_BASE. */
const MATE_BASE = 100_000;
/** Its is_mate_score() threshold. */
const MATE_CUTOFF = MATE_BASE - 10_000;

/** "+1.25", "−0.40", "0.00", "M4" (White mates), "−M3", "#" (mate on the board). */
export function formatEval(cp: number | null | undefined): string | null {
  if (cp == null || !Number.isFinite(cp)) return null;

  if (Math.abs(cp) > MATE_CUTOFF) {
    const distance = Math.round((MATE_BASE - Math.abs(cp)) / 100);
    // Distance 0 is the mate itself — the position on the board is checkmate,
    // and "M0" reads like a countdown that hasn't finished.
    if (distance === 0) return "#";
    return `${cp < 0 ? "−" : ""}M${distance}`;
  }

  const pawns = cp / 100;
  // U+2212 for the minus sign: it matches the width of "+" in a monospace face,
  // so the readout doesn't jitter as the sign changes.
  const sign = pawns > 0 ? "+" : pawns < 0 ? "−" : "";
  return `${sign}${Math.abs(pawns).toFixed(2)}`;
}

/** The long form, for the readout's title: "White is a pawn and a half up". */
export function describeEval(cp: number | null | undefined): string {
  const text = formatEval(cp);
  if (text === null) return "No evaluation for this position";
  if (text === "#") return "Checkmate";
  if (text.includes("M")) {
    return `${cp! < 0 ? "Black" : "White"} mates in ${text.replace(/[^0-9]/g, "")}`;
  }
  if (cp === 0) return "Level, from White's point of view";
  return `${text} pawns, from White's point of view`;
}
