import { useEffect, useRef, useState } from "react";
import type { ReviewEvent, ReviewSession } from "@shared/events.ts";
import { api, streamReview } from "../api.ts";

type Item =
  | { kind: "message"; id: string; role: "user" | "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; state: "running" | "done" | "error" };

/**
 * Renders the agent's work as it happens. Tool events matter as much as text:
 * a depth-22 probe of six moments takes a couple of minutes, and without
 * "probing 4 moment(s) at depth 22" on screen that is indistinguishable from a
 * hang.
 */
export function ChatPane({ session }: { session: ReviewSession }) {
  const [items, setItems] = useState<Item[]>(() =>
    session.messages.map((m) => ({
      kind: "message" as const,
      id: `stored:${m.id}`,
      role: m.role,
      text: m.content,
    })),
  );
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const stop = streamReview(session.id, (e: ReviewEvent) => {
      setItems((prev) => reduce(prev, e));
      if (e.type === "session") setSkills(e.skills);
      if (e.type === "thinking") setThinking(true);
      if (e.type === "assistant_delta" || e.type === "assistant_text" || e.type === "turn_done") {
        setThinking(false);
      }
    });
    return stop;
  }, [session.id]);

  // Follow the tail only while the reader is already at the bottom, so scrolling
  // back to re-read a question isn't yanked away by the next delta.
  useEffect(() => {
    const el = logRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, thinking]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setItems((prev) => [...prev, { kind: "message", id: `local:${Date.now()}`, role: "user", text }]);
    setThinking(true);
    try {
      await api.say(session.id, text);
    } catch (err) {
      setItems((prev) => [
        ...prev,
        { kind: "message", id: `err:${Date.now()}`, role: "assistant", text: `⚠ ${(err as Error).message}` },
      ]);
      setThinking(false);
    }
  }

  return (
    <div className="chat">
      <div
        className="chat-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {items.length === 0 && (
          <p className="muted">
            Ask for the review, or start with a question of your own — &ldquo;what went wrong
            around move 20?&rdquo;
            {skills.length > 0 && (
              <>
                <br />
                <span className="mono" style={{ fontSize: 11.5 }}>
                  skills loaded: {skills.join(", ")}
                </span>
              </>
            )}
          </p>
        )}

        {items.map((item) =>
          item.kind === "tool" ? (
            <p key={item.id} className={`tool ${item.state}`}>
              <span className="dot" />
              {item.summary}
            </p>
          ) : (
            <div key={item.id} className={`msg ${item.role}`}>
              <div className="who">{item.role === "user" ? "you" : "coach"}</div>
              <div className="body">{item.text}</div>
            </div>
          ),
        )}

        {thinking && (
          <p className="tool running">
            <span className="dot" />
            thinking…
          </p>
        )}
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What were you thinking on move…?"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn" onClick={() => void send()} disabled={!draft.trim()}>
          send
        </button>
      </div>
    </div>
  );
}

/** Fold one wire event into the transcript. */
function reduce(prev: Item[], e: ReviewEvent): Item[] {
  switch (e.type) {
    case "assistant_delta": {
      const id = `blk:${e.blockId}`;
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) {
        return [...prev, { kind: "message", id, role: "assistant", text: e.text }];
      }
      const next = [...prev];
      const item = next[idx];
      if (item.kind === "message") next[idx] = { ...item, text: item.text + e.text };
      return next;
    }
    case "assistant_text": {
      // The complete block supersedes any deltas accumulated for it.
      const id = `blk:${e.blockId}`;
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return [...prev, { kind: "message", id, role: "assistant", text: e.text }];
      const next = [...prev];
      const item = next[idx];
      if (item.kind === "message") next[idx] = { ...item, text: e.text };
      return next;
    }
    case "tool_start":
      return [
        ...prev,
        { kind: "tool", id: `tool:${e.toolUseId}`, name: e.name, summary: e.summary, state: "running" },
      ];
    case "tool_end":
      return prev.map((i) =>
        i.kind === "tool" && i.id === `tool:${e.toolUseId}`
          ? { ...i, state: e.isError ? "error" : "done" }
          : i,
      );
    case "error":
      return [...prev, { kind: "message", id: `err:${Date.now()}`, role: "assistant", text: `⚠ ${e.message}` }];
    default:
      return prev;
  }
}
