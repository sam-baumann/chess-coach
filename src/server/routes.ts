import type { FastifyInstance } from "fastify";
import type { ReviewEvent, SweepEvent } from "../shared/events.ts";
import { storedUsername, lichessToken, TOKEN_SETUP_HELP } from "./config.ts";
import {
  attach,
  cancelScheduledClose,
  createSession,
  getSession,
  listSessionsForGame,
  scheduleClose,
  sendUserTurn,
} from "./agent.ts";
import { computeTrends, listEntries, rebuildIndex, skippedHeadings, themeVocab } from "./gamelog.ts";
import { LichessError, fetchGames, getGame, listGames, upsertGames } from "./lichess.ts";
import { boardHtml, traceSvg } from "./render.ts";
import { openSse } from "./sse.ts";
import { checkStockfish, readScan, startSweep, stockfishMissingHelp, sweepBus } from "./sweep.ts";

function clampLimit(raw: string | undefined, fallback: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 200);
}

export function registerRoutes(app: FastifyInstance): void {
  app.get("/api/health", async () => ({
    ok: true,
    username: storedUsername(),
    hasLichessToken: lichessToken() !== null,
    hasStockfish: await checkStockfish(),
  }));

  // ---- games -------------------------------------------------------------

  app.get<{ Querystring: { limit?: string } }>("/api/games", async (req) => ({
    // Clamped: `?limit=` parses to 0 (an empty list) and `?limit=abc` to NaN,
    // which node:sqlite binds as NULL — no limit at all.
    games: listGames(clampLimit(req.query.limit, 30)),
  }));

  app.post<{ Body: { username?: string; max?: number; perfType?: string; rated?: boolean } }>(
    "/api/games/refresh",
    async (req, reply) => {
      const stored = storedUsername();
      const username = req.body?.username ?? stored;
      if (!username) {
        return reply.code(400).send({
          error: "No Lichess username. Pass one, or save yours to .claude/lichess-user.local.md.",
        });
      }
      // The games table holds one player's games — user_color is computed per
      // fetch, so importing someone else's would rewrite the overlapping rows to
      // their perspective and mix two players' ratings into one trend line.
      if (stored && username.toLowerCase() !== stored.toLowerCase()) {
        return reply.code(400).send({
          error: `This hub tracks ${stored}'s games. To follow a different player, change .claude/lichess-user.local.md and restart.`,
        });
      }
      try {
        const games = await fetchGames({
          username,
          max: req.body?.max ?? 20,
          perfType: req.body?.perfType,
          rated: req.body?.rated,
        });
        upsertGames(games);
        return { fetched: games.length, games: listGames(30) };
      } catch (err) {
        if (err instanceof LichessError) {
          return reply.code(err.status === 429 ? 429 : 400).send({
            error: err.message,
            help: err.help,
          });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/games/:id", async (req, reply) => {
    const game = getGame(req.params.id);
    if (!game) return reply.code(404).send({ error: "Unknown game" });
    return { game, scan: readScan(game.id), sessions: listSessionsForGame(game.id) };
  });

  // ---- sweeps ------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: { depth?: number; force?: boolean } }>(
    "/api/games/:id/sweep",
    async (req, reply) => {
      const game = getGame(req.params.id);
      if (!game) return reply.code(404).send({ error: "Unknown game" });
      const result = await startSweep(game.id, game.moves, {
        depth: req.body?.depth,
        force: req.body?.force,
      });
      if (result.status === "unavailable") {
        return reply.code(409).send({ error: result.message ?? stockfishMissingHelp() });
      }
      return result;
    },
  );

  /** One stream for all sweeps — the UI is a single page and filters by gameId. */
  app.get("/api/sweeps/stream", (req, reply) => {
    const channel = openSse<SweepEvent>(req, reply);
    const onEvent = (event: SweepEvent) => channel.send(event);
    sweepBus.on("event", onEvent);
    req.raw.on("close", () => sweepBus.off("event", onEvent));
  });

  // ---- reviews -----------------------------------------------------------

  app.post<{ Body: { gameId?: string } }>("/api/reviews", async (req, reply) => {
    const game = req.body?.gameId ? getGame(req.body.gameId) : null;
    if (!game) return reply.code(400).send({ error: "Unknown or missing gameId" });
    return { session: createSession(game) };
  });

  app.get<{ Params: { id: string } }>("/api/reviews/:id", async (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Unknown review session" });
    return { session };
  });

  app.get<{ Params: { id: string } }>("/api/reviews/:id/stream", (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Unknown review session" });
    const game = getGame(session.gameId);
    if (!game) return reply.code(404).send({ error: "Unknown game" });

    const channel = openSse<ReviewEvent>(req, reply);
    const bus = attach(session.id, game);
    cancelScheduledClose(session.id);
    const onEvent = (event: ReviewEvent) => channel.send(event);
    bus.on("event", onEvent);
    req.raw.on("close", () => {
      bus.off("event", onEvent);
      // Last viewer gone: stop the agent rather than leaving its process and
      // queue resident for the life of the server — but after a grace window, so
      // a navigation or a dropped connection doesn't abort a turn in flight.
      if (bus.listenerCount("event") === 0) scheduleClose(session.id);
    });
  });

  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    "/api/reviews/:id/messages",
    async (req, reply) => {
      const session = getSession(req.params.id);
      if (!session) return reply.code(404).send({ error: "Unknown review session" });
      const game = getGame(session.gameId);
      if (!game) return reply.code(404).send({ error: "Unknown game" });
      const text = req.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: "Empty message" });
      sendUserTurn(session.id, game, text);
      return { ok: true };
    },
  );

  // ---- log & trends ------------------------------------------------------

  app.get("/api/log", async () => ({
    entries: listEntries(),
    vocab: [...themeVocab()].map(([tag, puzzleThemes]) => ({ tag, puzzleThemes })),
    // Blocks the parser rejected. Surfaced so a formatting drift in an
    // agent-written entry is visible rather than silently missing from Trends.
    skipped: skippedHeadings(),
  }));

  app.get("/api/trends", async () => computeTrends());

  /** Escape hatch for when the log was edited by hand outside the watcher. */
  app.post("/api/log/reindex", async () => {
    const parsed = rebuildIndex();
    return { entries: parsed.entries.length, vocab: parsed.vocab.length, skipped: parsed.skipped };
  });

  // ---- rendering ---------------------------------------------------------

  app.get<{ Querystring: { fen?: string; highlight?: string; flip?: string; caption?: string } }>(
    "/api/diagram",
    async (req, reply) => {
      const fen = req.query.fen;
      if (!fen) return reply.code(400).send({ error: "fen is required" });
      try {
        const html = await boardHtml(
          fen,
          (req.query.highlight ?? "").split(",").filter(Boolean),
          req.query.flip === "true",
          req.query.caption ?? "",
        );
        return reply.type("text/html; charset=utf-8").send(html);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { mark?: string; aria?: string } }>(
    "/api/games/:id/trace.svg",
    async (req, reply) => {
      if (!readScan(req.params.id)) {
        return reply.code(404).send({ error: "No sweep on disk for this game yet" });
      }
      try {
        const svg = await traceSvg(
          req.params.id,
          (req.query.mark ?? "").split(",").filter(Boolean),
          req.query.aria ?? "",
        );
        return reply.type("image/svg+xml; charset=utf-8").send(svg);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get("/api/setup-help", async () => ({ lichess: TOKEN_SETUP_HELP, stockfish: stockfishMissingHelp() }));
}
