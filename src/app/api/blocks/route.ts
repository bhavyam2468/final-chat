import os from "os";
import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";
import { ensureWorkspace, resolvePath, WS } from "@/lib/workspace";
import { runPython, runShell } from "@/lib/exec";
import { procLogs } from "@/lib/procs";

/**
 * Backend-neutral Blocks bridge.
 *
 * Blocks are rendered in an iframe, so they cannot safely assume that the thing producing data is
 * Python, Bash, or a particular process manager. This endpoint gives the runtime one small streaming
 * protocol instead: chunks are NDJSON events, and the same result can drive text, tables, or charts.
 * Host access is deliberately not exposed here; a block always uses the app's sandbox. Host commands
 * remain an explicit agent capability (`host_shell`).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  backend?: string;
  code?: string;
  command?: string;
  name?: string;
  follow?: boolean;
  cwd?: string;
  timeout?: number;
};

const MAX_CODE = 120_000;
const MAX_COMMAND = 24_000;

function resourceSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const cpus = Math.max(1, os.cpus().length);
  const load = os.loadavg();
  const processMemory = process.memoryUsage();
  return {
    at: Date.now(),
    cpuCount: cpus,
    load1: Number(load[0].toFixed(3)),
    load5: Number(load[1].toFixed(3)),
    load15: Number(load[2].toFixed(3)),
    cpuPercent: Math.min(100, Math.round((load[0] / cpus) * 1000) / 10),
    memoryTotal: total,
    memoryFree: free,
    memoryUsed: total - free,
    memoryPercent: Math.round(((total - free) / total) * 1000) / 10,
    processRss: processMemory.rss,
    processHeap: processMemory.heapUsed,
    uptime: os.uptime(),
  };
}

const jsonLine = (value: Record<string, unknown>) => JSON.stringify(value) + "\n";

export async function POST(req: NextRequest) {
  await ensureWorkspace();
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, error: "Expected an object" }, { status: 400 });

  const backend = String(body.backend || "").toLowerCase();
  if (!["python", "bash", "process", "resource"].includes(backend)) {
    return Response.json({ ok: false, error: "backend must be python, bash, process, or resource" }, { status: 400 });
  }
  if (backend === "resource") return new Response(jsonLine({ t: "data", data: resourceSnapshot() }) + jsonLine({ t: "done", ok: true, code: 0 }), { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });

  const attachedProcess = backend === "process" && String(body.name || "").trim();
  const source = backend === "python" ? String(body.code || "") : String(body.command || "");
  const max = backend === "python" ? MAX_CODE : MAX_COMMAND;
  if (!attachedProcess && !source.trim()) return Response.json({ ok: false, error: `${backend} source is empty` }, { status: 400 });
  if (source.length > max) return Response.json({ ok: false, error: `${backend} source is too large` }, { status: 413 });

  const settings = await getSettings();
  // Blocks run from a user-visible response, but never inherit host terminal access. Keep cwd inside
  // the configured workspace even when a model puts an absolute path in the request.
  let cwd: string;
  try { cwd = body.cwd ? resolvePath(String(body.cwd), "sandbox") : WS; }
  catch { return Response.json({ ok: false, error: "Invalid workspace path" }, { status: 400 }); }
  const timeout = Math.min(300_000, Math.max(2_000, Number(body.timeout) || (backend === "process" ? 120_000 : 60_000)));
  let closed = false;
  const cancel = new AbortController();
  const abort = () => cancel.abort();
  if (req.signal.aborted) abort();
  else req.signal.addEventListener("abort", abort, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(jsonLine(event))); } catch { closed = true; }
      };
      const onData = (chunk: string) => { for (let i = 0; i < chunk.length; i += 32_000) send({ t: "chunk", chunk: chunk.slice(i, i + 32_000) }); };
      const signal = cancel.signal;
      const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      (async () => {
        send({ t: "start", backend, ...(attachedProcess ? { name: String(body.name) } : { cwd: cwd.startsWith(WS) ? cwd.slice(WS.length).replace(/^\//, "") || "." : "." }) });
        let result: { code: number; out: string };
        if (attachedProcess) {
          // A named process may have been started by proc_start on the sandbox or
          // host. We only tail that existing process; Blocks cannot launch an
          // arbitrary host command or silently elevate its access.
          let latest = "";
          const deadline = Date.now() + timeout;
          do {
            if (signal.aborted) break;
            const snapshot = await procLogs({ name: String(body.name), tail: 200 });
            latest = snapshot.result;
            send({ t: "data", data: { name: String(body.name), result: latest, running: /: running ·/.test(latest) } });
            if (!body.follow || !/: running ·/.test(latest) || Date.now() >= deadline) break;
            await wait(500);
          } while (!closed);
          result = { code: /no process|^error/i.test(latest) ? 1 : 0, out: latest };
        } else {
          result = backend === "python"
            ? await runPython(settings, source, timeout, { onData, signal })
            : await runShell(settings, source, timeout, false, cwd, { onData, signal });
        }
        send({ t: "done", ok: result.code === 0, code: result.code, out: result.out.slice(-400_000) });
        if (!closed) { closed = true; try { controller.close(); } catch {} }
      })().catch((error) => {
        send({ t: "done", ok: false, code: 1, out: String(error instanceof Error ? error.message : error) });
        if (!closed) { closed = true; try { controller.close(); } catch {} }
      }).finally(() => req.signal.removeEventListener("abort", abort));
    },
    cancel() { closed = true; cancel.abort(); req.signal.removeEventListener("abort", abort); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
