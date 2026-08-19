import assert from "node:assert/strict";
import test from "node:test";
import { isLineBlock, parseDeclaration, parseTag } from "./lines.ts";

/* The line from the review that this whole mechanism exists for: the coach's
   refutation of 14.e5, three of whose four half-moves are positions the game
   never held. */
const REFUTATION = "14... d5 15.Nxd4 dxc4 16.bxc4";

test("a declared line places every half-move at its own ply", () => {
  const line = parseDeclaration("line", REFUTATION, []);
  assert.ok(line);
  // "14..." branches after White's 14th, which is ply 27, so Black's d5 lands on
  // 28 and each half-move after it advances by one.
  assert.deepEqual(line.steps, [
    { ply: 28, san: "d5" },
    { ply: 29, san: "Nxd4" },
    { ply: 30, san: "dxc4" },
    { ply: 31, san: "bxc4" },
  ]);
  // Re-numbered from the plies, so what the board is captioned with reads as a
  // scoresheet whatever spacing the coach used.
  assert.equal(line.notation, "14...d5 15.Nxd4 dxc4 16.bxc4");
});

test("commentary and spacing come off; the move does not", () => {
  const line = parseDeclaration("line", "13. Bg5!? Nxe4?! 14.Qxd8+", []);
  assert.ok(line);
  assert.deepEqual(
    line.steps.map((s) => s.san),
    ["Bg5", "Nxe4", "Qxd8+"],
  );
});

test("a line continuing another inherits the moves up to the branch", () => {
  const first = parseDeclaration("line id=A", "11.Nxd4 Bxd4 12.Qd2", []);
  assert.ok(first);
  const second = parseDeclaration("line id=B from=A@Bxd4", "12.c3 Bb6", [first]);
  assert.ok(second);
  // The shared prefix is expanded away, so nothing downstream has to know one
  // line was written as a continuation of another.
  assert.equal(second.notation, "11.Nxd4 Bxd4 12.c3 Bb6");
  assert.deepEqual(second.steps.map((s) => s.ply), [21, 22, 23, 24]);
  // Naming the branch move by its number as well is the same cut.
  const alias = parseDeclaration("line from=A@11.Nxd4", "Nd7", [first]);
  assert.equal(alias?.notation, "11.Nxd4 Nd7");
});

test("a continuation of a line that isn't there is not a line", () => {
  const first = parseDeclaration("line id=A", "11.Nxd4 Bxd4", []);
  assert.ok(first);
  assert.equal(parseDeclaration("line from=Z@Bxd4", "12.c3", [first]), null);
  assert.equal(parseDeclaration("line from=A@Qh5", "12.c3", [first]), null);
});

test("a line with no move number has nowhere to branch from", () => {
  assert.equal(parseDeclaration("line", "Nxd4 exd4 Bg5", []), null);
  // Unless it continues one that does.
  const first = parseDeclaration("line id=A", "11.Nxd4", []);
  assert.ok(first);
  assert.equal(parseDeclaration("line from=A", "Bxd4 c3", [first])?.notation, "11.Nxd4 Bxd4 12.c3");
});

test("a token that isn't a move invalidates the whole declaration", () => {
  // Not shortened to the good prefix: a line missing its third move would put
  // every later reference one position early, which is exactly the silent kind
  // of wrong this replaced.
  assert.equal(parseDeclaration("line", "14...d5 15.Nxd4 winning dxc4", []), null);
  assert.equal(parseDeclaration("line", "", []), null);
  assert.equal(parseDeclaration("line", "14...", []), null);
});

test("only a `line` fence is a declaration", () => {
  assert.equal(isLineBlock("line"), true);
  assert.equal(isLineBlock("line id=A from=B@Nxd4"), true);
  assert.equal(isLineBlock("bash"), false);
  assert.equal(isLineBlock(""), false);
  // A fence whose info merely starts with the letters is someone's code.
  assert.equal(isLineBlock("lines"), false);
});

test("a move tag names a line, a move number and a side", () => {
  assert.deepEqual(parseTag("A:14:.."), { line: "A", moveNumber: 14, black: true });
  assert.deepEqual(parseTag("A:15:."), { line: "A", moveNumber: 15, black: false });
  // Three dots for Black too — it is how the coach writes them everywhere else.
  assert.deepEqual(parseTag("game:14:..."), { line: "game", moveNumber: 14, black: true });
  assert.deepEqual(parseTag(" A:1:. "), { line: "A", moveNumber: 1, black: false });
});

test("anything that isn't a tag is not one", () => {
  // The href position also carries real links, which must not be mistaken for
  // tags — and a malformed tag resolves to nothing rather than to a guess.
  assert.equal(parseTag("https://lichess.org/training/fork"), null);
  assert.equal(parseTag("A:15"), null);
  assert.equal(parseTag("A:15:"), null);
  assert.equal(parseTag("A:0:."), null);
  assert.equal(parseTag("A:15:x"), null);
  assert.equal(parseTag("#section"), null);
});
