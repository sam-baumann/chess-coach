import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The web app lives in src/web so the server and the browser bundle can share
// src/shared without either owning the repo root.
export default defineConfig({
  root: "src/web",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Trailing slash matters: a bare "/api" prefix also matches the
      // /api.ts source module (Vite's proxy match is a plain startsWith),
      // shadowing it behind the backend and 404ing on import.
      "/api/": "http://localhost:3001",
      "/reviews/": "http://localhost:3001",
    },
  },
});
