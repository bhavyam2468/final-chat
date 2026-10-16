/**
 * Server lifecycle hooks (`next` runs `register()` once per server process).
 *
 * Why this exists: the desktop app runs this server as a child process it starts and stops.
 * A SIGTERM has to stop the background processes the agent left running, close the terminal
 * sessions and flush PGlite before the process dies — otherwise a stop mid-write can replay or
 * lose the last messages. `src/lib/lifecycle.ts` does the work; this file is just the wiring.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Only in a running server, never during `next build` (where nothing may be spawned or written).
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const [{ describePaths, DESKTOP }, { installSignalHandlers }] = await Promise.all([import("@/lib/paths"), import("@/lib/lifecycle")]);
  const info = describePaths();
  console.log(`[app] server starting${info.version ? " v" + info.version : ""} · mode=${info.mode} · port=${process.env.PORT || "3000"}`);
  if (DESKTOP) for (const [k, v] of Object.entries(info)) if (k !== "mode" && v) console.log(`[app]   ${k}: ${v}`);
  installSignalHandlers();

  // Desktop first run: seed the workspace before the window opens so the file browser, skills and
  // memory are there from the first frame instead of appearing on the first agent turn.
  if (DESKTOP) {
    const { ensureWorkspace } = await import("@/lib/workspace");
    await ensureWorkspace().catch((e) => console.warn("[app] workspace seed:", (e as Error).message));
  }
}
