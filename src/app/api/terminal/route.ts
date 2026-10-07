import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";
import { termCreate, termGet, termKill, termResize, termWrite } from "@/lib/terminal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const NDJSON = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" };

/** GET ?id= — terminal output: backlog, then live, then exit. The session outlives the connection. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const p = id ? termGet(id) : undefined;
  if (!p) return new Response(null, { status: 404 });
  const enc = new TextEncoder();
  let off = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  return new Response(new ReadableStream({
    start(ctrl) {
      const send = (e: Record<string, unknown>) => { try { ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch {} };
      const close = () => { off(); if (ping) clearInterval(ping); try { ctrl.close(); } catch {} };
      if (p.log) send({ t: "log", chunk: p.log });
      if (p.exit !== null) { send({ t: "exit", code: p.exit }); close(); return; }
      const l = (e: { t: "data" | "exit"; chunk?: string; code?: number }) => { send(e.t === "data" ? { t: "data", chunk: e.chunk } : { t: "exit", code: e.code }); if (e.t === "exit") close(); };
      p.listeners.add(l);
      off = () => p.listeners.delete(l);
      ping = setInterval(() => send({ t: "ping" }), 15000);
      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() { off(); if (ping) clearInterval(ping); },
  }), { headers: NDJSON });
}

export async function POST(req: NextRequest) {
  const b = (await req.json()) as { action: "create" | "write" | "resize" | "kill"; id?: string; host?: boolean; cols?: number; rows?: number; cwd?: string; title?: string; data?: string };
  if (b.action === "create") {
    const st = await getSettings();
    const r = termCreate(st, { host: b.host, cols: b.cols, rows: b.rows, cwd: b.cwd, title: b.title });
    return r.ok ? Response.json(r) : Response.json(r, { status: 400 });
  }
  if (b.action === "write") {
    if (!b.id || typeof b.data !== "string") return Response.json({ error: "id and data required" }, { status: 400 });
    const r = termWrite(b.id, b.data);
    return r.ok ? Response.json(r) : Response.json(r, { status: 400 });
  }
  if (b.action === "resize") {
    if (!b.id || !b.cols || !b.rows) return Response.json({ error: "id, cols, rows required" }, { status: 400 });
    const r = termResize(b.id, b.cols, b.rows);
    return r.ok ? Response.json(r) : Response.json(r, { status: 400 });
  }
  if (b.action === "kill") {
    const r = termKill(b.id || "");
    return r.ok ? Response.json(r) : Response.json(r, { status: 400 });
  }
  return Response.json({ error: "unknown action" }, { status: 400 });
}
