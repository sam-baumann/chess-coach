import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sandboxSettings } from "./agent.ts";
import { REPO_ROOT } from "./config.ts";

/**
 * The sandbox is the only real boundary around the agent's Bash commands, and
 * every one of these keys is load-bearing: drop one and the config still looks
 * plausible while quietly permitting what it was added to stop. These assert the
 * shape rather than the behaviour, because bubblewrap enforces the behaviour and
 * a review session takes minutes to run.
 */

const LOCAL_SETTINGS = join(REPO_ROOT, ".claude", "settings.local.json");

test("the sandbox is on, and cannot silently fail open", () => {
  const { sandbox } = sandboxSettings();
  assert.equal(sandbox?.enabled, true);
  // A sandbox that failed to start must stop the review, not run it unprotected.
  assert.equal(sandbox?.failIfUnavailable, true);
  // Without this the model retries any blocked command with
  // dangerouslyDisableSandbox, and permissionMode "dontAsk" waves it through.
  assert.equal(sandbox?.allowUnsandboxedCommands, false);
});

test("network is a strict allowlist covering exactly what a review needs", () => {
  const net = sandboxSettings().sandbox?.network;
  // Unknown hosts are denied, not prompted: nothing here can answer a prompt.
  assert.equal(net?.strictAllowlist, true);
  const domains = net?.allowedDomains ?? [];
  assert.ok(domains.includes("lichess.org"), "the coach curls the public game export");
  // `uv run --with chess` re-checks the index even with the wheel cached, so a
  // sweep fails outright without PyPI reachable.
  assert.ok(domains.includes("pypi.org"), "uv resolves against the index every run");
  assert.ok(domains.includes("files.pythonhosted.org"), "and downloads from here");
});

test("uv can write its cache; nothing else outside cwd is granted", () => {
  const allowWrite = sandboxSettings().sandbox?.filesystem?.allowWrite ?? [];
  // uv dies on its own lock file when the cache is read-only.
  assert.deepEqual(allowWrite, ["~/.cache/uv"]);
});

test("credentials are denied to Bash, whose reads otherwise span the whole machine", () => {
  const paths = (sandboxSettings().sandbox?.credentials?.files ?? []).map((f) => f.path);
  assert.ok(paths.includes("~/.ssh"));
  assert.ok(paths.includes("~/.claude/.credentials.json"));
  // The Lichess token lives *inside* cwd, so denying the home directory misses it.
  assert.ok(paths.includes(LOCAL_SETTINGS), "the token file needs naming explicitly");
  for (const f of sandboxSettings().sandbox?.credentials?.files ?? []) {
    assert.equal(f.mode, "deny");
  }
});

test("the same paths are denied again for Read, which bypasses the sandbox", () => {
  // Read/Edit/Write answer to the permission system, not to bubblewrap, so a
  // sandbox-only config leaves the key readable through the Read tool.
  const deny = sandboxSettings().permissions?.deny ?? [];
  const home = homedir();
  assert.ok(deny.includes(`Read(//${home}/.ssh/**)`));
  assert.ok(deny.includes(`Read(//${home}/.claude/**)`));
  assert.ok(deny.includes(`Read(//${LOCAL_SETTINGS})`));
  // Permission rules use `//` for absolute paths; sandbox paths use `/`. Mixing
  // them up yields a rule that matches nothing and fails open.
  for (const rule of deny) assert.match(rule, /^Read\(\/\//);
});

test("every credential path is blocked on both routes", () => {
  // The property that matters: no file is protected from one tool but not the
  // other. Guards against adding a path to one list and forgetting the other.
  const s = sandboxSettings();
  const home = homedir();
  const rules = (s.permissions?.deny ?? []).map((r) => r.replace(/^Read\(\/\/|\)$/g, ""));

  /**
   * A rule covers a path if it names it exactly, or is a `**` rule on that
   * directory or an ancestor of it. Comparing on the separator matters: a bare
   * prefix test would let `/home/x/.sshfoo` satisfy a rule about `/home/x/.ssh`.
   */
  const covered = (path: string) =>
    rules.some((rule) => {
      if (!rule.endsWith("/**")) return rule === path;
      const base = rule.slice(0, -3);
      return path === base || path.startsWith(`${base}/`);
    });

  for (const f of s.sandbox?.credentials?.files ?? []) {
    const absolute = f.path.startsWith("~/") ? join(home, f.path.slice(2)) : f.path;
    assert.ok(covered(absolute), `${f.path} is sandboxed but readable via Read`);
  }
});

test("the deny matcher recognises a gap rather than passing everything", () => {
  // The test above is only worth having if it can fail, and a matcher that
  // treats every path as covered would pass silently.
  const rules = ["/home/x/.ssh/**"];
  const covered = (path: string) =>
    rules.some((rule) => {
      if (!rule.endsWith("/**")) return rule === path;
      const base = rule.slice(0, -3);
      return path === base || path.startsWith(`${base}/`);
    });
  assert.ok(covered("/home/x/.ssh"), "the directory the rule names");
  assert.ok(covered("/home/x/.ssh/id_ed25519"), "and anything beneath it");
  assert.ok(!covered("/home/x/.aws/credentials"), "but not an unrelated path");
  assert.ok(!covered("/home/x/.sshfoo"), "and not a sibling sharing the prefix");
});
