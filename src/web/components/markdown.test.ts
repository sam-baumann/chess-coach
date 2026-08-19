import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildJump } from "../jump.ts";
import { Markdown } from "./Markdown.tsx";

/* Rendered rather than unit-tested through the parser because the thing worth
   pinning is an ordering rule that only exists at render time: a declaration
   governs the blocks after it and none of the blocks before it. */

const MOVES =
  "e4 e5 Nf3 d6 Bc4 Nf6 d3 Nc6 O-O Nd4 Nxd4 exd4 Bg5 Be7 Nd2 Nd7 Bxe7 Qxe7 Nf3 O-O Re1 g6 Qd2 Nb6 b3 Bg4 e5 Bxf3 exd6 Qxd6 gxf3 Rae8".split(
    " ",
  );

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(Markdown, {
      text,
      jump: buildJump({
        fens: ["start", ...MOVES.map((_, i) => `fen-${i + 1}`)],
        moves: MOVES,
        onJump: () => {},
        onFen: () => {},
        onVariation: () => {},
      }),
    }),
  );

const DECLARED = "```line id=A\n14... d5 15.Nxd4 dxc4 16.bxc4\n```\n\n";

test("a declared line is read, not shown", () => {
  const html = render(`${DECLARED}After [15.Nxd4](A:15:.) the centre goes.`);
  // The block is metadata for the board; seeing it would be seeing the wiring.
  assert.equal(html.includes("14... d5 15.Nxd4"), false);
  assert.equal(html.includes("md-code"), false);
  // And the tagged move under it is a link, off the game.
  assert.match(html, /<button[^>]*class="ply-link off-game"[^>]*>15\.Nxd4<\/button>/);
});

test("a move with no number of its own links like any other", () => {
  // The case the prose reader could never have: nothing about "dxc4" says which
  // ply it is, and the tag says it outright.
  const html = render(`${DECLARED}After 15.Nxd4 [dxc4](A:15:..) it has gone.`);
  assert.match(html, /<button[^>]*class="ply-link off-game"[^>]*>dxc4<\/button>/);
  // The untagged 15.Nxd4 beside it stays text — nothing reads prose for moves.
  assert.equal(html.includes(">15.Nxd4<"), false);
});

test("an untagged move is text, and a tag that resolves to nothing is its own text", () => {
  assert.equal(render("You played 14.e5 there.").includes("<button"), false);
  // A stale line id, and a tag whose text is not the move it points at.
  assert.equal(render(`${DECLARED}After [15.Nxd4](Z:15:.) it goes.`).includes("<button"), false);
  assert.equal(render(`${DECLARED}After [15.Qc3](A:15:.) it goes.`).includes("<button"), false);
  // Both still read as what the coach wrote.
  assert.match(render(`${DECLARED}After [15.Qc3](A:15:.) it goes.`), /After 15\.Qc3 it goes\./);
});

test("the played move scrubs the board rather than replaying a line", () => {
  const html = render("You played [14.e5](game:14:.) here.");
  assert.match(html, /<button[^>]*class="ply-link"[^>]*title="Show the board at 14\. e5"/);
});

test("a real link is still a link", () => {
  const html = render("Try [hangingPiece](https://lichess.org/training/hangingPiece).");
  assert.match(html, /<a href="https:\/\/lichess\.org\/training\/hangingPiece"/);
});

test("a declaration is read wherever it sits in the message", () => {
  // Tags name their line by id, so the block no longer has to come first — the
  // ordering rule that used to decide this is gone.
  const html = render("Before [18.Qh5](A:18:.).\n\n```line id=A\n17...Kg7 18.Qh5\n```");
  assert.match(html, /<button[^>]*class="ply-link off-game"[^>]*>18\.Qh5<\/button>/);
});

test("an unfinished declaration is neither shown nor complained about", () => {
  // Mid-stream: the fence is open and the last move is half-typed. Rendering the
  // raw block would flash it on screen, and warning would accuse the coach of a
  // broken line it hasn't finished writing.
  assert.equal(render("```line\n14... d5 15.Nx"), "");
});

test("a finished declaration that cannot be read says so", () => {
  const html = render("```line id=A\n14... d5 winning\n```\n\nAfter [15.Nxd4](A:15:.) it is over.");
  assert.match(html, /couldn’t read a line the coach declared/);
  // Its tags have nothing to resolve against, so they read as their own text.
  assert.equal(html.includes("<button"), false);
  assert.match(html, /After 15\.Nxd4 it is over\./);
});

test("an ordinary fence is still code", () => {
  const html = render("```bash\nuv run python scan_game.py\n```");
  assert.match(html, /<pre class="md-code">uv run python scan_game\.py<\/pre>/);
});
