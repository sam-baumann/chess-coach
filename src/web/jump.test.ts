import assert from "node:assert/strict";
import test from "node:test";
import { buildJump } from "./jump.ts";
import { parseDeclaration, parseTag, type DeclaredLine } from "./lines.ts";

/* The review this mechanism exists for. The game answered 14.e5 with 14... Bxf3,
   so the coach's refutation — 14... d5 and everything after it — is a line of
   positions the game never held, and by White's 15th in the real game the knight
   is already off f3, which is what made "15.Nxd4" unreadable against the
   scoresheet. */
const MOVES =
  "e4 e5 Nf3 d6 Bc4 Nf6 d3 Nc6 O-O Nd4 Nxd4 exd4 Bg5 Be7 Nd2 Nd7 Bxe7 Qxe7 Nf3 O-O Re1 g6 Qd2 Nb6 b3 Bg4 e5 Bxf3 exd6 Qxd6 gxf3 Rae8".split(
    " ",
  );

const REFUTATION = parseDeclaration("line id=A", "14... d5 15.Nxd4 dxc4 16.bxc4", [])!;
const LINE = "14...d5 15.Nxd4 dxc4 16.bxc4";

const context = (over: Partial<Parameters<typeof buildJump>[0]> = {}) =>
  buildJump({
    // One entry per ply plus the start, which is all resolveTag reads of it.
    fens: Array.from({ length: MOVES.length + 1 }, (_, i) => `fen-${i}`),
    moves: MOVES,
    onJump: () => {},
    onFen: () => {},
    onVariation: () => {},
    ...over,
  });

/** Resolve a tagged link the way the renderer does: the href, plus what it says. */
const at = (href: string, text: string, lines: DeclaredLine[] = [REFUTATION]) =>
  context().resolveTag(parseTag(href)!, text, lines);

test("a tag into a line names the half-move it says, prefix and all", () => {
  assert.deepEqual(at("A:14:..", "14... d5"), { kind: "variation", line: LINE, step: 0 });
  // The move the old prose reading could not place: against the game it is
  // illegal, and inside the line it is simply the next step.
  assert.deepEqual(at("A:15:.", "15.Nxd4"), { kind: "variation", line: LINE, step: 1 });
  // And the move written without a number, which is the case that started this:
  // notation alone gave the renderer nothing to match on.
  assert.deepEqual(at("A:15:..", "dxc4"), { kind: "variation", line: LINE, step: 2 });
});

test("the same move twice in one line is told apart by the side", () => {
  // Both sides capture on c4, one ply apart. Notation alone could not choose;
  // the tag carries the number and the dots, so it never has to.
  const both = parseDeclaration("line id=B", "15.bxc4 dxc4", [])!;
  assert.deepEqual(at("B:15:.", "bxc4", [both]), {
    kind: "variation",
    line: "15.bxc4 dxc4",
    step: 0,
  });
  assert.deepEqual(at("B:15:..", "dxc4", [both]), {
    kind: "variation",
    line: "15.bxc4 dxc4",
    step: 1,
  });
});

test("`game` is the line id for the move that was actually played", () => {
  assert.deepEqual(at("game:14:.", "14.e5"), { kind: "game", ply: 27 });
  assert.deepEqual(at("game:14:..", "Bxf3"), { kind: "game", ply: 28 });
});

test("a tag whose text disagrees with the move it points at is not a link", () => {
  // The tag says where and the text says what. When they conflict one of them is
  // wrong and there is no telling which, so the reader keeps the notation and
  // the board stays put.
  assert.equal(at("A:15:.", "15.Qc3"), null);
  assert.equal(at("game:14:.", "14.Nxd4"), null);
  // Leniency is only in the parts that are commentary rather than move.
  assert.deepEqual(at("A:15:.", "15.Nxd4!?"), { kind: "variation", line: LINE, step: 1 });
  // Text that isn't notation makes no claim to check against.
  assert.deepEqual(at("A:15:.", "the knight takes"), { kind: "variation", line: LINE, step: 1 });
});

test("a tag pointing nowhere resolves to nothing", () => {
  assert.equal(at("Z:15:.", "15.Nxd4"), null, "no line with that id");
  assert.equal(at("A:20:.", "20.Rd1"), null, "the line does not reach that move");
  assert.equal(at("game:99:.", "99.Kd2"), null, "past the end of the game");
  assert.equal(parseTag("A:15"), null, "no side");
  assert.equal(parseTag("https://lichess.org/training/fork"), null);
});

test("without a sweep the game is unreachable but a line still is not", () => {
  const jump = context({ fens: [] });
  // Nothing to scrub to, so a tag on the played move stays plain text.
  assert.equal(jump.resolveTag(parseTag("game:14:.")!, "14.e5", [REFUTATION]), null);
  assert.equal(jump.resolveFen("fen-9"), null);
  // Replaying a line needs only the move list, so this still resolves.
  assert.deepEqual(jump.resolveTag(parseTag("A:15:.")!, "15.Nxd4", [REFUTATION]), {
    kind: "variation",
    line: LINE,
    step: 1,
  });
});

test("a FEN resolves on the first four fields, ignoring the counters", () => {
  const real = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3";
  const jump = context({ fens: ["start", real] });
  assert.equal(jump.resolveFen(real.replace("4 3", "0 9")), 1);
  assert.equal(jump.resolveFen(real.split(" ").slice(0, 4).join(" ")), 1);
  assert.equal(jump.resolveFen("8/8/8/8/8/8/8/K6k w - -"), null);
});
