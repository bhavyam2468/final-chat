"use client";
/**
 * A workflow is a window, not a message. The window shows what is happening *now* — the steps and how far
 * each one has got, the sources as they are found and opened, and a log of what the app is doing — and then
 * the report when there is one. The chat only ever receives the report; everything else stays here.
 *
 * The state comes from the run record the server keeps (`/api/workflows/<id>`), polled while the run is live.
 * A workflow may ship its own UI (`workflows/<name>/ui.html`, a Blocks document); if it does, that renders in
 * the body with the run as data, so a workflow can present itself however it likes without the app knowing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, FileText, Play, RotateCw, Square, Waypoints } from "lucide-react";
import { useApp } from "./ctx";
import { StreamMarkdown } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "./Message";
import { Block } from "./Block";

export type WorkflowRun = {
  id: string; name: string; title: string; description: string;
  input: Record<string, string>; chat: string | null; messageId: string | null; process: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: number; endedAt: number | null;
  steps: { id: string; title: string; kind: string; status: string; note: string; detail: string; count: number; target: number }[];
  sources: { url: string; title: string; snippet: string; read: boolean; words?: number; file?: string }[];
  log: { at: number; text: string; kind: string }[];
  progress: number; activity: string; report: string; artifacts: string[]; error: string;
};

/** One poll for the card and the window: 900 ms while it runs, then stop (the record will not change). */
export function useWorkflowRun(id: string | null | undefined, interval = 900) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [error, setError] = useState("");
  const stop = useRef(false);
  const load = useCallback(async () => {
    if (!id) return null;
    const r = await fetch(`/api/workflows/${id}`).catch(() => null);
    if (!r || !r.ok) { setError(r && r.status === 404 ? "This run is not on disk any more." : "Could not read the run."); return null; }
    const j = (await r.json()) as WorkflowRun;
    if (!stop.current) setRun(j);
    return j;
  }, [id]);
  useEffect(() => {
    stop.current = false;
    void load();
    const t = setInterval(async () => { const j = await load(); if (j && j.status !== "running") clearInterval(t); }, interval);
    return () => { stop.current = true; clearInterval(t); };
  }, [load, interval]);
  return { run, error, reload: load };
}

/** Hand the run to a workflow's own Blocks UI: data scripts go inside <ui>, where the runtime reads them. */
function withRunData(source: string, run: WorkflowRun) {
  const script = `<script type="data" name="run">${JSON.stringify(run).replace(/</g, "\\u003c")}</script>`;
  return /<\/ui>\s*$/.test(source) ? source.replace(/<\/ui>\s*$/, `${script}\n</ui>`) : `${source}\n${script}`;
}

const secs = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** The card that sits in the chat: what ran, how far it got, and a way into the window. */
export function WorkflowCard({ part, onOpen }: { part: { run: string; title: string; input: string }; onOpen: (id: string) => void }) {
  const { run } = useWorkflowRun(part.run, 1500);
  const pct = Math.round((run?.progress ?? 0) * 100);
  const live = run?.status === "running";
  return (
    <button className={"wfcard" + (live ? " live" : "")} onClick={() => onOpen(part.run)} title="Open the workflow window">
      <span className="wf-ic"><Waypoints size={13} /></span>
      <span className="wf-body">
        <span className="wf-title">{run?.title || part.title}{part.input ? <span className="wf-q"> — {part.input}</span> : null}</span>
        <span className="wf-meta">
          {run ? run.activity : "loading"} · {pct}%
          {run?.sources.length ? ` · ${run.sources.filter((s) => s.read).length}/${run.sources.length} pages` : ""}
        </span>
        <span className="wf-bar"><i style={{ width: `${pct}%` }} /></span>
      </span>
      <span className="wf-open">open</span>
    </button>
  );
}

/** The window body: steps, sources, log, and the report once there is one. */
export function WorkflowView({ id, setBar }: { id: string; setBar: (n: React.ReactNode) => void }) {
  const app = useApp();
  const h = useMdHandlers();
  const { run, error, reload } = useWorkflowRun(id);
  const [tab, setTab] = useState<"process" | "report">("process");
  const [ui, setUi] = useState<{ source: string; data: unknown } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // a workflow that ships its own Blocks UI gets to present itself; the default is the view below
  useEffect(() => {
    if (!run) return;
    let dead = false;
    fetch(`/api/workflows/${id}/ui`).then((r) => (r.ok ? r.json() : null)).then((j: { ui?: string } | null) => {
      if (!dead && j?.ui) setUi({ source: j.ui, data: run });
    }).catch(() => {});
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!run]);

  const stop = useCallback(async () => { await fetch(`/api/workflows/${id}`, { method: "POST", body: JSON.stringify({ stop: true }) }); void reload(); }, [id, reload]);
  const live = run?.status === "running";
  const pct = Math.round((run?.progress ?? 0) * 100);

  useEffect(() => { if (live) endRef.current?.scrollIntoView({ block: "nearest" }); }, [run?.log.length, live]);

  useEffect(() => {
    if (!run) { setBar(null); return; }
    setBar(
      <>
        <span className={"wfbadge " + run.status}>{run.status}</span>
        {run.status !== "running" && <span className="wf-when">{secs((run.endedAt || Date.now()) - run.startedAt)}</span>}
        {live && <button className="ib sm" aria-label="Stop" title="Stop this workflow" onClick={stop}><Square size={11} /></button>}
        {!live && <button className="ib sm" aria-label="Reload" title="Reload the run" onClick={() => void reload()}><RotateCw size={11} /></button>}
      </>,
    );
    return () => setBar(null);
  }, [run, live, stop, reload, setBar]);

  if (error) return <div className="wf-empty"><AlertTriangle size={14} /> {error}</div>;
  if (!run) return <div className="wf-empty"><span className="spin" /> loading the run…</div>;

  const read = run.sources.filter((s) => s.read);
  const report = run.report || "";

  const bar = (
    <div className="wf-head">
      <div className="wf-headline">
        <span className="wf-title">{run.title}</span>
        {Object.values(run.input).filter(Boolean).map((v, i) => <span key={i} className="wf-ask">{v}</span>)}
      </div>
      <div className="wf-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} className={run.status} />
      </div>
      <div className="wf-statusline">
        <span>{run.status === "running" ? run.activity : run.status === "done" ? `Finished in ${secs((run.endedAt || 0) - run.startedAt)}` : run.error || run.status}</span>
        <span className="wf-count">{run.steps.filter((s) => s.status === "done").length}/{run.steps.length} steps{read.length ? ` · ${read.length} pages` : ""}{report ? ` · ${report.split(/\s+/).length} words` : ""}</span>
      </div>
      <div className="wf-tabs">
        <button className={"wftab" + (tab === "process" ? " on" : "")} onClick={() => setTab("process")}>Process</button>
        <button className={"wftab" + (tab === "report" ? " on" : "")} onClick={() => setTab("report")} disabled={!report}>Report{report ? "" : " (pending)"}</button>
      </div>
    </div>
  );

  // A workflow can bring its own face: its ui.html is a Blocks document, and the run arrives as its data —
  // pushed again on every update, so the document is written once and stays live while the run happens.
  // The bar (progress, tabs, the report) stays either way, and the process view is one tab away.
  const own = !!ui;
  const source = ui ? withRunData(ui.source, run) : "";

  return (
    <div className="wf-view">
      {bar}
      <div className="wf-scroll">
        {tab === "report" ? (
          report
            ? <div className="wf-report"><StreamMarkdown text={report} streaming={false} {...h} />
                {run.artifacts.map((a) => <button key={a} className="wf-file" onClick={() => app.openCanvas({ kind: "file", path: a, title: a.split("/").pop() || a })}><FileText size={12} />{a}</button>)}
              </div>
            : <div className="wf-empty">No report yet.</div>
        ) : own ? (
          <div className="wf-own">
            <Block done source={source} event={{ name: "run", data: run }}
              onEvent={(name) => { if (name === "start" || name === "retry") void fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: run.name, input: run.input, conversationId: run.chat }) }); }} />
          </div>
        ) : (
          <>
            <ol className="wf-steps">
              {run.steps.map((s) => (
                <li key={s.id} className={"wf-step " + s.status}>
                  <span className="wf-dot">{s.status === "done" ? <Check size={10} /> : s.status === "failed" ? <AlertTriangle size={10} /> : s.status === "active" ? <span className="spin" /> : s.status === "stopped" ? <Square size={9} /> : <Play size={9} />}</span>
                  <span className="wf-steptitle">{s.title}</span>
                  <span className="wf-stepmeta">{s.detail || s.note || (s.status === "pending" ? "" : s.status)}</span>
                </li>
              ))}
            </ol>
            {run.sources.length > 0 && (
              <div className="wf-sources">
                <div className="wf-sect">Sources <small>{read.length} opened of {run.sources.length} found</small></div>
                {run.sources.map((s) => (
                  <a key={s.url} className={"wf-src" + (s.read ? " read" : "")} href={s.url} target="_blank" rel="noreferrer">
                    <span className="wf-srctitle">{s.title || s.url}</span>
                    <span className="wf-srcmeta">{s.url.replace(/^https?:\/\//, "").slice(0, 60)}{s.words ? ` · ${s.words} words` : ""}</span>
                  </a>
                ))}
              </div>
            )}
            <div className="wf-log">
              <div className="wf-sect">What it did</div>
              {run.log.map((l, i) => <div key={i} className={"wf-line " + l.kind}><time>{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span>{l.text}</span></div>)}
              <div ref={endRef} />
            </div>
            {run.process && <button className="wf-more" onClick={() => app.openCanvas({ kind: "chat", id: run.process, title: `${run.title} — process` })}>the agent's own transcript is kept with this run — open it</button>}
          </>
        )}
      </div>
    </div>
  );
}
