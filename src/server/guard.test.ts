import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedReason } from "./agent.ts";

/**
 * The hub's Bash guard.
 *
 * This is pinned because two earlier versions of it were silently inert:
 * `disallowedTools: ["Bash(rm -rf *)"]` matched nothing (that option takes tool
 * names), and a `canUseTool` callback was never consulted because a bare "Bash"
 * in `allowedTools` auto-approves the tool first. A guard that quietly does
 * nothing is worse than no guard, so these assert it actually fires.
 */

const blocked = (command: string) => blockedReason("Bash", { command });

test("recursive deletes are blocked in every flag spelling", () => {
  assert.equal(blocked("rm -rf data/sweeps"), "recursive delete");
  assert.equal(blocked("rm -r data"), "recursive delete");
  assert.equal(blocked("rm -R data"), "recursive delete");
  assert.equal(blocked("rm --recursive data"), "recursive delete");
  assert.equal(blocked("rm -f -r data"), "recursive delete");
  // Flags after the operand are still flags.
  assert.equal(blocked("rm data -r"), "recursive delete");
  // Buried in a compound command, which is how it would actually arrive.
  assert.equal(blocked("cd /tmp && rm -rf junk"), "recursive delete");
});

test("sudo and git push are blocked", () => {
  assert.equal(blocked("sudo apt-get install stockfish"), "sudo");
  assert.equal(blocked("git push origin main"), "git push");
  assert.equal(blocked("git -C /repo push"), "git push");
});

test("the commands a review actually needs are allowed", () => {
  assert.equal(blocked("uv run --with chess python scan_game.py --moves e4 e5"), null);
  assert.equal(blocked("stockfish"), null);
  assert.equal(blocked("rm data/sweeps/abcd1234.json"), null, "a non-recursive rm is fine");
  assert.equal(blocked("git status"), null);
  assert.equal(blocked("git log --oneline"), null);
});

test("non-Bash tools and malformed input are not blocked", () => {
  assert.equal(blockedReason("Read", { file_path: "/etc/passwd" }), null);
  assert.equal(blockedReason("Bash", {}), null);
  assert.equal(blockedReason("Bash", null), null);
  assert.equal(blockedReason("Bash", { command: 42 }), null);
});
