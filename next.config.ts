import path from "node:path";
import type { NextConfig } from "next";

/**
 * The app ships two ways from one build:
 *  - `npm run dev` / `npm start` — the historical web server.
 *  - `output: "standalone"` — a self-contained `.next/standalone/server.js` that the Tauri
 *    desktop shell runs as a child process out of its own bundle (see docs/DESKTOP.md).
 */
const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname || process.cwd()),
  },
  serverExternalPackages: ["@electric-sql/pglite", "mammoth", "node-tikzjax", "node-pty"],
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
  // NOTE on `.next/standalone` contents (deliberately not configured here):
  // Turbopack's file tracer reacts to runtime-value filesystem calls and dynamic requires in
  // src/app/api/terminal/route.ts (optional native node-pty) and src/app/vendor/[...path]/route.ts
  // (reads ./vendor) by tracing the *whole project* into .next/standalone. That is only extra
  // files, never missing ones, and `outputFileTracingExcludes` is not a safe fix: excluding the
  // project globs for a route also drops the route's own server chunks, which then fails at
  // run time with ChunkLoadError. scripts/desktop/prepare.mjs therefore copies the standalone
  // output and deletes everything that is not part of the server (see APP_SERVER_KEEP).
};

export default nextConfig;
