/**
 * Server lifecycle: the one place that turns "stop" into an ordered, bounded teardown.
 * Used by the signal handlers in `src/instrumentation.ts` and by `POST /api/desktop`.
 */
import fs from "fs";
import { DESKTOP, RUNTIME_FILE } from "@/lib/paths";
let stopping = false;

async function parts() {
  const [db, procs, term] = await Promise.all([import("@/db"), import("@/lib/procs"), import("@/lib/terminal")]);
  return { closeDb: db.closeDb, procShutdown: procs.procShutdown, termShutdown: term.termShutdown };
}

/** Stop everything this server owns and exit. Idempotent; never throws. */
export async function shutdown(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  const started = Date.now();
  console.log(`[app] stopping (${reason})`);
  const work = (async () => {
    const { closeDb, procShutdown, termShutdown } = await parts();
    try { procShutdown("SIGTERM"); } catch {}
    try { termShutdown(); } catch {}
    await closeDb();
  })();
  // A wedged child process must not hold the app hostage: the desktop shell has its own grace
  // period and escalates to SIGKILL, so give the clean path a hard ceiling well below that.
  await Promise.race([work.catch((e) => console.warn("[app] shutdown:", (e as Error).message)), new Promise((r) => setTimeout(r, 4000))]);
  console.log(`[app] stopped in ${Date.now() - started}ms`);
  process.exit(0);
}

/**
 * Ask the desktop shell to restart this server.
 *
 * A Node process cannot rebuild itself, and it should not: the shell owns the process, the port
 * and the log. So this writes `restart: true` into the runtime file — that is how the shell tells
 * an intentional restart from a crash, and does not count it against the crash backoff — and then
 * exits through the same ordered teardown as a stop. The shell restarts within a couple of seconds
 * and the window reloads onto the same port.
 */
export function requestRestart(): { ok: boolean; error?: string } {
  if (!DESKTOP) return { ok: false, error: "restart is only available in the desktop app" };
  try {
    const current = fs.existsSync(RUNTIME_FILE) ? JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8")) : {};
    fs.writeFileSync(RUNTIME_FILE, `${JSON.stringify({ ...current, restart: true, restartAt: Date.now() }, null, 2)}\n`);
  } catch (e) {
    return { ok: false, error: `could not write ${RUNTIME_FILE}: ${(e as Error).message}` };
  }
  // Answer the request first, then tear down (the caller sees a clean 200).
  setTimeout(() => void shutdown("restart request"), 100);
  return { ok: true };
}

let installed = false;
/** Wire SIGTERM/SIGINT to `shutdown()`. Called once by `register()` in `src/instrumentation.ts`. */
export function installSignalHandlers() {
  if (installed) return;
  installed = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => void shutdown(sig));
}
