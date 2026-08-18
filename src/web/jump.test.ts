import assert from "node:assert/strict";
import test from "node:test";
import { buildJump } from "./jump.ts";

/* The opening of a real game the coach reviewed. What matters is that every
   move here shares its number with the move the coach wished had been played
   instead — that collision is the whole difficulty. */
const MOVES = "e4 e5 Nf3 Nc6 c3 d5 Qa4 Nf6 exd5 Nd4 Qd1 Nxf3+ Qxf3 e4 Qe3 Na5 Bc4 Nxc4".split(" ");
const context = (over: Partial<Parameters<typeof buildJump>[0]> = {}) =>
  buildJump({
    // One entry per ply plus the start, which is all resolveMove reads of it.
    fens: Array.from({ length: MOVES.length + 1 }, (_, i) => `fen-${i}`),
    moves: MOVES,
    userColor: "white",
    onJump: () => {},
    onFen: () => {},
    onVariation: () => {},
    ...over,
  });

test("notation matching the scoresheet moves the scrubber", () => {
  const jump = context();
  // White's 3rd was c3, which is ply 5; Black's 5th was Nd4, ply 10.
  assert.deepEqual(jump.resolveMove(3, false, "c3"), { kind: "game", ply: 5 });
  assert.deepEqual(jump.resolveMove(5, true, "Nd4"), { kind: "game", ply: 10 });
  // The scoresheet says "Nxf3+"; a coach who drops the check mark still means
  // the move that was played, not an alternative to it.
  assert.deepEqual(jump.resolveMove(6, true, "Nxf3"), { kind: "game", ply: 12 });
});

test("notation the game didn't play is a variation, not the same ply", () => {
  const jump = context();
  // The bug: 3.d4 and the played 3.c3 are both "White's 3rd" and used to be the
  // same reference, so clicking the move that *should* have been played put the
  // move that *was* played on the board.
  assert.deepEqual(jump.resolveMove(3, false, "d4"), { kind: "variation", line: "3.d4" });
  assert.deepEqual(jump.resolveMove(5, true, "Qe7"), { kind: "variation", line: "5...Qe7" });
});

test("a bare move number still means the ply, since it names no move", () => {
  assert.deepEqual(context().resolveMove(5, null, null), { kind: "game", ply: 9 });
  // No side given: the coach is taken to mean the user's own move, so the same
  // "move 5" lands a half-move later when the user had Black.
  assert.deepEqual(context({ userColor: "black" }).resolveMove(5, null, null), {
    kind: "game",
    ply: 10,
  });
});

test("references past the end of the game resolve to nothing", () => {
  const jump = context();
  assert.equal(jump.resolveMove(40, false, "Qa1"), null);
  assert.equal(jump.resolveMove(0, false, "e4"), null);
});

test("without a sweep the game is unreachable but a what-if still is not", () => {
  const jump = context({ fens: [] });
  // Nothing to scrub to, so notation for the played move stays plain text.
  assert.equal(jump.resolveMove(3, false, "c3"), null);
  assert.equal(jump.resolveFen("fen-9"), null);
  // Replaying a variation needs only the move list, so this still resolves.
  assert.deepEqual(jump.resolveMove(3, false, "d4"), { kind: "variation", line: "3.d4" });
});

test("a FEN resolves on the first four fields, ignoring the counters", () => {
  const real = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3";
  const jump = buildJump({
    fens: ["start", real],
    moves: MOVES,
    userColor: "white",
    onJump: () => {},
    onFen: () => {},
    onVariation: () => {},
  });
  assert.equal(jump.resolveFen(real.replace("4 3", "0 9")), 1);
  assert.equal(jump.resolveFen(real.split(" ").slice(0, 4).join(" ")), 1);
  assert.equal(jump.resolveFen("8/8/8/8/8/8/8/K6k w - -"), null);
});
