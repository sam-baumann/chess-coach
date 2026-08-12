import { useEffect, useState } from "react";
import type { LogEntry, Trends } from "@shared/events.ts";
import { api } from "../api.ts";

function RatingSpark({ points }: { points: { playedAt: number; rating: number }[] }) {
  if (points.length < 2) return <p className="muted">Not enough rated games yet.</p>;
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
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`Rating from ${lo} to ${hi}`}>
        <path d={d} className="tline" />
      </svg>
      <p className="num" style={{ margin: 0 }}>
        {lo} – {hi} · {points.length} games
      </p>
    </>
  );
}

export function TrendsPanel() {
  const [trends, setTrends] = useState<Trends | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    void api.trends().then(setTrends);
    void api.log().then((r) => setEntries(r.entries));
  }, []);

  if (!trends) return <p className="muted">Loading…</p>;

  if (trends.entryCount === 0) {
    return (
      <div className="card">
        <h2>Nothing logged yet</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          The coach writes a six-line note to <code>notes/game-log.md</code> after each review.
          Trends appear here once a few games have accumulated — a single bad move teaches
          nothing, the same one across five games is a training plan.
        </p>
      </div>
    );
  }

  const max = Math.max(...trends.themeCounts.map((t) => t.count), 1);

  return (
    <div className="trend-grid">
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
          ) : (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              Puzzles can&rsquo;t fix this one — it needs study away from the tactics trainer.
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
        <RatingSpark points={trends.ratingSeries} />
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
