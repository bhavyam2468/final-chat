import { NextRequest } from "next/server";
import path from "path";
import { pathToFileURL } from "url";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Mock = { search: (j: unknown) => unknown; complete: (j: unknown) => unknown; stream: (j: unknown) => AsyncGenerator<string>; models: () => unknown };
/** The mock lives in dev/ (not bundled); loaded from disk only when developer mode is on. */
async function mock(): Promise<Mock | null> {
  if (!(await getSettings()).dev) return null;
  const f = pathToFileURL(path.join(process.cwd(), "dev/mock-llm.mjs")).href;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ f).catch(() => null);
}

export async function GET() {
  const m = await mock();
  return m ? Response.json(m.models()) : new Response("Not found", { status: 404 });
}

export async function POST(req: NextRequest) {
  const m = await mock();
  if (!m) return new Response("Not found", { status: 404 });
  const j = await req.json().catch(() => ({}));
  if (req.nextUrl.pathname.endsWith("/search")) return Response.json(m.search(j));
  if (!j.stream) return Response.json(m.complete(j));
  const it = m.stream(j), enc = new TextEncoder();
  return new Response(new ReadableStream({
    async pull(c) { const r = await it.next(); if (r.done) c.close(); else c.enqueue(enc.encode(r.value)); },
    cancel() { it.return(undefined); },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
