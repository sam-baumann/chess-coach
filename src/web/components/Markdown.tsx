import { Fragment, type ReactNode } from "react";
import type { Jump } from "../jump.ts";
import { isLineBlock, parseDeclaration, parseTag, type DeclaredLine } from "../lines.ts";
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

export function Markdown({ text, jump }: { text: string; jump?: Jump }) {
  const { blocks, lines } = declare(parseBlocks(text));
  const ctx = jump && { jump, lines };
  return (
    <>
      {blocks.map((b, i) => (
        <Fragment key={i}>{renderBlock(b, ctx)}</Fragment>
      ))}
    </>
  );
}

/**
 * Read the message's line declarations, and replace each block that held one.
 *
 * A whole-message pass rather than a running scope: a tag names its line by id,
 * so where the block sits relative to the prose no longer decides anything, and
 * a coach who writes the block after the paragraph that uses it is still
 * understood. Only `from=` keeps an order, since a line can only continue one
 * already declared.
 */
function declare(blocks: Block[]): { blocks: Block[]; lines: DeclaredLine[] } {
  const lines: DeclaredLine[] = [];
  const out = blocks.map((b): Block => {
    if (b.kind !== "code" || !isLineBlock(b.info)) return b;
    const line = parseDeclaration(b.info, b.content, lines);
    if (line) lines.push(line);
    // A declaration still being streamed is half a line and fails to parse; it
    // is not wrong yet, so the warning waits for the closing fence.
    return { kind: "declaration", broken: !line && b.closed, content: b.content };
  });
  return { blocks: out, lines };
}

/** What a message's links are resolved against: the board, and its own declared lines. */
type Ctx = { jump: Jump; lines: DeclaredLine[] };

// ---------------------------------------------------------------------------
// Position references
// ---------------------------------------------------------------------------

/** A reference the reader can click, resolved down to what the click does. */
type Link = { text: string; title: string; offGame: boolean; run: () => void };

/**
 * What clicking a quoted FEN should do — or null for one that stays plain text.
 *
 * Unresolvable references are deliberately not links: a button that moves the
 * board to the wrong position is worse than the notation the user already reads.
 */
function resolveFen(raw: string, jump: Jump): Link | null {
  const ply = jump.resolveFen(raw);
  // A FEN is unreadable, so the link shows the move it *is* — or just "position"
  // for one the game never reached.
  if (ply != null) {
    return {
      text: jump.label(ply),
      title: `Show the board at ${jump.label(ply)}`,
      offGame: false,
      run: () => jump.onJump(ply),
    };
  }
  // A FEN the scan doesn't hold is a position the game never reached — the
  // engine's recommendation, or a what-if the coach is arguing from. It still
  // goes on the board; it just has no ply to move the scrubber to.
  if (!jump.onFen) return null;
  return {
    text: "position",
    title: "Show this position on the board",
    offGame: true,
    run: () => jump.onFen?.(raw),
  };
}

/**
 * The same for a tagged move — `[dxc4](A:14:..)`.
 *
 * The text is kept exactly as written: the coach chose how to say it, and a link
 * that renamed the move would make the sentence read as something else.
 */
function resolveMove(href: string, text: string, ctx: Ctx): Link | null {
  const tag = parseTag(href);
  if (!tag) return null;
  const target = ctx.jump.resolveTag(tag, text, ctx.lines);
  if (!target) return null;

  if (target.kind === "game") {
    return {
      text,
      title: `Show the board at ${ctx.jump.label(target.ply)}`,
      offGame: false,
      run: () => ctx.jump.onJump(target.ply),
    };
  }
  if (!ctx.jump.onVariation) return null;
  return {
    text,
    title: `Show this position on the board — from ${target.line}, not played in the game`,
    offGame: true,
    run: () => ctx.jump.onVariation?.(target.line, target.step),
  };
}

/** One resolved reference, as the button the reader clicks. */
function linkButton(link: Link, key: string, extraClass = ""): ReactNode {
  return (
    <button
      key={key}
      type="button"
      className={`ply-link${extraClass}${link.offGame ? " off-game" : ""}`}
      title={link.title}
      onClick={link.run}
    >
      {link.text}
    </button>
  );
}

/**
 * Split a text run into plain strings and the FENs quoted in it.
 *
 * Only FENs: moves are tagged links, which the inline parser handles, so this no
 * longer reads the prose for notation at all.
 */
function linkify(text: string, ctx: Ctx | undefined, keyBase: string): ReactNode[] {
  if (!ctx) return [text];

  const out: ReactNode[] = [];
  let last = 0;

  for (const ref of findRefs(text)) {
    const link = resolveFen(ref.raw, ctx.jump);
    if (!link) continue;

    if (ref.start > last) out.push(text.slice(last, ref.start));
    out.push(linkButton(link, `${keyBase}:${ref.start}`));
    last = ref.end;
  }

  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

type Block =
  | { kind: "code"; info: string; content: string; closed: boolean }
  /** A ```line block, replaced by the scoping pass once it has been read. */
  | { kind: "declaration"; broken: boolean; content: string }
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
      // The info string is kept because one value of it is not decoration: a
      // ```line block is the coach declaring a variation, and it is read, not
      // rendered. An unterminated fence still becomes a block, which is what
      // keeps a half-streamed declaration off the screen.
      const info = line.replace(/^\s*```/, "").trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: "code", info, content: body.join("\n"), closed: i < lines.length });
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

function renderBlock(b: Block, ctx: Ctx | undefined): ReactNode {
  switch (b.kind) {
    // A line declaration is metadata for the links, not something to read: it
    // says which half-move sits at which ply so the references below it resolve,
    // and the prose says the same thing in words. It shows only when it cannot
    // be read — the links it should have made are missing either way, and
    // dropping it silently would make that look like a renderer bug.
    case "declaration":
      return b.broken ? (
        <p className="muted" style={{ fontSize: 12.5 }}>
          ⚠ couldn&rsquo;t read a line the coach declared: {b.content.trim()}
        </p>
      ) : null;
    case "code": {
      // A fence holding nothing but a FEN is the case that started all this —
      // render it as the position it denotes, not as a wall of slashes. That
      // holds whether or not the position is one the game reached.
      const only = b.content.trim();
      const link = ctx && isBareFen(only) ? resolveFen(only, ctx.jump) : null;
      if (link) {
        return (
          <p className="fen-line">
            {linkButton({ ...link, text: `⊞ ${link.text}` }, "fen", " block")}
          </p>
        );
      }
      return <pre className="md-code">{b.content}</pre>;
    }
    case "heading": {
      // The chat is already inside an h2 region and these are only emphasis, so
      // every level renders at one weight rather than reopening the type scale.
      return <p className="md-h">{inline(b.text, ctx, "h")}</p>;
    }
    case "list":
      return b.ordered ? (
        <ol className="md-list">
          {b.items.map((it, i) => (
            <li key={i}>{inline(it, ctx, `li${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul className="md-list">
          {b.items.map((it, i) => (
            <li key={i}>{inline(it, ctx, `li${i}`)}</li>
          ))}
        </ul>
      );
    case "quote":
      return <blockquote className="md-quote">{inline(b.text, ctx, "q")}</blockquote>;
    case "rule":
      return <hr className="md-rule" />;
    case "para":
      return <p className="md-p">{inline(b.text, ctx, "p")}</p>;
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

function inline(text: string, ctx: Ctx | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  INLINE.lastIndex = 0;

  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), ctx, `${keyBase}:${last}`));
    const key = `${keyBase}:i${m.index}`;
    const [, , code, bold, star, under, linkText, href] = m;

    if (code !== undefined) {
      // Inline code is linkified too — `rnbq.../ w KQkq - 5 13` in backticks is
      // the same unreadable FEN as the fenced one.
      out.push(
        <code key={key} className="md-code-inline">
          {linkify(code, ctx, key)}
        </code>,
      );
    } else if (bold !== undefined) {
      out.push(<strong key={key}>{linkify(bold, ctx, key)}</strong>);
    } else if (star !== undefined || under !== undefined) {
      out.push(<em key={key}>{linkify((star ?? under) as string, ctx, key)}</em>);
    } else if (linkText !== undefined) {
      // Three cases, in order. An http(s) href is a real link — the coach writes
      // Lichess training links. Anything else is either a move tag naming a
      // position, or nothing: an href that resolves to no position renders as
      // its own text, so a stale line id or a mislabelled move costs the link
      // and never moves the board.
      const move = /^https?:\/\//i.test(href) ? null : ctx && resolveMove(href, linkText, ctx);
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {linkText}
          </a>
        ) : move ? (
          linkButton(move, key)
        ) : (
          <Fragment key={key}>{linkText}</Fragment>
        ),
      );
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) out.push(...linkify(text.slice(last), ctx, `${keyBase}:${last}`));
  return out;
}
