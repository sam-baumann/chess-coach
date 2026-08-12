import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countThemes, parseGameLog, parseVocab, pickRecurring } from "./gamelog.ts";
import { GAME_LOG_PATH } from "./config.ts";

const realLog = readFileSync(GAME_LOG_PATH, "utf8");

test("the header contributes no entries", () => {
  // The header carries an example entry inside a fenced block and a full tag
  // vocabulary table. Counting either would inflate every statistic the log
  // exists to produce, so the parser must cut at the entries marker.
  const { entries } = parseGameLog(realLog);
  assert.equal(entries.length, 0, "current log has no entries below the marker");
});

test("the tag vocabulary parses out of the header", () => {
  const vocab = parseVocab(realLog);
  const tags = vocab.map((v) => v.tag);
  assert.ok(tags.includes("king-safety"));
  assert.ok(tags.includes("opening-prep"));
  assert.equal(vocab.length, 15, "15 tags in the vocabulary table");

  const kingSafety = vocab.find((v) => v.tag === "king-safety");
  assert.deepEqual(kingSafety?.puzzleThemes, ["exposedKing", "kingsideAttack", "defensiveMove"]);

  // Rows whose themes column is an em-dash are "not a puzzle problem".
  assert.deepEqual(vocab.find((v) => v.tag === "opening-prep")?.puzzleThemes, []);

  // Prose asides in the themes cell must not become theme keys.
  assert.deepEqual(vocab.find((v) => v.tag === "time-pressure")?.puzzleThemes, ["oneMove", "short"]);
  assert.deepEqual(vocab.find((v) => v.tag === "trade-decisions")?.puzzleThemes, [
    "capturingDefender",
  ]);
});

test("a game entry parses into its six fields", () => {
  const log = `${realLog}
## 2026-08-11 · black vs magnusfan99 (1480) · Ponziani Opening · loss
Game: https://lichess.org/abcd1234
Themes: king-safety, calculation-depth
Struggled: walked the king to g7 on move 19 with the g-file about to open.
Held up: the opening was fine — equal through move 15.
Work on: before a king move, ask which file it opens.
`;
  const { entries } = parseGameLog(log);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.date, "2026-08-11");
  assert.equal(e.kind, "game");
  assert.equal(e.colour, "black");
  assert.equal(e.opponent, "magnusfan99");
  assert.equal(e.opponentRating, 1480);
  assert.equal(e.opening, "Ponziani Opening");
  assert.equal(e.result, "loss");
  assert.equal(e.gameUrl, "https://lichess.org/abcd1234");
  assert.deepEqual(e.themes, ["king-safety", "calculation-depth"]);
  assert.match(e.struggled, /^walked the king/);
  assert.match(e.heldUp, /^the opening was fine/);
  assert.match(e.workOn, /^before a king move/);
});

test("the player-review heading variant is recognised", () => {
  const log = `${realLog}
## 2026-08-10 · player review · 12 games
Game: https://lichess.org/a, https://lichess.org/b
Themes: loose-pieces
Struggled: hangs a piece in the first fifteen moves in a third of these.
Held up: endgame conversion is solid.
Work on: a blunder-check habit before every capture.
`;
  const { entries } = parseGameLog(log);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "player-review");
  assert.equal(entries[0].result, "12 games");
  assert.deepEqual(entries[0].themes, ["loose-pieces"]);
});

test("newest-first ordering is preserved and bad headings are dropped", () => {
  const log = `${realLog}
## 2026-08-11 · white vs alice (1500) · Italian Game · win
Themes: piece-activity

## not a date at all
Themes: should-not-appear

## 2026-08-01 · black vs bob (1450) · French Defence · loss
Themes: passive-defence
`;
  const { entries } = parseGameLog(log);
  assert.deepEqual(
    entries.map((e) => e.date),
    ["2026-08-11", "2026-08-01"],
  );
  assert.deepEqual(entries.flatMap((e) => e.themes), ["piece-activity", "passive-defence"]);
});

test("a log with no entries marker yields nothing rather than guessing", () => {
  const { entries } = parseGameLog("## 2026-01-01 · white vs x (1) · Y · win\nThemes: king-safety");
  assert.equal(entries.length, 0);
});

// ---- the recurrence rule -------------------------------------------------
//
// notes/game-log.md is explicit: raise a theme at three-or-more games, or two of
// the last three. Below that, "mentioning it invents a pattern out of
// coincidence, which is worse than saying nothing." These pin that threshold.

const VOCAB = new Map([
  ["king-safety", ["exposedKing", "kingsideAttack"]],
  ["opening-prep", []],
  ["loose-pieces", ["hangingPiece"]],
]);

const e = (...themes: string[]) => ({ themes });

test("a theme in two of many games is below the threshold", () => {
  const entries = [e("king-safety"), e("loose-pieces"), e("piece-activity"), e("king-safety")];
  assert.equal(pickRecurring(entries, VOCAB), null);
});

test("three appearances anywhere in the log qualifies", () => {
  const entries = [e("king-safety"), e("a"), e("king-safety"), e("b"), e("king-safety")];
  const r = pickRecurring(entries, VOCAB);
  assert.equal(r?.tag, "king-safety");
  assert.equal(r?.count, 3);
  assert.equal(r?.reason, "three-or-more");
  assert.deepEqual(r?.puzzleThemes, ["exposedKing", "kingsideAttack"]);
});

test("two of the last three qualifies even at a total count of two", () => {
  const entries = [e("loose-pieces"), e("x"), e("loose-pieces"), e("y"), e("z")];
  const r = pickRecurring(entries, VOCAB);
  assert.equal(r?.tag, "loose-pieces");
  assert.equal(r?.count, 2);
  assert.equal(r?.reason, "two-of-last-three");
});

test("two-of-last-three only looks at the newest three entries", () => {
  // Same two appearances, but now at positions 3 and 5 — outside the window.
  const entries = [e("x"), e("y"), e("z"), e("loose-pieces"), e("loose-pieces")];
  assert.equal(pickRecurring(entries, VOCAB), null);
});

test("a qualifying tag with no drillable themes still surfaces", () => {
  const entries = [e("opening-prep"), e("opening-prep"), e("opening-prep")];
  const r = pickRecurring(entries, VOCAB);
  assert.equal(r?.tag, "opening-prep");
  assert.deepEqual(r?.puzzleThemes, [], "the UI must offer study, not a near-fitting puzzle theme");
});

test("a tag repeated within one entry counts once", () => {
  assert.deepEqual(countThemes([e("king-safety", "king-safety")]), [{ tag: "king-safety", count: 1 }]);
});

test("an empty log has no recurring habit", () => {
  assert.equal(pickRecurring([], VOCAB), null);
});
