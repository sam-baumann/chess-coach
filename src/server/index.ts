import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { PORT, REPO_ROOT, REVIEWS_DIR, ensureDirs, lichessToken, storedUsername } from "./config.ts";
import { getDb, closeDb } from "./db.ts";
import { rebuildIndex, watchGameLog } from "./gamelog.ts";
import { registerRoutes } from "./routes.ts";
import { closeAllSessions } from "./agent.ts";
import { closeAllSse } from "./sse.ts";
import { checkStockfish, reconcileInterruptedSweeps } from "./sweep.ts";

async function main(): Promise<void> {
  ensureDirs();
  getDb();
  const interrupted = reconcileInterruptedSweeps();

  // Derive the log index once at boot, then keep it live. The agent appends to
  // notes/game-log.md during a review; without the watcher the trends view would
  // be stale until the next restart.
  const parsed = rebuildIndex();
  watchGameLog();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" } });

  registerRoutes(app);

  // Published review pages, so the game-review skill's output is viewable
  // in-app. (The Artifact tool isn't available to the SDK — the agent writes
  // reviews/<name>.html and this serves it.)
  // ensureDirs() has created REVIEWS_DIR, so this registers unconditionally —
  // a page the agent writes mid-session is served without a restart.
  await app.register(fastifyStatic, { root: REVIEWS_DIR, prefix: "/reviews/" });

  // In production the built SPA is served from the same origin; in dev, Vite
  // serves it on :5173 and proxies /api here.
  const webDist = join(REPO_ROOT, "dist", "web");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      decorateReply: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      // The root must be explicit: @fastify/static decorates reply.sendFile once,
      // and the /reviews/ registration above got there first — the default root
      // is REVIEWS_DIR, so a bare sendFile("index.html") 404s every deep link.
      return reply.sendFile("index.html", webDist);
    });
  }

  await app.listen({ port: PORT, host: "127.0.0.1" });

  const engine = await checkStockfish();
  console.log(`\n  Chess Improvement Hub`);
  console.log(`  server    http://localhost:${PORT}`);
  console.log(
    `  ui        ${existsSync(webDist) ? `http://localhost:${PORT}` : "http://localhost:5173 (pnpm dev:web)"}`,
  );
  console.log(`  log       ${parsed.entries.length} entries, ${parsed.vocab.length} tags in vocabulary`);
  console.log(`  lichess   ${lichessToken() ? "token found" : "NO TOKEN — see /api/setup-help"}`);
  console.log(`  stockfish ${engine ? "found" : "NOT ON PATH — sweeps will fail"}`);
  if (interrupted > 0) {
    console.log(`  sweeps    ${interrupted} interrupted by a restart, marked failed — re-run them`);
  }
  console.log(`  user      ${storedUsername() ?? "unknown — set .claude/lichess-user.local.md"}\n`);

  const shutdown = async () => {
    closeAllSessions();
    // Before app.close(): an open SSE response is an active socket, and Fastify
    // waits for those, so a single subscribed browser tab would hang Ctrl-C.
    closeAllSse();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
