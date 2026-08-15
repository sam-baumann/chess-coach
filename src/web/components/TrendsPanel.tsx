import { useEffect, useState } from "react";
import type { LogEntry, Trends } from "@shared/events.ts";
import { api } from "../api.ts";

/**
 * One line per time control. Bullet, blitz and rapid are separate rating pools —
 * plotted as a single series they produce a saw-tooth that reads as rating swings
 * the player never had.
 */
function RatingSparks({ points }: { points: Trends["ratingSeries"] }) {
  const bySpeed = new Map<string, Trends["ratingSeries"]>();
  for (const p of points) {
    const bucket = bySpeed.get(p.speed);
    if (bucket) bucket.push(p);
    else bySpeed.set(p.speed, [p]);
  }
  const plottable = [...bySpeed.entries()]
    .filter(([, ps]) => ps.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  if (plottable.length === 0) return <p className="muted">Not enough rated games yet.</p>;

  return (
    <>
      {plottable.map(([speed, ps]) => (
        <RatingSpark key={speed} speed={speed} points={ps} />
      ))}
    </>
  );
}

function RatingSpark({ speed, points }: { speed: string; points: { playedAt: number; rating: number }[] }) {
  const w = 280;
  const h = 70;
  const lo = Math.min(...points.map((p) => p.rating));
  const hi = Math.max(...points.map((p) => p.rating));
  const span = Math.max(1, hi - lo);
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.rating - lo) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label={`${speed} rating from ${lo} to ${hi} over ${points.length} games`}
      >
        <path d={d} className="tline" />
      </svg>
      <p className="num" style={{ margin: "0 0 10px" }}>
        {speed} · {lo} – {hi} · {points.length} games
      </p>
    </>
  );
}

export function TrendsPanel() {
  const [trends, setTrends] = useState<Trends | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [skipped, setSkipped] = useState<{ line: number; heading: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Without the catch a failed request leaves trends null forever, so the panel
    // renders "Loading…" permanently and the rejection only reaches the console.
    void api.trends().then(setTrends).catch((err: Error) => setError(err.message));
    void api
      .log()
      .then((r) => {
        setEntries(r.entries);
        setSkipped(r.skipped);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="card notice">
        <strong className="err">Could not load your trends</strong>
        <p className="muted" style={{ marginBottom: 0 }}>{error}</p>
      </div>
    );
  }

  if (!trends) return <p className="muted">Loading…</p>;

  // A dropped entry is otherwise invisible: the agent reports "logged" and the
  // block simply never appears in any of the counts below.
  const skippedNotice = skipped.length > 0 && (
    <div className="card notice" style={{ gridColumn: "1 / -1" }}>
      <strong className="err">
        {skipped.length} log entr{skipped.length === 1 ? "y is" : "ies are"} not being counted
      </strong>
      <p className="muted" style={{ margin: "6px 0 0" }}>
        The heading doesn&rsquo;t match the format <code>notes/game-log.md</code> prescribes, so
        the block is skipped. Fix the heading and it will be picked up on save.
      </p>
      <ul className="muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {skipped.map((s) => (
          <li key={s.line} className="mono" style={{ fontSize: 12.5 }}>
            line {s.line}: {s.heading}
          </li>
        ))}
      </ul>
    </div>
  );

  const unknownNotice = trends.unknownTags.length > 0 && (
    <div className="card notice" style={{ gridColumn: "1 / -1" }}>
      <strong className="err">
        {trends.unknownTags.length} tag{trends.unknownTags.length === 1 ? "" : "s"} not in the
        vocabulary
      </strong>
      <p className="muted" style={{ margin: "6px 0 0" }}>
        <span className="mono">{trends.unknownTags.join(", ")}</span> — these don&rsquo;t appear in
        the table in <code>notes/game-log.md</code>, so they carry no drill themes and a
        near-synonym splits one habit&rsquo;s count across two names.
      </p>
    </div>
  );

  if (trends.entryCount === 0) {
    return (
      <div className="trend-grid">
        {skippedNotice}
        {unknownNotice}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Nothing logged yet</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            The coach writes a six-line note to <code>notes/game-log.md</code> after each review.
            Trends appear here once a few games have accumulated — a single bad move teaches
            nothing, the same one across five games is a training plan.
          </p>
        </div>
      </div>
    );
  }

  const max = Math.max(...trends.themeCounts.map((t) => t.count), 1);

  return (
    <div className="trend-grid">
      {skippedNotice}
      {unknownNotice}
      {/* The log's own rule: raise a theme at three-plus games, or two of the last
          three. Below that, naming a pattern invents one — so this renders
          nothing rather than "your most common tag so far". */}
      {trends.recurring ? (
        <div className="card habit">
          <p className="eyebrow">The habit to work on</p>
          <p className="tag-big">{trends.recurring.tag}</p>
          <p style={{ margin: 0 }}>
            {trends.recurring.reason === "three-or-more"
              ? `Appears in ${trends.recurring.count} logged games.`
              : "Appears in two of your last three reviews."}
          </p>
          {trends.recurring.puzzleThemes.length > 0 ? (
            <div className="drills">
              {trends.recurring.puzzleThemes.slice(0, 2).map((theme) => (
                <a key={theme} href={`https://lichess.org/training/${theme}`} target="_blank" rel="noreferrer">
                  drill {theme}
                </a>
              ))}
            </div>
          ) : trends.recurring.knownTag ? (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              Puzzles can&rsquo;t fix this one — it needs study away from the tactics trainer.
            </p>
          ) : (
            // Not the same thing as an explicit "—" in the vocabulary table: an
            // unrecognised tag has no drills because it is misspelt.
            <p className="err" style={{ fontSize: 13, marginBottom: 0 }}>
              <code>{trends.recurring.tag}</code> isn&rsquo;t in the vocabulary table in{" "}
              <code>notes/game-log.md</code>, so it has no drills. Check the spelling — a
              near-synonym tag hides the recurrence it&rsquo;s meant to reveal.
            </p>
          )}
        </div>
      ) : (
        <div className="card">
          <p className="eyebrow">No recurring habit yet</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            A theme is worth acting on once it shows up in three games, or in two of the last
            three. {trends.entryCount} game{trends.entryCount === 1 ? "" : "s"} logged so far —
            below that threshold, a pattern would be coincidence.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Themes across all reviews</h2>
        <ul className="freq">
          {trends.themeCounts.map((t) => (
            <li key={t.tag}>
              <span className="tag">{t.tag}</span>
              <span className="track">
                <i style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
              <span className="count">{t.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Rating</h2>
        <RatingSparks points={trends.ratingSeries} />
      </div>

      <div className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Log</h2>
        {entries.map((e) => (
          <div key={e.id} style={{ paddingBottom: 16, marginBottom: 16, borderBottom: "1px solid var(--rule)" }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              {e.date} · {e.kind === "player-review" ? "player review" : `${e.colour} vs ${e.opponent}`} ·{" "}
              {e.opening ?? "—"} · {e.result ?? "—"}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              <strong>Struggled.</strong> {e.struggled}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              <strong>Held up.</strong> {e.heldUp}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Work on.</strong> {e.workOn}
            </p>
            <div className="drills">
              {e.themes.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
