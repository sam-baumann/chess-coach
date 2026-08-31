import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import { ALLOWED_TOOLS, agentSettings } from "./agent.ts";
import { REPO_ROOT } from "./config.ts";

/**
 * The sandbox is the only real boundary around the agent's Bash commands, and
 * every key here is load-bearing: drop one and the config still looks plausible
 * while quietly permitting what it was added to stop. These assert shape rather
 * than behaviour, because bubblewrap enforces the behaviour and a review session
 * takes minutes to run.
 */

const HOME = homedir();

/**
 * Deny rules resolved back to filesystem paths, e.g. `Read(//a/b)` -> `/a/b`.
 * The leading slash comes back because `//` is the rule syntax for "absolute",
 * not part of the path itself.
 */
function deniedPaths(tool: "Read" | "Edit"): string[] {
  const prefix = `${tool}(//`;
  return (agentSettings().permissions?.deny ?? [])
    .filter((r) => r.startsWith(prefix))
    .map((r) => `/${r.slice(prefix.length, -1)}`);
}

/**
 * A rule covers a path if it names it exactly, or names a directory at or above
 * it. Comparing on the separator matters: a bare prefix test would let
 * `/home/x/.sshfoo` satisfy a rule about `/home/x/.ssh`.
 *
 * Defined once and shared with the test below that proves it can still fail — a
 * second copy would let the two drift, which is the defect that test exists for.
 */
function covers(rule: string, path: string): boolean {
  const base = rule.endsWith("/**") ? rule.slice(0, -3) : rule;
  return path === base || path.startsWith(`${base}/`);
}

const isCovered = (path: string, rules: string[]) => rules.some((r) => covers(r, path));

test("the matcher recognises a gap rather than passing everything", () => {
  // The coverage assertions below are only worth having if they can fail.
  const rules = ["/home/x/.ssh"];
  assert.ok(isCovered("/home/x/.ssh", rules), "the directory the rule names");
  assert.ok(isCovered("/home/x/.ssh/id_ed25519", rules), "and anything beneath it");
  assert.ok(!isCovered("/home/x/.aws/credentials", rules), "but not an unrelated path");
  assert.ok(!isCovered("/home/x/.sshfoo", rules), "and not a sibling sharing the prefix");
});

test("the sandbox is on, and cannot silently fail open", () => {
  const { sandbox } = agentSettings();
  assert.equal(sandbox?.enabled, true);
  // A sandbox that failed to start must stop the review, not run it unprotected.
  assert.equal(sandbox?.failIfUnavailable, true);
  // Makes the CLI ignore `dangerouslyDisableSandbox` rather than leaving the
  // escape hatch to the permission pipeline.
  assert.equal(sandbox?.allowUnsandboxedCommands, false);
});

test("network is a strict allowlist covering exactly what a review needs", () => {
  const net = agentSettings().sandbox?.network;
  // Unknown hosts are denied, not prompted: nothing here can answer a prompt.
  assert.equal(net?.strictAllowlist, true);
  const domains = net?.allowedDomains ?? [];
  assert.ok(domains.includes("lichess.org"), "the coach curls the public game export");
  // `uv run --with chess` re-checks the index even with the wheel cached, so a
  // sweep fails outright without PyPI reachable.
  assert.ok(domains.includes("pypi.org"), "uv resolves against the index every run");
  assert.ok(domains.includes("files.pythonhosted.org"), "and downloads from here");
});

test("no in-process tool can reach the network around the allowlist", () => {
  // strictAllowlist gates sandboxed commands only. A tool that fetches in-process
  // ignores it entirely, and a bare allowedTools entry auto-approves the whole
  // tool before any scoped rule is consulted — so it has to be denied by name.
  const deny = agentSettings().permissions?.deny ?? [];
  assert.ok(!ALLOWED_TOOLS.includes("WebFetch"), "WebFetch must not be auto-approved");
  assert.ok(deny.includes("WebFetch"), "and must be denied outright");
});

test("uv can write its cache; nothing else outside cwd is granted", () => {
  const allowWrite = agentSettings().sandbox?.filesystem?.allowWrite ?? [];
  // uv dies on its own lock file when the cache is read-only. Asserted as a
  // property rather than a literal, so honouring UV_CACHE_DIR isn't a failure.
  assert.equal(allowWrite.length, 1);
  assert.match(allowWrite[0] ?? "", /uv$/);
});

test("well-known credential paths are unreadable", () => {
  const rules = deniedPaths("Read");
  for (const p of [
    `${HOME}/.ssh/id_ed25519`,
    `${HOME}/.aws/credentials`,
    `${HOME}/.config/gh/hosts.yml`,
    `${HOME}/.codex/auth.json`,
    `${HOME}/.claude/.credentials.json`,
    // A sibling of ~/.claude, so a rule on `.claude/**` alone misses it.
    `${HOME}/.claude.json`,
    `${HOME}/.netrc`,
    `${HOME}/.git-credentials`,
  ]) {
    assert.ok(isCovered(p, rules), `${p} is readable`);
  }
});

test("the Lichess token is denied by a pattern that survives a fresh clone", () => {
  const rules = deniedPaths("Read");
  // The token lives inside cwd, so no home-directory rule reaches it. It is
  // written as a glob because the sandbox skips a read-deny entry whose file
  // does not exist yet, and this one is absent until the user adds a token.
  assert.ok(
    rules.some((r) => r.startsWith(`${REPO_ROOT}/.claude/settings`) && r.includes("*")),
    "settings.local.json needs a glob, not a concrete path",
  );
});

test("the agent cannot rewrite the config or code that constrains it", () => {
  const rules = deniedPaths("Edit");
  // Edit and Write never enter the sandbox, so cwd being writable would
  // otherwise let a review edit its own sandbox settings for the next restart.
  assert.ok(isCovered(`${REPO_ROOT}/src/server/agent.ts`, rules));
  assert.ok(isCovered(`${REPO_ROOT}/.claude/settings.json`, rules));
  assert.ok(isCovered(`${REPO_ROOT}/.claude/skills/stockfish-local/SKILL.md`, rules));
  // A line appended to a shell profile is code execution on the host at login.
  assert.ok(isCovered(`${HOME}/.bashrc`, rules));
  assert.ok(isCovered(`${HOME}/.config/autostart/x.desktop`, rules));
  // But the log the coach exists to write stays writable.
  assert.ok(!isCovered(`${REPO_ROOT}/notes/game-log.md`, rules));
  assert.ok(!isCovered(`${REPO_ROOT}/reviews/game.html`, rules));
});

test("every deny rule names an absolute path", () => {
  // Permission rules take `//` for absolute; a single `/` resolves relative to
  // the settings root and silently matches nothing, which fails open.
  for (const rule of agentSettings().permissions?.deny ?? []) {
    if (!rule.includes("(")) continue; // bare tool denials like "WebFetch"
    assert.match(rule, /^(Read|Edit)\(\/\/[^/]/, `${rule} is not an absolute rule`);
  }
});
