"use client";
/* The workflow window.
 *
 * A workflow is a window, not a block: it can hold blocks, and this one does — the Evidence pane is a
 * real BlocksUI surface, so a workflow's UI is authored with the same library the model writes in
 * chat. The rest is native because it has to be interactive (sources open pages, the report copies and
 * saves) or always live (the step rail and the log).
 *
 * Everything a run did lives here: every query, every candidate, what each page actually said, the
 * draft, the checker's findings. The chat only ever receives the report, which is why a run that read
 * thirty pages costs one message of context. */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleStop, Copy, Check, Download, ExternalLink, FileText, FlaskConical, Globe, ListTree, ScrollText, SquareTerminal, RotateCw } from "lucide-react";
import { fileUrl, useApp } from "./ctx";
import { Block } from "./Block";
import { StreamMarkdown } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "./Message";
import type { PaneView, RunEvent, RunState, Source } from "@/lib/workflows/types";

const PANE_ICON: Record<PaneView, typeof Globe> = { steps: ListTree, plan: ListTree, sources: Globe, evidence: FlaskConical, report: ScrollText, log: SquareTerminal };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "·");
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);

/** Evidence is the block-backed pane: one x-list per sub-question, quotes kept verbatim. */
function evidenceBlock(run: RunState): string {
  const read = run.sources.filter((s) => s.read && (s.claims?.length || s.points?.length));
  const sub = run.plan?.sub || [];
  const groups = sub.map((s) => ({ s, ev: read.filter((e) => (e.answers || []).includes(s.id)) }));
  const orphan = read.filter((e) => !sub.some((s) => (e.answers || []).includes(s.id)));
  const block = (title: string, sub2: string, ev: Source[]) => {
    if (!ev.length) return "";
    const rows = ev.flatMap((s) => [
      ...(s.claims || []).map((c) => `${esc(c.text)} | “${esc(c.quote)}” — ${esc(s.title)} | [${s.id}]`),
      ...(s.points || []).map((p) => `${esc(p)} | context — ${esc(s.title)} | [${s.id}]`),
    ]);
    return `<x-section title="${esc(title)}"${sub2 ? ` subtitle="${esc(sub2)}"` : ""}>\n<x-list dense>\n${rows.join("\n")}\n</x-list>\n</x-section>`;
  };
  const parts = groups.map((g) => block(`${g.s.id} · ${g.s.q}`, `${g.ev.length} source${g.ev.length === 1 ? "" : "s"} · ${g.ev.reduce((a, e) => a + (e.claims?.length || 0), 0)} claims`, g.ev))
    .filter(Boolean);
  if (orphan.length) parts.push(block("Other evidence", `${orphan.length} pages that answered none of the sub-questions`, orphan));
  return parts.join("\n\n");
}

export const WorkflowView = memo(function WorkflowView({ runId, setBar }: { runId: string; setBar?: (n: React.ReactNode) => void }) {
  const app = useApp();
  const md = useMdHandlers();
  const [run, setRun] = useState<RunState | null>(null);
  const [gone, setGone] = useState(false);
  const [pane, setPane] = useState<PaneView | null>(null);
  const [picked, setPicked] = useState(false); // the user chose a pane: stop following the run
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const runRef = useRef<RunState | null>(null);
  runRef.current = run;

  // ---- live run: NDJSON replay-then-live, re-attached if the stream ever drops
  useEffect(() => {
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const ac = new AbortController();
    const apply = (e: RunEvent) => {
      if (e.t === "state") { setRun(e.state); setGone(false); return; }
      setRun((r) => {
        if (!r) return r;
        if (e.t === "step") return { ...r, steps: r.steps.map((s) => (s.id === e.id ? { ...s, ...e.patch } : s)) };
        if (e.t === "log") return { ...r, log: [...r.log, e.line].slice(-600) };
        if (e.t === "plan") return { ...r, plan: e.plan };
        if (e.t === "sources") return { ...r, sources: e.sources };
        if (e.t === "report") return { ...r, report: e.report };
        if (e.t === "check") return { ...r, check: e.check };
        if (e.t === "done") return { ...r, status: e.status, messageId: e.messageId ?? r.messageId, error: e.error };
        return r;
      });
    };
    const attach = async () => {
      let res: Response;
      try { res = await fetch(`/api/workflows/run?id=${encodeURIComponent(runId)}&stream=1`, { signal: ac.signal }); }
      catch { if (!stop) retry = setTimeout(attach, 2000); return; }
      if (stop) return;
      if (!res.ok) { setGone(true); return; }
      // x-ndjson also contains "json": match the exact media type, or a live run hangs on res.json()
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        const j = await res.json() as { run: RunState };
        if (!stop) { setRun(j.run); setGone(false); }
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stop) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) if (line.trim()) { try { apply(JSON.parse(line) as RunEvent); } catch { /* partial line */ } }
      }
      // a dropped stream must not freeze the window while the run is still alive on the server
      if (!stop && runRef.current?.status === "running") retry = setTimeout(attach, 1500);
    };
    void attach();
    return () => { stop = true; if (retry) clearTimeout(retry); ac.abort(); };
  }, [runId]);

  // elapsed clock, only while the run is alive
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run?.status]);

  // follow the run until the user picks a pane (the window shows what is happening, not a menu)
  const running = run?.status === "running";
  const suggest: PaneView = useMemo(() => {
    if (!run) return "plan";
    if (run.report) return "report";
    const step = run.steps.find((s) => s.status === "running") || [...run.steps].reverse().find((s) => s.status === "done");
    switch (step?.id) {
      case "plan": return "plan";
      case "search": case "select": case "read": case "gaps": return "sources";
      case "write": case "check": case "deliver": return "report";
      default: return "plan";
    }
  }, [run]);
  const active: PaneView = pane || suggest;

  const stop = useCallback(() => { void fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stop: runId }) }); }, [runId]);
  const reopen = useCallback(() => { void fetch(`/api/workflows/run?id=${encodeURIComponent(runId)}&stream=1`).catch(() => {}); setGone(false); }, [runId]);

  // the window's own controls live in the bottom bar, like every other canvas
  useEffect(() => {
    if (!setBar) return;
    setBar(<>
      {run && (
        <span className="wf-bar-stats">
          {run.stats.queries} queries · {run.stats.read} pages · {run.stats.claims} claims
          {run.check && <> · {run.check.ok ? "checked" : `${run.check.issues.length} issue${run.check.issues.length === 1 ? "" : "s"}${run.check.revised ? " (revised)" : ""}`}</>}
        </span>
      )}
      {running && <button className="ib sm" aria-label="Stop run" title="Stop this run" onClick={stop}><CircleStop /></button>}
      {run?.report && <button className="ib sm" aria-label="Copy report" title="Copy the report" onClick={async () => { await navigator.clipboard.writeText(run.report || ""); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check /> : <Copy />}</button>}
      {run?.report && <button className="ib sm" aria-label="Open report in a window" title="Open the report as a canvas" onClick={() => app.openCanvas({ kind: "md", title: `Report · ${run.question.slice(0, 40)}`, body: run.report! })}><ExternalLink /></button>}
      {run?.reportPath && <a className="ib sm" aria-label="Download report" title="Download the report" href={fileUrl(run.reportPath)} download><Download /></a>}
    </>);
    return () => setBar(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.stats.queries, run?.stats.read, run?.stats.claims, run?.report, run?.status, running, copied]);

  if (gone) return <div className="wf wf-gone">
    <p>This run is not on the server any more.</p>
    <p className="wf-dim">Runs live in the workspace (workflows/runs) and the newest twenty are kept; older ones are pruned.</p>
    <button className="txt-btn solid" onClick={reopen}><RotateCw size={13} /> Try again</button>
  </div>;
  if (!run) return <div className="wf wf-gone"><p className="wf-dim">Opening the run…</p></div>;

  const done = run.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const elapsed = (run.endedAt || now) - run.createdAt;
  const shown = run.sources.filter((s) => !filter.trim() || (s.title + s.url + (s.snippet || "")).toLowerCase().includes(filter.trim().toLowerCase()));
  const evidence = evidenceBlock(run);

  return <div className="wf">
    <div className="wf-head">
      <div className="wf-q">
        <div className="wf-name">{run.workflowName}
          {run.status === "running" ? <span className="wf-badge live">running</span>
            : run.status === "done" ? <span className="wf-badge ok">done</span>
            : run.status === "stopped" ? <span className="wf-badge">stopped</span>
            : <span className="wf-badge bad">failed</span>}
        </div>
        <p className="wf-question" title={run.question}>{run.question}</p>
      </div>
      <div className="wf-meta">
        <span className="wf-prog" aria-label={`${done} of ${run.steps.length} steps`}>{done}/{run.steps.length}</span>
        <span className="wf-time">{mmss(Math.max(0, elapsed))}</span>
      </div>
      <div className="wf-track" aria-hidden="true"><b style={{ width: `${Math.round((done / Math.max(1, run.steps.length)) * 100)}%` }} /></div>
    </div>
    <div className="wf-main">
      <ol className="wf-rail">
        {run.steps.map((s) => (
          <li key={s.id} className={"wf-step " + s.status + (s.id === run.steps.find((x) => x.status === "running")?.id ? " cur" : "")}>
            <button onClick={() => { setPicked(true); setPane(s.id === "plan" ? "plan" : s.id === "write" || s.id === "check" || s.id === "deliver" ? "report" : s.id === "search" || s.id === "select" ? "sources" : "evidence"); }}>
              <i className="wf-dot" aria-hidden="true" />
              <span className="wf-step-t">{s.title}</span>
              {s.ms !== undefined && s.status === "done" && <span className="wf-ms">{(s.ms / 1000).toFixed(1)}s</span>}
            </button>
            {s.note && <p className="wf-note">{s.note}</p>}
          </li>
        ))}
      </ol>
      <div className="wf-pane">
        <nav className="wf-tabs" role="tablist" aria-label="Workflow views">
          {run.panes.map((p) => (
            <button key={p.id} role="tab" aria-selected={active === p.view} className={active === p.view ? "on" : ""}
              onClick={() => { setPicked(true); setPane(p.view); }}>
              {(() => { const Icon = PANE_ICON[p.view] || FileText; return <Icon size={13} />; })()}<span>{p.title}</span>
            </button>
          ))}
          {!picked && <span className="wf-follow">following the run</span>}
        </nav>
        <div className="wf-body">
          {active === "plan" && <div className="wf-plan">
            {!run.plan?.sub.length && <p className="wf-dim">{running ? "Planning — the sub-questions appear here." : "No plan was recorded for this run."}</p>}
            {(run.plan?.sub || []).map((s) => {
              const ev = run.sources.filter((e) => e.read && (e.answers || []).includes(s.id));
              return <div key={s.id} className="wf-sub">
                <div className="wf-sub-h"><span className="wf-sub-n">{s.id}</span><b>{s.q}</b></div>
                <div className="wf-queries">{s.queries.map((q) => <span key={q} className="wf-query">{q}</span>)}</div>
                <p className="wf-sub-cov">{ev.length ? `${ev.length} sources · ${ev.reduce((a, e) => a + (e.claims?.length || 0), 0)} claims` : running ? "no evidence yet" : "no evidence found"}</p>
              </div>;
            })}
            {!!run.followups.length && <div className="wf-sub">
              <div className="wf-sub-h"><span className="wf-sub-n">+</span><b>Second pass</b></div>
              <div className="wf-queries">{run.followups.map((f) => <span key={f.query} className="wf-query">{f.query}</span>)}</div>
            </div>}
          </div>}

          {active === "sources" && <>
            <div className="wf-find">
              <input className="tx" value={filter} placeholder={`Filter ${run.sources.length} pages`} aria-label="Filter sources" onChange={(e) => setFilter(e.target.value)} />
              <span className="wf-dim">{run.sources.filter((s) => s.read).length} read · {run.sources.filter((s) => s.failed).length} unusable</span>
            </div>
            {!shown.length && <p className="wf-dim">{run.sources.length ? "Nothing matches that filter." : running ? "Searching — candidates appear here as they arrive, with the reason each one was chosen." : "This run found no candidates."}</p>}
            <ul className="wf-srcs" aria-label="Sources">
              {shown.map((s) => (
                <li key={s.id} className={"wf-src" + (s.failed ? " bad" : s.read ? " read" : "")}>
                  <button onClick={() => app.openCanvas({ kind: "web", title: s.host, url: s.url })} title={s.url}>
                    <span className="wf-src-n">{s.id}</span>
                    <span className="wf-src-t"><b>{s.title}</b><small>{s.host}{s.why ? ` · ${s.why}` : ""}{s.failed ? ` · ${s.failed}` : ""}</small></span>
                    <span className="wf-src-c">{s.claims?.length ? `${s.claims.length} claim${s.claims.length === 1 ? "" : "s"}` : s.read ? "read" : s.failed ? "—" : "queued"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>}

          {active === "evidence" && (evidence
            ? <Block key={"ev" + run.sources.filter((s) => s.read).length + ":" + run.stats.claims} source={evidence} done fill />
            : <p className="wf-dim">Evidence from the read pass lands here — claims and verbatim quotes, grouped by sub-question.</p>)}

          {active === "report" && (run.report
            ? <div className="reader wf-report"><StreamMarkdown text={run.report} streaming={false} {...md} /></div>
            : <p className="wf-dim">{running ? "The report is written from the distilled evidence once the reading is done, then checked." : "This run produced no report."}</p>)}

          {active === "log" && <ol className="wf-log">
            {run.log.map((l, i) => <li key={i}><span className="wf-log-t">{clock(l.at)}</span><span className="wf-log-s">{l.step}</span><span>{l.text}</span></li>)}
          </ol>}
        </div>
      </div>
    </div>
    {run.error && <p className="wf-err">The run failed: {run.error}</p>}
  </div>;
});
