import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";
import { ensureWorkspace } from "@/lib/workspace";
import { recentRuns, runFile, runnerFor } from "@/lib/file-run";

/**
 * The canvas runner. POST starts one file run and streams its output as NDJSON
 * (`start` → `chunk`… → `done`), GET returns what was last run in this process so a reopened
 * canvas shows the previous result. Only workspace files run, always in the app's sandbox.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NDJSON = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } as const;

export async function GET(req: NextRequest) {
  await ensureWorkspace();
  const path = req.nextUrl.searchParams.get("path") || undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") || 4) || 4;
  const runs = recentRuns(path, limit).map(({ id, path: p, cmd, code, ms, at, out, ok, lang }) => ({ id, path: p, cmd, lang, code, ms, at, ok, out: out.slice(-8000) }));
  return Response.json({ runs });
}

export async function POST(req: NextRequest) {
  await ensureWorkspace();
  let body: { path?: string; content?: string; args?: string; timeout?: number };
  try { body = (await req.json()) as typeof body; } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const target = String(body.path || "").trim();
  if (!target) return Response.json({ error: "path required" }, { status: 400 });
  const runner = runnerFor(target);
  const settings = await getSettings();

  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(event) + "\n")); } catch { closed = true; }
      };
      send({ t: "start", path: target, lang: runner?.lang || "", compile: !!runner?.compile });
      runFile(settings, target, {
        content: typeof body.content === "string" ? body.content : undefined,
        args: body.args,
        timeout: body.timeout,
        onData: (chunk) => send({ t: "chunk", chunk: String(chunk).slice(0, 32_000) }),
        signal: req.signal,
      }).then((r) => {
        send({ t: "done", ok: r.ok, code: r.code, ms: r.ms, cmd: r.cmd, out: r.out.slice(-40_000) });
        closed = true; try { controller.close(); } catch {}
      }).catch((error) => {
        send({ t: "done", ok: false, code: 1, out: String(error instanceof Error ? error.message : error) });
        closed = true; try { controller.close(); } catch {}
      });
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: NDJSON });
}
