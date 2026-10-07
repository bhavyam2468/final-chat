/* Agent runs live on the server, independent of the browser request that started them.
   Switching chats, closing the tab or reloading only detaches a viewer; the run keeps going and every event is
   buffered, so any page can re-attach (full replay, then live). Stop is explicit (per conversation) and the run
   saves its partial answer before it reports `done`. One run per conversation at a time.

   Steering: while a run is active, the user can push a message straight into it. The message is saved to the
   database immediately (chained onto the run's tail), buffered on the run, and the agent loop drains it between
   model steps, so the next request carries it with a steering wrapper. The final assistant reply is saved under
   the last steer, so the saved chain reads: user → steer → assistant. */

import type { Attachment } from "../db/schema";

export type RunEvent = Record<string, unknown>;
export type SteerInput = { content: string; attachments?: Attachment[] };
type Run = {
  convId: string; assistantId: string; startedAt: number;
  events: RunEvent[]; listeners: Set<(e: RunEvent) => void>; ctrl: AbortController; done: boolean;
  /** parent id any new steer chains onto: the original user message, then the newest steer */
  tailId: string;
  /** steers waiting for the agent loop to pick up */
  pending: SteerInput[];
};

const g = globalThis as unknown as { __runs?: Map<string, Run> };
const runs: Map<string, Run> = (g.__runs ||= new Map());

export function startRun(convId: string, assistantId: string, parentId = "") {
  const run: Run = { convId, assistantId, startedAt: Date.now(), events: [], listeners: new Set(), ctrl: new AbortController(), done: false, tailId: parentId, pending: [] };
  runs.set(convId, run);
  const emit = (e: RunEvent) => {
    // live tool output is only useful while it runs: keep the buffer small by folding output chunks per call
    if (e.t === "toolOutput") { const prev = run.events.findLast((x) => x.t === "toolOutput" && x.id === e.id); if (prev) { prev.chunk = (String(prev.chunk) + String(e.chunk)).slice(-6000); run.listeners.forEach((l) => l(e)); return; } }
    run.events.push(e);
    run.listeners.forEach((l) => l(e));
  };
  const finish = () => {
    run.done = true;
    run.listeners.forEach((l) => l({ t: "done" }));
    run.listeners.clear();
    // keep the finished run briefly so a viewer that re-attaches right now still gets the tail
    setTimeout(() => { if (runs.get(convId) === run) runs.delete(convId); }, 15_000);
  };
  return { run, emit, finish, signal: run.ctrl.signal };
}

export const activeRun = (convId: string) => { const r = runs.get(convId); return r && !r.done ? r : undefined; };
export const anyRun = (convId: string) => runs.get(convId);
export const activeIds = () => [...runs.values()].filter((r) => !r.done).map((r) => r.convId);
export function stopRun(convId: string) { const r = activeRun(convId); if (!r) return false; r.ctrl.abort(); return true; }

/** Buffer a mid-run steer (already saved to the DB by the caller) and wake the stream with a replayable event. */
export function injectSteer(convId: string, id: string, input: SteerInput) {
  const run = activeRun(convId);
  if (!run) return false;
  const parentId = run.tailId;
  run.tailId = id;
  run.pending.push(input);
  run.events.push({ t: "steer", id, parentId, content: input.content, createdAt: Date.now() });
  run.listeners.forEach((l) => l({ t: "steer", id, parentId, content: input.content, createdAt: Date.now() }));
  return true;
}

/** The agent loop takes whatever arrived since its last check. */
export function drainSteers(convId: string): SteerInput[] {
  const run = runs.get(convId);
  if (!run || !run.pending.length) return [];
  return run.pending.splice(0, run.pending.length);
}

/** Parent for the run's saved assistant reply: the newest steer, or the original user message. */
export function runTail(convId: string, fallback: string): string {
  const run = runs.get(convId);
  return run?.tailId || fallback;
}

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
      off = () => run.listeners.delete(l);
      detach.addEventListener("abort", close, { once: true });
    },
    cancel() { off(); },
  });
}
