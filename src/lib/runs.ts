/* Agent runs live on the server, independent of the browser request that started them.
   Switching chats, closing the tab or reloading only detaches a viewer; the run keeps going and every event is
   buffered, so any page can re-attach (full replay, then live). Stop is explicit (per conversation) and the run
   saves its partial answer before it reports `done`. One run per conversation at a time. */

export type RunEvent = Record<string, unknown>;
type Run = {
  convId: string; assistantId: string; startedAt: number;
  events: RunEvent[]; listeners: Set<(e: RunEvent) => void>; ctrl: AbortController; done: boolean;
};

const g = globalThis as unknown as { __runs?: Map<string, Run> };
const runs: Map<string, Run> = (g.__runs ||= new Map());

export function startRun(convId: string, assistantId: string) {
  if (activeRun(convId)) throw new Error("Conversation already running");
  const run: Run = { convId, assistantId, startedAt: Date.now(), events: [], listeners: new Set(), ctrl: new AbortController(), done: false };
  runs.set(convId, run);
  const emit = (e: RunEvent) => {
    if (run.done) return;
    const last = run.events.at(-1);
    // Reduce token-sized event overhead without changing the replay order.
    if ((e.t === "text" || e.t === "reasoning") && last?.t === e.t) {
      last.d = String(last.d || "") + String(e.d || "");
      run.listeners.forEach((l) => l(e)); return;
    }
    // live tool output is only useful while it runs: keep the buffer small by folding output chunks per call
    if (e.t === "toolOutput") { const prev = run.events.findLast((x) => x.t === "toolOutput" && x.id === e.id); if (prev) { prev.chunk = (String(prev.chunk) + String(e.chunk)).slice(-6000); run.listeners.forEach((l) => l(e)); return; } }
    run.events.push(e);
    run.listeners.forEach((l) => l(e));
  };
  const finish = () => {
    if (run.done) return;
    run.done = true;
    run.listeners.forEach((l) => l({ t: "done" }));
    run.listeners.clear();
    // keep the finished run briefly so a viewer that re-attaches right now still gets the tail
    setTimeout(() => { if (runs.get(convId) === run) runs.delete(convId); }, 15_000).unref();
  };
  return { run, emit, finish, signal: run.ctrl.signal };
}

export const activeRun = (convId: string) => { const r = runs.get(convId); return r && !r.done ? r : undefined; };
export const anyRun = (convId: string) => runs.get(convId);
export const activeIds = () => [...runs.values()].filter((r) => !r.done).map((r) => r.convId);
export function stopRun(convId: string) { const r = activeRun(convId); if (!r) return false; r.ctrl.abort(); return true; }

/** NDJSON stream of a run: everything so far, then live events until `done`. Detaching never stops the run. */
export function attach(run: Run, detach: AbortSignal) {
  const enc = new TextEncoder();
  let off = () => {};
  return new ReadableStream({
    start(ctrl) {
      const send = (e: RunEvent) => { try { ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch {} };
      const close = () => { off(); try { ctrl.close(); } catch {} };
      for (const e of run.events) send(e);
      if (run.done) { send({ t: "done" }); close(); return; }
      const l = (e: RunEvent) => { send(e); if (e.t === "done") close(); };
      run.listeners.add(l);
      off = () => { run.listeners.delete(l); detach.removeEventListener("abort", close); };
      if (detach.aborted) { close(); return; }
      detach.addEventListener("abort", close, { once: true });
    },
    cancel() { off(); },
  });
}

const reservations = ((globalThis as unknown as { __runReservations?: Set<string> }).__runReservations ||= new Set<string>());
/** Claim synchronously, before database awaits; two tabs must not start two runs in one chat. */
export function reserveRun(id: string): (() => void) | null {
  if (reservations.has(id) || activeRun(id)) return null;
  reservations.add(id);
  return () => reservations.delete(id);
}
