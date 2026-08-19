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

test("notation in prose is prose", () => {
  // Moves used to be found here. They are tagged links now, so nothing in a
  // sentence is a reference on the strength of looking like a move — which is
  // what lets the coach write "dxc4" and "the d5 pawn" in the same paragraph.
  assert.deepEqual(raws("You played 13. Ke2, and after 13...Qc1+ it was over."), []);
  assert.deepEqual(raws("20... O-O-O then 21.O-O and 30.exd8=Q+ and 31...Rxa1#"), []);
  assert.deepEqual(raws("The trouble starts around move 13."), []);
  assert.deepEqual(raws("version 1.2, up from 3.4 — a 2.5x speedup"), []);
});

test("check and annotation marks don't make two spellings of one move differ", () => {
  // Used against a tag's link text, which the coach writes by hand.
  assert.ok(sameMove("Qb5+", "Qb5"));
  assert.ok(sameMove("Bg5!", "Bg5"));
  assert.ok(sameMove("exd8=Q+", "exd8=Q"));
  // Disambiguation is part of the move's identity, not commentary.
  assert.ok(!sameMove("Ngf3", "Nbf3"));
  assert.ok(!sameMove("Qb5", "Qb4"));
  assert.ok(!sameMove("a3", null));
});

test("references come back in order and never overlap", () => {
  const one = "r3kb1r/pQ1b1ppp/2p1p3/3pP3/8/2P5/PP2KPPP/RNq3NR b kq - 5 13";
  const two = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
  const refs = findRefs(`before ${one} between ${two} after`);
  assert.equal(refs.length, 2);
  assert.ok(refs[1].start >= refs[0].end, "refs overlap");
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
