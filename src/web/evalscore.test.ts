import assert from "node:assert/strict";
import test from "node:test";
import { describeEval, formatEval } from "./evalscore.ts";

test("centipawns read as pawns, always signed", () => {
  assert.equal(formatEval(125), "+1.25");
  assert.equal(formatEval(-40), "−0.40");
  assert.equal(formatEval(0), "0.00");
  // Rounding is to two places, not truncation: -1 cp is still a drawn position.
  assert.equal(formatEval(-1), "−0.01");
});

test("mate scores are unfolded rather than shown as ±996 pawns", () => {
  // scan_game.py folds mate onto the cp scale as MATE_BASE - 100·distance, so
  // these are the numbers actually sitting in a scan row.
  assert.equal(formatEval(100_000 - 400), "M4");
  assert.equal(formatEval(-(100_000 - 300)), "−M3");
  // The terminal position of a won game: MATE_BASE exactly, mate already on.
  assert.equal(formatEval(100_000), "#");
  assert.equal(formatEval(-100_000), "#");
});

test("a decisive but finite advantage stays a pawn count", () => {
  // Just under the mate cutoff — a huge material edge, not a forced mate.
  assert.equal(formatEval(89_000), "+890.00");
});

test("no evaluation is null rather than a zero", () => {
  assert.equal(formatEval(null), null);
  assert.equal(formatEval(undefined), null);
  assert.equal(formatEval(NaN), null);
});

test("the long form names the side", () => {
  assert.equal(describeEval(100_000 - 400), "White mates in 4");
  assert.equal(describeEval(-(100_000 - 300)), "Black mates in 3");
  assert.equal(describeEval(0), "Level, from White's point of view");
  assert.equal(describeEval(125), "+1.25 pawns, from White's point of view");
  assert.equal(describeEval(null), "No evaluation for this position");
});
