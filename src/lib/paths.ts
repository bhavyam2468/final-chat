import path from "path";

/**
 * Where things live.
 *
 * Web / dev (`npm run dev`, `npm start`, `node .next/standalone/server.js`): every path stays
 * relative to the project directory exactly as it always was, so an existing checkout, its
 * `./workspace`, `./data/pglite` and `./.venv` keep working untouched.
 *
 * Desktop (the Tauri shell runs `server.js` out of a read-only bundle): the app may not write
 * next to its own code, so the shell passes every writable location in as an environment
 * variable and this module is the single place that reads them. The shell also parses
 * `<data>/config.env` and exports it into our environment, which keeps the configuration file
 * logic in one place (Rust) and this module free of filesystem access — deliberate: Next's file
 * tracer follows `fs` calls on values it cannot resolve statically and then decides the whole
 * project is a dependency of every route that imports this module.
 *
 * Resolution rules, in order:
 *   1. an absolute path in the environment wins (the shell sets these),
 *   2. a relative path in the environment resolves against APP_ROOT,
 *   3. otherwise the historical project-relative default is used.
 */

export const DESKTOP = process.env.APP_MODE === "desktop";

/** Code root: the standalone server directory in a bundle, the project root in dev. */
export const APP_ROOT = path.resolve(process.env.APP_ROOT || process.cwd());

/** Everything the app writes without asking. Defaults to APP_ROOT so web mode never changes. */
export const DATA_DIR = resolve("APP_DATA_DIR", APP_ROOT);

/** Agent/workspace root. */
export const WORKSPACE_DIR = resolve("WORKSPACE_DIR", "./workspace");

/** Seed files copied into a fresh workspace. Bundled separately from the code in desktop builds. */
export const TEMPLATE_DIR = resolve("WORKSPACE_TEMPLATE_DIR", "./workspace-template");

/** Embedded Postgres (PGlite) directory, used when DATABASE_URL is unset. */
export const PGLITE_DIR = resolve("PGLITE_DIR", "./data/pglite");

/** Log directory the shell writes its own logs to and offers to open. */
export const LOG_DIR = resolve("APP_LOG_DIR", "./data/logs");

/** Python environment for run_python / pip / office previews. */
export const VENV_DIR = resolve("VENV_DIR", "./.venv");

/** Optional requirement list for VENV_DIR (shipped as a resource in desktop builds). */
export const PY_REQUIREMENTS = resolve("PY_REQUIREMENTS", "./python-requirements.txt");

/** Version of the desktop shell, when it launched us (shown in health checks and logs). */
export const APP_VERSION = process.env.APP_VERSION || "";

/** User-editable configuration file. Read and applied by the shell; only reported here. */
export const ENV_FILE = resolve("ENV_FILE", "./config.env");

/**
 * The shell's runtime file: the live port and pid, so scripts (`scripts/minimalist-ai`),
 * `scripts/chatsync.mjs` and a second launch can find the running app. This server only writes it
 * to ask for a restart (`POST /api/desktop {action:"restart"}`); the shell owns everything else in it.
 */
export const RUNTIME_FILE = resolve("RUNTIME_FILE", "./runtime.json");

/** Absolute paths pass through; relative ones are anchored at APP_ROOT, never at the cwd. */
function resolve(name: string, fallback: string): string {
  const raw = (process.env[name] || "").trim();
  if (!raw) return path.resolve(APP_ROOT, fallback);
  return path.isAbsolute(raw) ? raw : path.resolve(APP_ROOT, raw);
}

/** One line for the startup log and `/api/health`: where this process thinks it is looking. */
export function describePaths() {
  return {
    mode: DESKTOP ? "desktop" : "web",
    version: APP_VERSION,
    root: APP_ROOT,
    data: DATA_DIR,
    workspace: WORKSPACE_DIR,
    template: TEMPLATE_DIR,
    pglite: PGLITE_DIR,
    venv: VENV_DIR,
    envFile: ENV_FILE,
  };
}
