import assert from "node:assert/strict";
import test from "node:test";
import { findRefs, isBareFen } from "./refs.ts";
import { plyLabel, plyOf, sameMove } from "./ply.ts";

const raws = (s: string) => findRefs(s).map((r) => r.raw);

test("a quoted FEN is found, with or without the move counters", () => {
  const withCounters = "r3kb1r/pQ1b1ppp/2p1p3/3pP3/8/2P5/PP2KPPP/RNq3NR b kq - 5 13";
  assert.deepEqual(raws(withCounters), [withCounters]);

  const without = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
  assert.deepEqual(raws(without), [without]);

  // The counters are not part of the identity, so both forms must reduce to the
  // same lookup key the chat pane builds.
  assert.ok(isBareFen(withCounters));
  assert.ok(isBareFen(`  ${without}\n`));
});

test("prose around a FEN is not swallowed", () => {
  const fen = "r3kb1r/pQ1b1ppp/2p1p3/3pP3/8/2P5/PP2KPPP/RNq3NR b kq - 5 13";
  const refs = findRefs(`The position ${fen} is lost.`);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].raw, fen);
  assert.equal(refs[0].start, "The position ".length);
  assert.ok(!isBareFen(`The position ${fen} is lost.`));
});

test("numbered moves carry the side to move", () => {
  const refs = findRefs("You played 13. Ke2, and after 13...Qc1+ it was over.");
  assert.deepEqual(
    refs.map((r) => (r.kind === "move" ? [r.moveNumber, r.black] : r.kind)),
    [
      [13, false],
      [13, true],
    ],
  );
});

test("a numbered move carries the move it names, not just its number", () => {
  // The whole point: "10.a3" and "10.Qb3" are the same number and the same ply,
  // and only one of them is the move the game played. Without the SAN the two
  // are indistinguishable, which is how a what-if used to put the *played*
  // position on the board.
  const refs = findRefs("You played 10.Qb3; 10.a3 was the move.");
  assert.deepEqual(
    refs.map((r) => (r.kind === "move" ? r.san : null)),
    ["Qb3", "a3"],
  );

  // A bare "move 13" names no move, so it has none to carry.
  const bare = findRefs("around move 13")[0];
  assert.equal(bare.kind === "move" && bare.san, null);
});

test("check and annotation marks don't make two spellings of one move differ", () => {
  assert.ok(sameMove("Qb5+", "Qb5"));
  assert.ok(sameMove("Bg5!", "Bg5"));
  assert.ok(sameMove("exd8=Q+", "exd8=Q"));
  // Disambiguation is part of the move's identity, not commentary.
  assert.ok(!sameMove("Ngf3", "Nbf3"));
  assert.ok(!sameMove("Qb5", "Qb4"));
  assert.ok(!sameMove("a3", null));
});

test("castling, captures, promotions and check marks all parse", () => {
  assert.deepEqual(raws("20... O-O-O then 21.O-O and 30.exd8=Q+ and 31...Rxa1#"), [
    "20... O-O-O",
    "21.O-O",
    "30.exd8=Q+",
    "31...Rxa1#",
  ]);
  // The SAN comes back without the number and dots, ready to compare against a
  // scoresheet entry.
  assert.deepEqual(
    findRefs("20... O-O-O then 21.O-O and 30.exd8=Q+ and 31...Rxa1#").map((r) =>
      r.kind === "move" ? r.san : null,
    ),
    ["O-O-O", "O-O", "exd8=Q+", "Rxa1#"],
  );
});

test("a bare move number defers the side to the caller", () => {
  const refs = findRefs("The trouble starts around move 13.");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind === "move" && refs[0].black, null);
  assert.equal(refs[0].kind === "move" && refs[0].moveNumber, 13);
});

test("decimals and prose are left alone", () => {
  // The destination square is what keeps these out: "1.2" has no square.
  assert.deepEqual(raws("version 1.2, up from 3.4 — a 2.5x speedup"), []);
  assert.deepEqual(raws("Nothing here but prose about pawn structure."), []);
  assert.deepEqual(raws("Rated 1134 vs 1126 in a rapid game."), []);
});

test("references come back in order and never overlap", () => {
  const refs = findRefs("13.Bxc6+ then 14.Qa4 then move 20");
  assert.equal(refs.length, 3);
  for (let i = 1; i < refs.length; i++) {
    assert.ok(refs[i].start >= refs[i - 1].end, "refs overlap");
  }
});

test("ply arithmetic matches the scoresheet", () => {
  // Ply 0 is the start, so White's 13th is ply 25 and Black's reply is 26.
  assert.equal(plyOf(1, false), 1);
  assert.equal(plyOf(13, false), 25);
  assert.equal(plyOf(13, true), 26);

  const moves = ["e4", "c6", "e5", "d5"];
  assert.equal(plyLabel(0, moves), "start");
  assert.equal(plyLabel(1, moves), "1. e4");
  assert.equal(plyLabel(2, moves), "1... c6");
  assert.equal(plyLabel(4, moves), "2... d5");
  // Past the end of the move list the number still reads, with no dangling
  // space where the missing SAN would have gone.
  assert.equal(plyLabel(99, moves), "50.");
});
