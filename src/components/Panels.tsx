"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Folder, FileText, X, Upload, Trash2, Layers, AppWindow, GitBranch, Download, Shrink, Undo2, Sparkles } from "lucide-react";
import { TreeNode, useApp, flatFiles } from "./ctx";
import { upload } from "./Composer";
import { SourceList } from "./Message";

export type ConvItem = { id: string; title: string; kind?: string; branches: { leafId: string; label: string }[] };

function Row({ c, current, onOpen, onDelete, onPromote, open, setOpen }: {
  c: ConvItem; current: string | null; onOpen: (id: string) => void; onDelete: (id: string) => void;
  onPromote?: (id: string) => void; open: boolean; setOpen: (v: boolean) => void;
}) {
  return (
    <div>
      <div className={"li" + (c.id === current ? " on" : "")} role="button" onClick={() => onOpen(c.id)}>
        {c.branches.length > 1
          ? <button aria-label="Branches" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? <ChevronDown /> : <ChevronRight />}</button>
          : <span style={{ width: 14 }} />}
        <span className="t">{c.title || "Untitled"}</span>
        <span className="h">
          {onPromote && <button className="ib sm" aria-label="Keep as chat" title="Keep as chat" onClick={(e) => { e.stopPropagation(); onPromote(c.id); }}><Sparkles /></button>}
          <a className="ib sm" aria-label="Export" href={`/api/conversations/${c.id}/export`} onClick={(e) => e.stopPropagation()}><Download /></a>
          <button className="ib sm" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}><Trash2 /></button>
        </span>
      </div>
      {open && c.branches.map((b) => (
        <button key={b.leafId} className="li branch" onClick={() => onOpen(c.id)}><GitBranch /><span className="t">{b.label}</span></button>
      ))}
    </div>
  );
}

export function ChatsPanel({ convs, current, onOpen, onDelete, onPromote, onClose }: {
  convs: ConvItem[]; current: string | null; onOpen: (id: string, leaf?: string, msg?: string) => void; onDelete: (id: string) => void;
  onPromote?: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ convId: string; title: string; messageId: string; snippet: string }[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!q.trim()) return; // results are only shown while there is a query
    const t = setTimeout(() => fetch("/api/search?q=" + encodeURIComponent(q)).then((r) => r.json()).then(setHits), 160);
    return () => clearTimeout(t);
  }, [q]);
  // temporary answers live in History; anything that ran a tool is a real chat
  const chats = convs.filter((c) => (c.kind || "chat") !== "search");
  const history = convs.filter((c) => (c.kind || "chat") === "search");
  const list = (items: ConvItem[], promote?: boolean) => items.length ? items.map((c) => (
    <Row key={c.id} c={c} current={current} onOpen={(id) => onOpen(id)} onDelete={onDelete}
      onPromote={promote ? onPromote : undefined} open={!!open[c.id]} setOpen={(v) => setOpen((o) => ({ ...o, [c.id]: v }))} />
  )) : <div className="li empty">Nothing yet</div>;
  return (
    <div className="panel" style={{ maxHeight: "100%" }}>
      <div className="panel-head"><span>Chats</span><span className="sp" /><button className="ib sm" aria-label="Close" onClick={onClose}><X /></button></div>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" autoFocus onKeyDown={(e) => e.key === "Escape" && onClose()} />
      <div className="panel-body">
        {q.trim() ? hits.map((h) => (
          <button key={h.messageId} className="li" style={{ flexDirection: "column", alignItems: "stretch" }} onClick={() => onOpen(h.convId, undefined, h.messageId)}>
            <span className="t">{h.title}</span><span className="snip">{h.snippet}</span>
          </button>
        )) : (<>
          <div className="grp">Chats <span className="n">{chats.length}</span></div>
          {list(chats)}
          <div className="grp">History <span className="n">{history.length}</span> <span className="hint">temporary answers</span></div>
          {list(history, true)}
        </>)}
      </div>
    </div>
  );
}

function TreeItem({ n, depth }: { n: TreeNode; depth: number }) {
  const app = useApp();
  const [open, setOpen] = useState(depth === 0 && ["uploads", "artifacts", "notes"].includes(n.name));
  const pinned = app.context.includes(n.path);
  if (n.dir) return <>
    <button className="li" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen(!open)}>{open ? <ChevronDown /> : <ChevronRight />}<Folder /><span className="t">{n.name}</span></button>
    {open && n.children?.map((c) => <TreeItem key={c.path} n={c} depth={depth + 1} />)}
  </>;
  return (
    <div className="li" role="button" style={{ paddingLeft: 22 + depth * 14 }} onClick={() => app.openFile(n.path)} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", "@" + n.path)}>
      <FileText /><span className="t">{n.name}</span>
      {pinned && <span className="dot" title="In context" />}
      <span className="h">
        <button className="ib sm" aria-label={pinned ? "Remove from context" : "Add to context"} onClick={(e) => { e.stopPropagation(); app.toggleContext(n.path); }}><Layers /></button>
        <button className="ib sm" aria-label="Delete" onClick={async (e) => { e.stopPropagation(); if (!confirm(`Delete ${n.path}?`)) return; await fetch("/api/workspace?path=" + encodeURIComponent(n.path), { method: "DELETE" }); app.refreshTree(); }}><Trash2 /></button>
      </span>
    </div>
  );
}

type CtxReport = { budget: number; window: number; total: number; sections: { key: string; label: string; tokens: number; items?: { path: string; tokens: number }[] }[]; turns: { id: string; role: string; preview: string; tokens: number; tools: number; compacted: boolean }[] };
export type CtxRef = { convId: string; leafId: string | null; thread: string | null; rev: number; reload: () => void };
const kfmt = (n: number) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
const SEC_TONE: Record<string, string> = { system: "var(--faint)", memory: "var(--faint)", skills: "var(--faint)", tree: "var(--faint)", files: "var(--accent)", tooldefs: "var(--muted)", summary: "var(--success)", history: "var(--fg)", tools: "color-mix(in srgb, var(--accent) 55%, var(--muted))" };

/** Context status: live token usage, per-section breakdown and scoped compaction (tools / web / chosen turns / history). */
export function ContextStatus({ c }: { c: CtxRef }) {
  const [r, setR] = useState<CtxReport | null>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    const q = new URLSearchParams(); if (c.leafId) q.set("leaf", c.leafId); if (c.thread) q.set("thread", c.thread);
    fetch(`/api/conversations/${c.convId}/context?${q}`).then((x) => x.json()).then((j) => !j.error && setR(j)).catch(() => {});
  }, [c.convId, c.leafId, c.thread]);
  useEffect(() => { load(); }, [load, c.rev]);
  const run = async (scope: string, extra: Record<string, unknown> = {}) => {
    setMenu(false); setBusy(scope === "history" || scope === "messages" ? "Summarising…" : "Folding…");
    const res = await fetch(`/api/conversations/${c.convId}/compact`, { method: scope === "restore" ? "DELETE" : "POST", body: scope === "restore" ? undefined : JSON.stringify({ leafId: c.leafId, scope, ...extra }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(res.error ? String(res.error) : null); setPick(new Set());
    c.reload(); load();
    if (res.error) setTimeout(() => setBusy(null), 3000);
  };
  if (!r) return null;
  const pct = Math.min(100, (r.total / r.budget) * 100);
  const tone = pct > 85 ? "var(--danger)" : pct > 65 ? "var(--accent)" : "var(--fg)";
  return (
    <div className="ctxs">
      <div className="ctxs-row">
        <button className="ctxs-meter" onClick={() => setOpen(!open)} aria-expanded={open} title="Context usage">
          {open ? <ChevronDown /> : <ChevronRight />}
          <span className="ctxs-bar">{r.sections.filter((s) => s.tokens > 0).map((s) => <i key={s.key} style={{ width: `${(s.tokens / r.budget) * 100}%`, background: SEC_TONE[s.key] || "var(--muted)" }} />)}</span>
          <span className="ctxs-num" style={{ color: tone }}>{busy || `${kfmt(r.total)} / ${kfmt(r.budget)}`}</span>
        </button>
        <div className="ctxs-act">
          <button className={"ib sm" + (menu ? " on" : "")} aria-label="Compact" title="Compact" onClick={() => setMenu(!menu)}><Shrink /></button>
          {menu && <div className="ctxs-menu" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => run("tools", { keepLast: 2 })}>Fold tool output<small>keep last 2 turns</small></button>
            <button onClick={() => run("web", { keepLast: 1 })}>Fold web results<small>searches and pages</small></button>
            <button onClick={() => run("history", { keepLast: 4 })}>Summarise history<small>keep last 4 messages</small></button>
            <button onClick={() => run("restore")}><span>Restore everything</span><Undo2 /></button>
          </div>}
        </div>
      </div>
      {open && <div className="ctxs-body">
        {r.sections.filter((s) => s.tokens > 0).map((s) => <div key={s.key} className="ctxs-sec"><i style={{ background: SEC_TONE[s.key] || "var(--muted)" }} /><span>{s.label}</span><b>{kfmt(s.tokens)}</b></div>)}
        {r.turns.length > 0 && <>
          <div className="ctxs-h"><span>Turns</span><span className="sp" />{pick.size > 0 && <button className="txt-btn" onClick={() => run("messages", { ids: [...pick] })}>Compact {pick.size}</button>}</div>
          <div className="ctxs-turns">{r.turns.map((t) => (
            <label key={t.id} className={"ctxs-turn" + (t.compacted ? " done" : "")}>
              <input type="checkbox" disabled={t.compacted} checked={pick.has(t.id)} onChange={() => setPick((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} />
              <span className={"role " + t.role}>{t.role === "user" ? "U" : "A"}</span>
              <span className="pv">{t.preview || "…"}</span>
              <b>{kfmt(t.tokens + t.tools)}</b>
            </label>))}</div>
        </>}
      </div>}
    </div>
  );
}

export function WorkspacePanel({ onClose, ctx }: { onClose: () => void; ctx?: CtxRef | null }) {
  const app = useApp();
  return (
    <div className="panel">
      <div className="panel-head"><span>Workspace</span><span className="sp" />
        <label className="ib sm" aria-label="Upload" style={{ cursor: "pointer" }}><Upload /><input type="file" multiple hidden onChange={async (e) => { if (e.target.files) { await upload([...e.target.files]); app.refreshTree(); } e.target.value = ""; }} /></label>
        <button className="ib sm" aria-label="Close" onClick={onClose}><X /></button>
      </div>
      {ctx && <ContextStatus c={ctx} />}
      <div className="panel-body">{app.tree.map((n) => <TreeItem key={n.path} n={n} depth={0} />)}</div>
    </div>
  );
}

export function ArtifactsPanel({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const items = useMemo(() => flatFiles(app.tree).filter((f) => (f.path.startsWith("artifacts/") && !/\.(css|js|json)$/.test(f.path)) || (f.path.endsWith(".html") && !f.path.startsWith("artifacts/"))), [app.tree]);
  return (
    <div className="panel">
      <div className="panel-head"><span>Artifacts</span><span className="sp" /><button className="ib sm" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="panel-body">{items.map((f) => (
        <button key={f.path} className="li" onClick={() => app.openFile(f.path)}><AppWindow /><span className="t">{f.path.replace(/^artifacts\//, "")}</span></button>
      ))}</div>
    </div>
  );
}

export function SourcesPanel({ sources, onClose }: { sources: { url: string; title: string; snippet?: string }[]; onClose: () => void }) {
  return (
    <div className="panel">
      <div className="panel-head"><span>Sources</span><span className="sp" /><button className="ib sm" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="panel-body" style={{ padding: 0 }}><SourceList items={sources} /></div>
    </div>
  );
}
