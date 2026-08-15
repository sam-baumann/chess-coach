import { Fragment, type ReactNode } from "react";
import { findRefs, isBareFen } from "../refs.ts";

/**
 * A small markdown renderer for the coach's replies, plus the thing that makes
 * those replies usable on a board: position references become buttons that move
 * the board on the left.
 *
 * Why render markdown at all — the agent is running under CLAUDE.md and writes
 * the way it writes everywhere else (**bold** takeaways, `-` lists, fenced
 * FENs). Shown as pre-wrap text those markers are just noise on screen.
 *
 * Why hand-rolled rather than a library: the linkifier has to reach *inside*
 * code fences, because a bare FEN in a fence is exactly the case the user can't
 * read. That means walking the token stream, so the parser and the linkifier
 * want to be the same pass. It also renders to React nodes, never to HTML, so
 * agent output can't inject markup.
 *
 * The subset is deliberate: headings, lists, blockquote, rules, fenced and
 * inline code, bold, italic, links. Anything outside it falls through as text.
 */

export type Jump = {
  /** Board index for a FEN the sweep actually produced, or null if unknown. */
  resolveFen: (fen: string) => number | null;
  /** Board index for a numbered move reference, or null if out of range. */
  resolveMove: (moveNumber: number, black: boolean | null) => number | null;
  /** Scoresheet notation for a board index, used as the link's text. */
  label: (ply: number) => string;
  onJump: (ply: number) => void;
};

export function Markdown({ text, jump }: { text: string; jump?: Jump }) {
  return (
    <>
      {parseBlocks(text).map((b, i) => (
        <Fragment key={i}>{renderBlock(b, jump)}</Fragment>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Position references
// ---------------------------------------------------------------------------

/** Split a text run into plain strings and resolved position links. */
function linkify(text: string, jump: Jump | undefined, keyBase: string): ReactNode[] {
  if (!jump) return [text];

  const out: ReactNode[] = [];
  let last = 0;

  for (const ref of findRefs(text)) {
    const ply =
      ref.kind === "fen" ? jump.resolveFen(ref.raw) : jump.resolveMove(ref.moveNumber, ref.black);

    // Unresolvable references stay as plain text: a link that jumps the board
    // to the wrong position is worse than the notation the user already reads.
    if (ply == null) continue;

    if (ref.start > last) out.push(text.slice(last, ref.start));
    out.push(
      <button
        key={`${keyBase}:${ref.start}`}
        type="button"
        className="ply-link"
        title={`Show the board at ${jump.label(ply)}`}
        onClick={() => jump.onJump(ply)}
      >
        {/* A FEN is unreadable, so show the move it *is*. Notation the user
            already typed or read stays verbatim — replacing it would make the
            coach look like it said something else. */}
        {ref.kind === "fen" ? jump.label(ply) : ref.raw}
      </button>,
    );
    last = ref.end;
  }

  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

type Block =
  | { kind: "code"; content: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "para"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join("\n") });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: "code", content: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const items: string[] = [];
      while (i < lines.length) {
        const b = /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        const n = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]);
        const item = ordered ? n : b;
        // A different marker starts a different list.
        if (!item || (ordered ? !!b : !!n)) break;
        items.push(item[1]);
        i++;
        // Indented continuation lines belong to the item just pushed.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        }
      }
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]];
      while (i + 1 < lines.length && /^\s*>\s?/.test(lines[i + 1])) {
        body.push(lines[++i].replace(/^\s*>\s?/, ""));
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    para.push(line);
  }
  flush();
  return blocks;
}

function renderBlock(b: Block, jump: Jump | undefined): ReactNode {
  switch (b.kind) {
    case "code": {
      // A fence holding nothing but a FEN is the case that started all this —
      // render it as the position it denotes, not as a wall of slashes.
      const only = b.content.trim();
      const ply = jump && isBareFen(only) ? jump.resolveFen(only) : null;
      if (jump && ply != null) {
        return (
          <p className="fen-line">
            <button
              type="button"
              className="ply-link block"
              title={`Show the board at ${jump.label(ply)}`}
              onClick={() => jump.onJump(ply)}
            >
              ⊞ {jump.label(ply)}
            </button>
          </p>
        );
      }
      return <pre className="md-code">{b.content}</pre>;
    }
    case "heading": {
      // The chat is already inside an h2 region and these are only emphasis, so
      // every level renders at one weight rather than reopening the type scale.
      return <p className="md-h">{inline(b.text, jump, "h")}</p>;
    }
    case "list":
      return b.ordered ? (
        <ol className="md-list">
          {b.items.map((it, i) => (
            <li key={i}>{inline(it, jump, `li${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul className="md-list">
          {b.items.map((it, i) => (
            <li key={i}>{inline(it, jump, `li${i}`)}</li>
          ))}
        </ul>
      );
    case "quote":
      return <blockquote className="md-quote">{inline(b.text, jump, "q")}</blockquote>;
    case "rule":
      return <hr className="md-rule" />;
    case "para":
      return <p className="md-p">{inline(b.text, jump, "p")}</p>;
  }
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/* Ordered so the longer fences win: ``code``, `code`, **bold**, *italic*,
   _italic_, [text](href). Underscores are only italic between word boundaries,
   which keeps snake_case identifiers intact. */
const INLINE =
  /(`+)([\s\S]+?)\1|\*\*([\s\S]+?)\*\*|\*([^*\n]+?)\*|\b_([^_\n]+?)_\b|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string, jump: Jump | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  INLINE.lastIndex = 0;

  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), jump, `${keyBase}:${last}`));
    const key = `${keyBase}:i${m.index}`;
    const [, , code, bold, star, under, linkText, href] = m;

    if (code !== undefined) {
      // Inline code is linkified too — `rnbq.../ w KQkq - 5 13` in backticks is
      // the same unreadable FEN as the fenced one.
      out.push(
        <code key={key} className="md-code-inline">
          {linkify(code, jump, key)}
        </code>,
      );
    } else if (bold !== undefined) {
      out.push(<strong key={key}>{linkify(bold, jump, key)}</strong>);
    } else if (star !== undefined || under !== undefined) {
      out.push(<em key={key}>{linkify((star ?? under) as string, jump, key)}</em>);
    } else if (linkText !== undefined) {
      // Only http(s) — the agent writes Lichess training links, and anything
      // else in a href position is not something to hand a click to.
      const safe = /^https?:\/\//i.test(href);
      out.push(
        safe ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {linkText}
          </a>
        ) : (
          <Fragment key={key}>{linkText}</Fragment>
        ),
      );
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) out.push(...linkify(text.slice(last), jump, `${keyBase}:${last}`));
  return out;
}
