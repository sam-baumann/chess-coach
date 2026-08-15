import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { query, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Game, ReviewEvent, ReviewMessage, ReviewSession } from "../shared/events.ts";
import { REPO_ROOT } from "./config.ts";
import { getDb } from "./db.ts";
import { PROBE_SCRIPT, scanPath } from "./sweep.ts";

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

/** A blunt guard against the obvious footguns; this is a local single-user app. */
const DISALLOWED_TOOLS = ["Bash(rm -rf *)", "Bash(git push *)", "Bash(sudo *)"];

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
    "Append the entry to `notes/game-log.md` before you call the review done, in the",
    "exact six-line format its header prescribes. The hub reparses that file on",
    "write, so the trends view picks the entry up immediately.",
    "",
    "If the user asks for a page to keep, use the `game-review` skill but write the",
    "file to `reviews/<name>.html` — the Artifact tool is not available here. The hub",
    "serves that directory at `/reviews/<name>.html`.",
  );

  return lines.join("\n");
}

interface LiveSession {
  id: string;
  q: Query;
  push: (text: string) => void;
  bus: EventEmitter;
  agentSessionId: string | null;
}

const live = new Map<string, LiveSession>();

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
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      events.push({
        type: "assistant_delta",
        blockId: `${msg.uuid}:${ev.index}`,
        text: ev.delta.text,
      });
    }
    if (ev.type === "content_block_start" && ev.content_block.type === "thinking") {
      events.push({ type: "thinking", blockId: `${msg.uuid}:${ev.index}` });
    }
    return events;
  }

  if (msg.type === "assistant") {
    for (const [i, block] of msg.message.content.entries()) {
      if (block.type === "text" && block.text.trim()) {
        events.push({ type: "assistant_text", blockId: `${msg.uuid}:${i}`, text: block.text });
        appendMessage(session.id, "assistant", block.text);
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
  const existing = live.get(sessionId);
  if (existing) return existing.bus;

  const stored = getSession(sessionId);
  const queue = messageQueue();
  const bus = new EventEmitter();
  // Many browser tabs plus the abort listener; the default cap of 10 is low.
  bus.setMaxListeners(50);

  const scan = scanPath(game.id);
  const scanRel = existsSync(scan) ? relative(REPO_ROOT, scan) : null;

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
      disallowedTools: DISALLOWED_TOOLS,
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
    q,
    push: queue.push,
    bus,
    agentSessionId: stored?.agentSessionId ?? null,
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
      live.delete(sessionId);
    }
  })();

  return bus;
}

export function sendUserTurn(sessionId: string, game: Game, text: string): void {
  attach(sessionId, game); // no-op if the agent is already running
  appendMessage(sessionId, "user", text);
  live.get(sessionId)?.push(text);
}

export function closeSession(sessionId: string): void {
  const s = live.get(sessionId);
  if (!s) return;
  s.q.close();
  live.delete(sessionId);
}

export function closeAllSessions(): void {
  for (const id of [...live.keys()]) closeSession(id);
}
