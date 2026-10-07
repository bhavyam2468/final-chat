import { NextRequest } from "next/server";
import { hostLocked } from "@/lib/settings";
import { APP_NAME, copyText, describe, notify, openPath, summon } from "@/lib/os-bridge";

export const dynamic = "force-dynamic";

/**
 * The desktop bridge over HTTP: notify, open, clipboard, summon. One place for the AI's os_notify
 * tool, the palette, the summon window and scripts/desktop.mjs (which asks here what to run rather
 * than guessing at the machine itself) — so there is one implementation of "talk to the desktop".
 *
 * Nothing here is host *execution*: every action is a fixed argv with no shell. It stays on unless
 * the operator pins the install to the sandbox (HOST_ACCESS=off), where there is no session to
 * talk to. Unsupported actions answer 200 { ok:false, error } so a caller can print the reason.
 */

const locked = () => Response.json({ ok: false, error: "This install runs in a container (HOST_ACCESS=off): the desktop bridge is switched off." }, { status: 403 });

export async function GET() {
  return Response.json({ ok: true, locked: hostLocked(), name: APP_NAME, ...describe() });
}

export async function POST(req: NextRequest) {
  if (hostLocked()) return locked();
  const b = (await req.json().catch(() => ({}))) as { action?: string; title?: string; body?: string; urgency?: string; text?: string; path?: string };
  const action = String(b.action || "");
  if (action === "notify") {
    if (!b.title && !b.body) return Response.json({ ok: false, error: "notify needs a title or a body" }, { status: 400 });
    return Response.json(await notify(String(b.title || APP_NAME), String(b.body || ""), String(b.urgency || "normal")));
  }
  if (action === "open") {
    const target = String(b.path || "").trim();
    if (!target) return Response.json({ ok: false, error: "open needs a path or URL" }, { status: 400 });
    return Response.json(await openPath(target));
  }
  if (action === "clipboard") {
    if (typeof b.text !== "string") return Response.json({ ok: false, error: "clipboard needs text" }, { status: 400 });
    return Response.json(await copyText(b.text));
  }
  if (action === "summon") return Response.json(await summon());
  return Response.json({ ok: false, error: `Unknown action: ${action || "(none)"}` }, { status: 400 });
}
