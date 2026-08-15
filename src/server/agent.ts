import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import {
  query,
  type HookCallback,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Game, ReviewEvent, ReviewMessage, ReviewSession } from "../shared/events.ts";
import { REPO_ROOT } from "./config.ts";
import { getDb } from "./db.ts";
import { PROBE_SCRIPT, scanPath, sweepStatus } from "./sweep.ts";

/**
 * The agent side of the hub.
 *
 * The skills under .claude/skills are loaded straight off the filesystem — the
 * SDK discovers them from the `project` setting source, so lichess-fetch,
 * stockfish-local, and game-review run here exactly as they do in a terminal
 * session, and CLAUDE.md supplies the coaching persona. Nothing is reimplemented.
 *
 * One long-lived Query per active review, driven by a push queue, so follow-up
 * turns don't re-pay process startup. The agent's own session id is persisted so
 * a server restart can `resume` rather than losing the thread.
 */

const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "Skill",
  "TodoWrite",
  "WebFetch",
];

/**
 * A blunt guard against the obvious footguns; this is a local single-user app.
 *
 * It has to be a PreToolUse hook. `disallowedTools` takes tool *names*, so
 * "Bash(rm -rf *)" matches nothing; and a `canUseTool` callback is never
 * consulted here, because a bare "Bash" in `allowedTools` auto-approves the
 * whole tool first — the SDK warns about exactly this
 * (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). A hook runs regardless.
 */
const BLOCKED_COMMANDS: { pattern: RegExp; why: string }[] = [
  // Covers -r, -R, -fr, --recursive, and flags trailing the path ("rm dir -r").
  { pattern: /\brm\b(?=[^\n]*(?:\s-[a-zA-Z]*[rR]|\s--recursive\b))/, why: "recursive delete" },
  { pattern: /\bsudo\b/, why: "sudo" },
  { pattern: /\bgit\b[^\n]*\bpush\b/, why: "git push" },
];

export function blockedReason(toolName: string, input: unknown): string | null {
  if (toolName !== "Bash") return null;
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== "string") return null;
  for (const { pattern, why } of BLOCKED_COMMANDS) {
    if (pattern.test(command)) return why;
  }
  return null;
}

const guardBash: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse") return { continue: true };
  const why = blockedReason(input.tool_name, input.tool_input);
  if (!why) return { continue: true };
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Blocked by the hub: ${why} is not available in a review session.`,
    },
  };
};

function hubContext(game: Game, scanRelPath: string | null): string {
  const lines = [
    "## You are running inside the Chess Improvement Hub",
    "",
    "Your output is rendered in a web chat pane beside a board and an evaluation",
    "trace, not in a terminal. Keep the coaching behaviour from CLAUDE.md exactly as",
    "it is — Socratic first, one habit rather than a list of errors, and a close with",
    "puzzle themes to practise.",
    "",
    "### This review",
    "",
    `- Game: https://lichess.org/${game.id}`,
    `- Players: ${game.white} (${game.whiteRating ?? "?"}) vs ${game.black} (${game.blackRating ?? "?"})`,
    `- Opening: ${game.opening ?? "unknown"} · ${game.speed}${game.rated ? " · rated" : " · casual"}`,
    `- Result: ${game.winner ? `${game.winner} won` : "draw"}`,
    game.userColor ? `- The user played ${game.userColor}.` : "- Which side the user played is unknown; ask.",
    "",
    "### What is already done for you",
    "",
  ];

  if (scanRelPath) {
    lines.push(
      `The pass-1 sweep is **already complete** at \`${scanRelPath}\`. Do not run`,
      "`scan_game.py` again — it takes minutes and the result is on disk. Read that",
      "file to rank and locate the critical moments, then run `probe_moments.py`",
      "against it for the moves you choose:",
      "",
      "```bash",
      `uv run --with chess python ${PROBE_SCRIPT} ${scanRelPath} --plies <n,n,n> --depth 22`,
      "```",
      "",
      "Quote evaluations from the probe, never from the depth-18 sweep.",
    );
  } else {
    lines.push(
      "No sweep has been run for this game yet. Tell the user to start one from the",
      "game list rather than running `scan_game.py` yourself — the hub runs it in the",
      "background with a progress bar.",
    );
  }

  lines.push(
    "",
    "### Finishing",
    "",
    "Write the entry to `notes/game-log.md` before you call the review done, in the",
    "exact six-line format its header prescribes, at the **top** of the entries",
    "section — the file is newest-first, as its own marker comment says. The hub",
    "reparses that file on write, so the trends view picks the entry up immediately.",
    "",
    "If the user asks for a page to keep, use the `game-review` skill but write the",
    "file to `reviews/<name>.html` — the Artifact tool is not available here. The hub",
    "serves that directory at `/reviews/<name>.html`.",
  );

  return lines.join("\n");
}

interface LiveSession {
  id: string;
  /** Needed to notice a sweep that finished after the prompt was built. */
  gameId: string;
  /** True once the agent has been told the sweep is available. */
  sweepAnnounced: boolean;
  q: Query;
  push: (text: string) => void;
  /** Ends the push generator; without it the iterator parks on a promise forever. */
  closeQueue: () => void;
  bus: EventEmitter;
  agentSessionId: string | null;
  /**
   * The API message id of the turn currently streaming. `stream_event` carries a
   * fresh uuid per event, so it cannot identify the message a delta belongs to;
   * only `message_start` names it, and the final `assistant` message repeats it.
   */
  streamMessageId: string | null;
  /**
   * Stream indexes of this message's text blocks, in order, and how many the
   * `assistant` messages have consumed. The CLI splits one API message into one
   * `assistant` message per content block, each holding a single block — so the
   * array position there is always 0 and cannot be used to match the deltas.
   */
  textBlockIndexes: number[];
  textBlockCursor: number;
}

const live = new Map<string, LiveSession>();

/**
 * Buses outlive the agent query deliberately. A query ends on any SDK error or
 * agent exit, but the browser's EventSource stays open — if the next turn built
 * a fresh emitter, the reattached agent would talk to nobody and the chat would
 * sit on "thinking…" until a reload.
 */
const buses = new Map<string, EventEmitter>();

function busFor(sessionId: string): EventEmitter {
  const existing = buses.get(sessionId);
  if (existing) return existing;
  const bus = new EventEmitter();
  // Many browser tabs plus the abort listener; the default cap of 10 is low.
  bus.setMaxListeners(50);
  buses.set(sessionId, bus);
  return bus;
}

/** An async iterable the HTTP layer can push user turns into. */
function messageQueue(): {
  iterable: AsyncIterable<SDKUserMessage>;
  push: (text: string) => void;
  close: () => void;
} {
  const pending: SDKUserMessage[] = [];
  let notify: (() => void) | null = null;
  let closed = false;

  const wake = () => {
    notify?.();
    notify = null;
  };

  return {
    push(text: string) {
      pending.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        session_id: "",
      } as SDKUserMessage);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (!closed) {
          if (pending.length === 0) {
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
            continue;
          }
          yield pending.shift()!;
        }
      },
    },
  };
}

/**
 * Turn the SDK's ~35-member message union into the handful of events the browser
 * renders. Tool events matter as much as text here: without them the chat is a
 * dead spinner during a two-minute engine probe.
 */
function toReviewEvents(msg: SDKMessage, session: LiveSession): ReviewEvent[] {
  const events: ReviewEvent[] = [];

  if (msg.type === "system" && msg.subtype === "init") {
    session.agentSessionId = msg.session_id;
    getDb()
      .prepare("UPDATE review_sessions SET agent_session_id = ? WHERE id = ?")
      .run(msg.session_id, session.id);
    events.push({
      type: "session",
      sessionId: session.id,
      agentSessionId: msg.session_id,
      skills: msg.skills ?? [],
    });
    return events;
  }

  if (msg.type === "stream_event") {
    const ev = msg.event;
    if (ev.type === "message_start") {
      session.streamMessageId = ev.message.id;
      session.textBlockIndexes = [];
      session.textBlockCursor = 0;
      return events;
    }
    if (ev.type === "content_block_start" && ev.content_block.type === "text") {
      session.textBlockIndexes.push(ev.index);
    }
    // Keyed by the API message id, not msg.uuid: every stream_event has its own
    // uuid, so uuid-keyed deltas would each open a new bubble and the final
    // assistant_text could never supersede them.
    const blockId = `${session.streamMessageId ?? msg.session_id}:${"index" in ev ? ev.index : 0}`;
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      events.push({ type: "assistant_delta", blockId, text: ev.delta.text });
    }
    if (ev.type === "content_block_start" && ev.content_block.type === "thinking") {
      events.push({ type: "thinking", blockId });
    }
    return events;
  }

  if (msg.type === "assistant") {
    const sameMessage = msg.message.id === session.streamMessageId;
    for (const [i, block] of msg.message.content.entries()) {
      if (block.type === "text") {
        // Resolve the block's *stream* index, so the complete text replaces the
        // deltas in place instead of appending a duplicate bubble. The cursor
        // advances for every text block, empty ones included — content_block_start
        // recorded those too, and skipping them here would shift each later block
        // onto the wrong index.
        const streamIndex = sameMessage
          ? (session.textBlockIndexes[session.textBlockCursor++] ?? i)
          : i;
        if (block.text.trim()) {
          events.push({
            type: "assistant_text",
            blockId: `${msg.message.id}:${streamIndex}`,
            text: block.text,
          });
          appendMessage(session.id, "assistant", block.text);
        }
      }
      if (block.type === "tool_use") {
        events.push({
          type: "tool_start",
          toolUseId: block.id,
          name: block.name,
          summary: summariseTool(block.name, block.input),
        });
      }
    }
    return events;
  }

  if (msg.type === "user") {
    const content = msg.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_result") {
          const r = block as { tool_use_id: string; is_error?: boolean };
          events.push({ type: "tool_end", toolUseId: r.tool_use_id, isError: Boolean(r.is_error) });
        }
      }
    }
    return events;
  }

  if (msg.type === "result") {
    if (msg.subtype === "success") {
      events.push({ type: "turn_done", costUsd: msg.total_cost_usd ?? null });
    } else {
      events.push({ type: "error", message: `Agent stopped: ${msg.subtype}` });
    }
    return events;
  }

  return events;
}

/** A one-line, human-readable "what is it doing right now" for the chat pane. */
function summariseTool(name: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (name === "Bash" && typeof inp.command === "string") {
    const cmd = inp.command;
    if (cmd.includes("probe_moments.py")) {
      const plies = /--plies\s+(\S+)/.exec(cmd)?.[1];
      const depth = /--depth\s+(\d+)/.exec(cmd)?.[1];
      return plies
        ? `probing ${plies.split(",").length} moment(s) at depth ${depth ?? "22"}`
        : "probing the worst moves at depth";
    }
    if (cmd.includes("scan_game.py")) return "sweeping the whole game";
    if (cmd.includes("stockfish")) return "asking the engine";
    return typeof inp.description === "string" ? inp.description : cmd.slice(0, 80);
  }
  if (name === "Read" && typeof inp.file_path === "string") {
    return `reading ${relative(REPO_ROOT, inp.file_path)}`;
  }
  if ((name === "Edit" || name === "Write") && typeof inp.file_path === "string") {
    return `writing ${relative(REPO_ROOT, inp.file_path)}`;
  }
  if (name === "Skill" && typeof inp.skill === "string") return `using the ${inp.skill} skill`;
  return name;
}

function appendMessage(sessionId: string, role: "user" | "assistant", content: string): void {
  getDb()
    .prepare("INSERT INTO review_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, role, content, Date.now());
}

export function createSession(game: Game): ReviewSession {
  const id = randomUUID();
  const createdAt = Date.now();
  getDb()
    .prepare("INSERT INTO review_sessions (id, game_id, agent_session_id, title, created_at) VALUES (?, ?, NULL, ?, ?)")
    .run(id, game.id, `${game.white} vs ${game.black}`, createdAt);
  return {
    id,
    gameId: game.id,
    agentSessionId: null,
    title: `${game.white} vs ${game.black}`,
    createdAt,
    messages: [],
  };
}

export function getSession(id: string): ReviewSession | null {
  const row = getDb()
    .prepare("SELECT id, game_id, agent_session_id, title, created_at FROM review_sessions WHERE id = ?")
    .get(id) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  const messages = getDb()
    .prepare("SELECT id, role, content, created_at FROM review_messages WHERE session_id = ? ORDER BY id")
    .all(id) as Record<string, string | number>[];
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    agentSessionId: row.agent_session_id as string | null,
    title: row.title as string | null,
    createdAt: row.created_at as number,
    messages: messages.map((m) => ({
      id: m.id as number,
      role: m.role as ReviewMessage["role"],
      content: m.content as string,
      createdAt: m.created_at as number,
    })),
  };
}

export function listSessionsForGame(gameId: string): ReviewSession[] {
  const rows = getDb()
    .prepare("SELECT id FROM review_sessions WHERE game_id = ? ORDER BY created_at DESC")
    .all(gameId) as { id: string }[];
  return rows.map((r) => getSession(r.id)!).filter(Boolean);
}

/** Subscribe to a review's event stream, starting the agent process on first use. */
export function attach(sessionId: string, game: Game): EventEmitter {
  const bus = busFor(sessionId);
  if (live.has(sessionId)) return bus;

  const stored = getSession(sessionId);
  const queue = messageQueue();

  // The file exists from the moment the sweep *starts* (and survives a failure),
  // so its presence is not completion. Telling the agent a running sweep is done
  // has it parse a truncated file.
  const scan = scanPath(game.id);
  const scanRel =
    sweepStatus(game.id)?.status === "done" && existsSync(scan) ? relative(REPO_ROOT, scan) : null;

  const q = query({
    prompt: queue.iterable,
    options: {
      cwd: REPO_ROOT,
      // Required for skill discovery — an empty array turns off .claude/skills
      // and CLAUDE.md, which is the entire point of running the agent here.
      settingSources: ["user", "project"],
      skills: "all",
      // Pinned rather than left to the SDK default: a review is a judgment task
      // — finding the one habit behind five errors, not summarising an engine
      // dump. Override with HUB_MODEL if you want to trade quality for cost.
      model: process.env.HUB_MODEL ?? "claude-opus-5",
      permissionMode: "dontAsk",
      allowedTools: ALLOWED_TOOLS,
      hooks: { PreToolUse: [{ hooks: [guardBash] }] },
      includePartialMessages: true,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: hubContext(game, scanRel),
      },
      ...(stored?.agentSessionId ? { resume: stored.agentSessionId } : {}),
      stderr: (data) => console.error("[agent]", data.trimEnd()),
    },
  });

  const session: LiveSession = {
    id: sessionId,
    gameId: game.id,
    sweepAnnounced: scanRel !== null,
    q,
    push: queue.push,
    closeQueue: queue.close,
    bus,
    agentSessionId: stored?.agentSessionId ?? null,
    streamMessageId: null,
    textBlockIndexes: [],
    textBlockCursor: 0,
  };
  live.set(sessionId, session);

  void (async () => {
    try {
      for await (const msg of q) {
        for (const ev of toReviewEvents(msg, session)) bus.emit("event", ev);
      }
    } catch (err) {
      bus.emit("event", {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      } satisfies ReviewEvent);
    } finally {
      // Only if this loop still owns the slot: closeSession() may already have
      // cleared it and a reconnect registered a newer session, which an
      // unconditional delete would drop — leaving two agents on one review.
      if (live.get(sessionId) === session) live.delete(sessionId);
    }
  })();

  return bus;
}

export function sendUserTurn(sessionId: string, game: Game, text: string): void {
  attach(sessionId, game); // no-op if the agent is already running
  appendMessage(sessionId, "user", text);

  const s = live.get(sessionId);
  if (!s) return;

  // The system prompt is fixed at attach() time, so a session opened before or
  // during a sweep is stuck being told no sweep exists. Correct it on the next
  // turn rather than pushing an unprompted one, which would spend a turn the
  // user didn't ask for. Only the user's own text is persisted as their message.
  let prefix = "";
  if (!s.sweepAnnounced && sweepStatus(s.gameId)?.status === "done") {
    const rel = relative(REPO_ROOT, scanPath(s.gameId));
    prefix =
      `[hub] The pass-1 sweep for this game has finished since this review started. ` +
      `It is on disk at \`${rel}\` — read it to locate the critical moments, and run ` +
      `probe_moments.py against it rather than scan_game.py.\n\n`;
    s.sweepAnnounced = true;
  }
  s.push(prefix + text);
}

/**
 * Closing on the last disconnect is right, but doing it *immediately* aborts the
 * agent mid-turn on a page navigation or a transient drop — and nothing re-sends
 * the pending question, so from the user's side it simply never gets answered.
 * The grace window lets a reconnect cancel the close.
 */
const CLOSE_GRACE_MS = 30_000;
const closeTimers = new Map<string, NodeJS.Timeout>();

export function cancelScheduledClose(sessionId: string): void {
  const t = closeTimers.get(sessionId);
  if (!t) return;
  clearTimeout(t);
  closeTimers.delete(sessionId);
}

export function scheduleClose(sessionId: string): void {
  cancelScheduledClose(sessionId);
  const timer = setTimeout(() => {
    closeTimers.delete(sessionId);
    // Re-check: a viewer may have come back during the window.
    if ((buses.get(sessionId)?.listenerCount("event") ?? 0) === 0) closeSession(sessionId);
  }, CLOSE_GRACE_MS);
  timer.unref?.();
  closeTimers.set(sessionId, timer);
}

export function closeSession(sessionId: string): void {
  cancelScheduledClose(sessionId);
  const s = live.get(sessionId);
  if (s) {
    s.closeQueue();
    s.q.close();
    live.delete(sessionId);
  }
  // The last viewer has gone, so the bus has no reason to outlive the query.
  buses.delete(sessionId);
}

export function closeAllSessions(): void {
  for (const id of [...live.keys()]) closeSession(id);
}
