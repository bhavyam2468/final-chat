import { DESKTOP } from "@/lib/paths";
import { requestQuit, requestRestart, shutdown } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/**
 * Control surface for the desktop shell. The server only ever listens on loopback, so this is
 * reachable from the same machine only.
 *
 * POST { action: "stop" }    — quit the app gracefully (children, then PGlite) and exit. In the
 *                              desktop app the shell is asked to end the process tree as well.
 * POST { action: "restart" } — ask the desktop shell to replace this server with a fresh one.
 *
 * Works on every platform including Windows, where a child process cannot receive SIGTERM.
 * "restart" is desktop-only: in web/dev mode there is no supervisor to start a new server.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "restart") {
    const result = requestRestart();
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ ok: true, restarting: true });
  }
  if (body.action !== "stop") return Response.json({ error: 'action must be "stop" or "restart"' }, { status: 400 });
  // In the desktop app "stop" means the whole app, and only the shell can do that: leaving a note
  // for the supervisor is what stops it from treating the exit as a crash and restarting us. The
  // web/dev server has no supervisor, so it just stops itself.
  if (DESKTOP) {
    const result = requestQuit();
    if (!result.ok) return Response.json({ error: result.error }, { status: 500 });
    return Response.json({ ok: true, quitting: true });
  }
  // Answer first, then tear down, so the caller sees a clean 200 instead of a dropped connection.
  setTimeout(() => void shutdown("shell request"), 50);
  return Response.json({ ok: true, stopping: true });
}
