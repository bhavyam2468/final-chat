"use client";
/* Canvas runner: the output drawer under an editing canvas.
   Run executes the file in the app's sandbox through /api/run (the same table the `file_run` tool uses),
   streamed into this panel — so the user sees a compiler, not a lecture, and the model can read the very
   same run when it helps. Auto re-runs on save, which is what "auto-compile while I type" means here. */
import { ChevronDown, CircleStop, MessageSquareQuote, RotateCw, Sparkles } from "lucide-react";

export type RunState = {
  phase: "running" | "done";
  cmd?: string;
  lang?: string;
  compile?: boolean;
  code?: number;
  ms?: number;
  out: string;
};

/** Stream one run. Returns the abort handle; callbacks fire per event. */
export function startRun(path: string, content: string | undefined, on: { chunk: (s: string) => void; done: (r: { code: number; ms: number; out: string; cmd?: string }) => void; start?: (i: { cmd?: string; lang?: string; compile?: boolean }) => void }, signal?: AbortSignal) {
  const ctrl = new AbortController();
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  (async () => {
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content }), signal: ctrl.signal });
      if (!res.ok || !res.body) { on.done({ code: 1, ms: 0, out: `run failed: ${res.status} ${await res.text().catch(() => "")}` }); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { t?: string; chunk?: string; code?: number; ms?: number; out?: string; cmd?: string; lang?: string; compile?: boolean };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === "chunk") on.chunk(String(ev.chunk || ""));
          else if (ev.t === "start") on.start?.({ cmd: ev.cmd, lang: ev.lang, compile: ev.compile });
          else if (ev.t === "done") on.done({ code: ev.code ?? 1, ms: ev.ms || 0, out: String(ev.out || ""), cmd: ev.cmd });
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") on.done({ code: 1, ms: 0, out: String((error as Error)?.message || error) });
    }
  })();
  return () => ctrl.abort();
}

export function RunDrawer({ run, path, auto, setAuto, onRun, onStop, onClose, onAsk }: {
  run: RunState;
  path: string;
  auto: boolean;
  setAuto: (v: boolean) => void;
  onRun: () => void;
  onStop: () => void;
  onClose: () => void;
  onAsk: () => void;
}) {
  const running = run.phase === "running";
  const failed = !running && run.code !== 0;
  return <section className="run" aria-label="Run output">
    <header className="run-head">
      {running
        ? <span className="run-dot run-busy" aria-hidden="true" />
        : <span className={"run-dot" + (failed ? " run-bad" : " run-ok")} aria-hidden="true" />}
      <span className="run-name">{path.split("/").pop()}</span>
      <span className="run-meta num">
        {running ? (run.compile ? "compiling…" : "running…")
          : `${failed ? `exit ${run.code}` : "exit 0"}${run.ms ? ` · ${(run.ms / 1000).toFixed(1)}s` : ""}`}
      </span>
      <span className="sp" />
      <button type="button" className={"ed-t" + (auto ? " on" : "")} onClick={() => setAuto(!auto)} title="Re-run every time the file is saved" aria-pressed={auto}><Sparkles /><span>auto</span></button>
      {running
        ? <button type="button" className="ed-t" onClick={onStop} title="Stop"><CircleStop /><span>stop</span></button>
        : <button type="button" className="ed-t" onClick={onRun} title="Run again (Ctrl+Enter)"><RotateCw /><span>run</span></button>}
      {!running && failed && <button type="button" className="ed-t" onClick={onAsk} title="Ask the AI to look at this run"><MessageSquareQuote /><span>ask</span></button>}
      <button type="button" className="ed-t" onClick={onClose} title="Hide output" aria-label="Hide output"><ChevronDown /></button>
    </header>
    <pre className={"run-out" + (failed ? " failed" : "")} tabIndex={0}>{run.out || (running ? "" : "(no output)")}</pre>
  </section>;
}
