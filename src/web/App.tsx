import { useEffect, useState } from "react";
import { api, type Health } from "./api.ts";
import { GamesList } from "./components/GamesList.tsx";
import { ReviewView } from "./components/ReviewView.tsx";
import { TrendsPanel } from "./components/TrendsPanel.tsx";

type View = { tab: "games"; gameId: string | null } | { tab: "trends" };

export function App() {
  const [view, setView] = useState<View>({ tab: "games", gameId: null });
  const [health, setHealth] = useState<Health | null>(null);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");

  useEffect(() => {
    void api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    // Leaving the attribute off is the "system" state, which the palette handles
    // via prefers-color-scheme. Stamping it is what lets an explicit choice win.
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Chess Improvement Hub</p>
          <h1>
            Review, and <em>notice the pattern</em>
          </h1>
        </div>
        <nav className="tabs">
          <button
            aria-current={view.tab === "games" ? "page" : undefined}
            onClick={() => setView({ tab: "games", gameId: null })}
          >
            Games
          </button>
          <button aria-current={view.tab === "trends" ? "page" : undefined} onClick={() => setView({ tab: "trends" })}>
            Trends
          </button>
          <button
            onClick={() => setTheme((t) => (t === "system" ? "dark" : t === "dark" ? "light" : "system"))}
            title="Cycle theme: system → dark → light"
          >
            {theme === "system" ? "◐" : theme === "dark" ? "●" : "○"}
          </button>
        </nav>
      </header>

      {view.tab === "trends" ? (
        <TrendsPanel />
      ) : view.gameId ? (
        <ReviewView gameId={view.gameId} onBack={() => setView({ tab: "games", gameId: null })} />
      ) : (
        <GamesList health={health} onOpen={(gameId) => setView({ tab: "games", gameId })} />
      )}
    </div>
  );
}
