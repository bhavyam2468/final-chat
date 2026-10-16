import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";
import { devFileUrl } from "@/lib/devtools";

export const dynamic = "force-dynamic";

type Mock = { search: (j: unknown) => unknown; complete: (j: unknown) => unknown; stream: (j: unknown) => AsyncGenerator<string>; models: () => unknown };
/**
 * The mock lives in dev/ and is loaded from disk only while developer mode is on. In the desktop
 * bundle dev/mock-llm.mjs is shipped next to the server (prepare.mjs copies it) so offline
 * development and this app's own smoke test keep working outside a checkout.
 */
async function mock(): Promise<Mock | null> {
  if (!(await getSettings()).dev) return null;
  const f = devFileUrl("mock-llm.mjs");
  if (!f) return null;
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
