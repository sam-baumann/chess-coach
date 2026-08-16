import { useEffect, useMemo, useRef, useState } from "react";
import type { Game, ReviewEvent, ReviewSession } from "@shared/events.ts";
import { api, streamReview } from "../api.ts";
import { plyLabel, plyOf } from "../ply.ts";
import { Markdown, type Jump } from "./Markdown.tsx";

type Item =
  | { kind: "message"; id: string; role: "user" | "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; state: "running" | "done" | "error" };

/**
 * Renders the agent's work as it happens. Tool events matter as much as text:
 * a depth-22 probe of six moments takes a couple of minutes, and without
 * "probing 4 moment(s) at depth 22" on screen that is indistinguishable from a
 * hang.
 */
export function ChatPane({
  session,
  moves,
  fens,
  userColor,
  onJump,
  onFen,
}: {
  session: ReviewSession;
  moves: string[];
  fens: string[];
  userColor: Game["userColor"];
  onJump: (ply: number) => void;
  /** Show a position the coach quoted that the game never reached. */
  onFen: (fen: string) => void;
}) {
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
  const [disconnected, setDisconnected] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  /**
   * Position references in the coach's replies become board jumps. Without the
   * sweep there are no scanned positions to jump to, so move references resolve
   * to null and stay plain text rather than becoming buttons that do nothing —
   * but a quoted FEN still opens on the board, since showing one needs no scan.
   */
  const jump = useMemo<Jump>(() => {
    const swept = fens.length > 1;

    // Keyed on the first four FEN fields: the half-move and full-move counters
    // differ between what the agent quotes and what the scan stored often
    // enough to matter, and they don't identify the position anyway.
    const key = (fen: string) => fen.trim().split(/\s+/).slice(0, 4).join(" ");
    const byFen = new Map(fens.map((f, i) => [key(f), i]));

    return {
      resolveFen: (fen) => (swept ? byFen.get(key(fen)) ?? null : null),
      resolveMove: (moveNumber, black) => {
        // A bare "move 13" doesn't say which side; the coach is nearly always
        // talking about the user's own move, so that is the reading taken.
        const ply = plyOf(moveNumber, black ?? userColor === "black");
        return swept && ply > 0 && ply < fens.length ? ply : null;
      },
      label: (ply) => plyLabel(ply, moves),
      onJump,
      onFen,
    };
  }, [fens, moves, userColor, onJump, onFen]);

  useEffect(() => {
    const stop = streamReview(
      session.id,
      (e: ReviewEvent) => {
        setItems((prev) => reduce(prev, e));
        if (e.type === "session") setSkills(e.skills);
        if (e.type === "thinking") setThinking(true);
        // "error" clears it too: an error is exactly when the agent loop ends, so
        // leaving the spinner up would pair the ⚠ with a permanent "thinking…".
        if (
          e.type === "assistant_delta" ||
          e.type === "assistant_text" ||
          e.type === "turn_done" ||
          e.type === "error"
        ) {
          setThinking(false);
        }
      },
      (connected) => {
        setDisconnected(!connected);
        if (!connected) setThinking(false);
      },
    );
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
      // Put the text back rather than making the user retype a question they may
      // have spent a while on — but only if they haven't started a new one.
      setDraft((current) => current || text);
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
              <div className="body">
                <Markdown text={item.text} jump={jump} />
              </div>
            </div>
          ),
        )}

        {thinking && (
          <p className="tool running">
            <span className="dot" />
            thinking…
          </p>
        )}

        {disconnected && (
          <p className="tool error">
            <span className="dot" />
            connection lost — retrying. Anything the coach says meanwhile appears on reload.
          </p>
        )}
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What were you thinking on move…?"
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is the newline. isComposing guards IME
            // input, where Enter commits the candidate and must not also send.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
