"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Folder, FileText, X, Upload, Trash2, Layers, AppWindow, GitBranch, Download, Shrink, Undo2, MessageSquare, ArrowUpLeft, Home } from "lucide-react";
import { TreeNode, CanvasSpec, useApp, flatFiles } from "./ctx";
import { upload } from "./Composer";
import { SourceList } from "./Message";
import { chatDir } from "@/lib/shared";

export type ConvItem = { id: string; title: string; mode?: "chat" | "search"; branches: { leafId: string; label: string }[] };

export function ChatsPanel({ convs, current, running = [], onOpen, onDelete, onClose }: {
  convs: ConvItem[]; current: string | null; running?: string[]; onOpen: (id: string, leaf?: string, msg?: string) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ convId: string; title: string; messageId: string; snippet: string }[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Chats: full conversations. History: searches (temporary, messages only) until "Open in chat" converts one.
  const [tab, setTab] = useState<"chat" | "search">(() => (convs.find((c) => c.id === current)?.mode === "search" ? "search" : "chat"));
  useEffect(() => { const m = convs.find((c) => c.id === current)?.mode; if (m) setTab(m); }, [current, convs]); // follow the open item so a new search shows under History
  const list = convs.filter((c) => (c.mode || "chat") === tab);
  useEffect(() => {
    if (!q.trim()) return; // results are only shown while there is a query
    const t = setTimeout(() => fetch("/api/search?q=" + encodeURIComponent(q)).then((r) => r.json()).then(setHits), 160);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="panel" style={{ maxHeight: "100%" }}>
      <div className="panel-head"><div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Chats</button>
        <button role="tab" aria-selected={tab === "search"} className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>History</button>
      </div><span className="sp" /><button className="ib sm" aria-label="Close" onClick={onClose}><X /></button></div>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" autoFocus onKeyDown={(e) => e.key === "Escape" && onClose()} />
      <div className="panel-body">
        {q.trim() ? hits.map((h) => (
          <button key={h.messageId} className="li" style={{ flexDirection: "column", alignItems: "stretch" }} onClick={() => onOpen(h.convId, undefined, h.messageId)}>
            <span className="t">{h.title}</span><span className="snip">{h.snippet}</span>
          </button>
        )) : !list.length ? <div className="empty">{tab === "search" ? "No searches yet" : "No chats yet"}</div> : list.map((c) => (
          <div key={c.id}>
            <div className={"li" + (c.id === current ? " on" : "")} role="button" onClick={() => onOpen(c.id)}>
              {c.branches.length > 0
                ? <button aria-label="Branches" onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [c.id]: !o[c.id] })); }}>{open[c.id] ? <ChevronDown /> : <ChevronRight />}</button>
                : <span style={{ width: 14 }} />}
              <span className="t">{c.title || "Untitled"}</span>
              {running.includes(c.id) && <i className="live-dot" title="Responding" />}
              <span className="h">
                <a className="ib sm" aria-label="Export" href={`/api/conversations/${c.id}/export`} onClick={(e) => e.stopPropagation()}><Download /></a>
                <button className="ib sm" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}><Trash2 /></button>
              </span>
            </div>
            {open[c.id] && c.branches.map((b) => (
              <button key={b.leafId} className="li branch" onClick={() => onOpen(c.id, b.leafId)}><GitBranch /><span className="t">{b.label}</span></button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const findNode = (ns: TreeNode[], path: string): TreeNode | null => {
  for (const n of ns) { if (n.path === path) return n; if (n.dir && path.startsWith(n.path + "/")) { const f = findNode(n.children || [], path); if (f) return f; } }
  return null;
};

function TreeItem({ n, depth }: { n: TreeNode; depth: number }) {
  const app = useApp();
  const [open, setOpen] = useState(false); // compact by default: nothing auto-expands
  const pinned = app.context.includes(n.path);
  const chatId = n.dir && /^chats\/[\w-]+$/.test(n.path) ? n.name : null;
  if (n.dir) return <>
    <div className="li" role="button" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen(!open)}>{open ? <ChevronDown /> : <ChevronRight />}{chatId ? <MessageSquare /> : <Folder />}
      <span className="t">{chatId ? app.convTitles[chatId] || chatId : n.name}</span>
      {chatId && <span className="h"><button className="ib sm" aria-label="Open chat in a window" title="Open in a window" onClick={(e) => { e.stopPropagation(); app.openFile(n.path); }}><AppWindow /></button></span>}
    </div>
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

/** Folder browser: opens inside the current chat's folder when there is a chat, otherwise at the
    workspace root; ".." climbs a level (chat → workspace). Nothing auto-expands. */
export function WorkspacePanel({ onClose, ctx }: { onClose: () => void; ctx?: CtxRef | null }) {
  const app = useApp();
  // null = "follow the open chat's folder"; any navigation makes it explicit
  const [cwd, setCwd] = useState<string | null>(null);
  const dir = cwd === null ? (app.convId ? chatDir(app.convId) : "") : cwd;
  const node = dir ? findNode(app.tree, dir) : null;
  const kids = dir === "" ? app.tree : node?.dir ? node.children || [] : [];
  const up = () => setCwd(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "");
  const crumbs = dir ? dir.split("/") : [];
  return (
    <div className="panel">
      <div className="panel-head"><span>Workspace</span><span className="sp" />
        <label className="ib sm" aria-label="Upload here" title={`Upload to ${dir || "workspace"}/`} style={{ cursor: "pointer" }}><Upload /><input type="file" multiple hidden onChange={async (e) => { if (e.target.files) { await upload([...e.target.files], dir || undefined); app.refreshTree(); } e.target.value = ""; }} /></label>
        <button className="ib sm" aria-label="Close" onClick={onClose}><X /></button>
      </div>
      <div className="crumbs-bar">
        {dir !== "" && <button className="ib sm" aria-label="Up a folder" title="Up a folder" onClick={up}><ArrowUpLeft /></button>}
        <button className={"crumb" + (dir === "" ? " on" : "")} onClick={() => setCwd("")}><Home />workspace</button>
        {crumbs.map((c, i) => <button key={i} className={"crumb" + (i === crumbs.length - 1 ? " on" : "")} onClick={() => setCwd(crumbs.slice(0, i + 1).join("/"))}>{app.convId && crumbs[i - 1] === "chats" ? app.convTitles[c] || c : c}</button>)}
      </div>
      {ctx && <ContextStatus c={ctx} />}
      <div className="panel-body">{kids.map((n) => <TreeItem key={n.path} n={n} depth={0} />)}{!kids.length && <div className="empty">Empty folder</div>}</div>
    </div>
  );
}

export function ArtifactsPanel({ onClose, recent }: { onClose: () => void; recent?: CanvasSpec[] }) {
  const app = useApp();
  const [all, setAll] = useState(false);
  // artifacts = things built: chats/<id>/artifacts/** (per chat) and the older shared artifacts/**
  const items = useMemo(() => flatFiles(app.tree).filter((f) => !/\.(css|js|json|map)$/.test(f.path) && !f.path.includes("/node_modules/") && (
    all ? /^(chats\/[\w-]+\/)?artifacts\//.test(f.path) : app.convId ? f.path.startsWith(`chats/${app.convId}/artifacts/`) : false)), [app.tree, app.convId, all]);
  const label = (p: string) => { const m = p.match(/^chats\/([\w-]+)\/artifacts\/(.*)$/); return m ? (all && m[1] !== app.convId ? `${app.convTitles[m[1]] || m[1]} · ` : "") + m[2] : p.replace(/^artifacts\//, ""); };
  return (
    <div className="panel">
      <div className="panel-head"><span>Artifacts</span><span className="sp" />
        <span className="seg"><button className={all ? "" : "on"} onClick={() => setAll(false)}>This chat</button><button className={all ? "on" : ""} onClick={() => setAll(true)}>All</button></span>
        <button className="ib sm" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="panel-body">
        {!!recent?.length && <>
          <div className="panel-sub">Recent canvases</div>
          {recent.map((s, i) => <button key={i} className="li" onClick={() => app.openCanvas(s)}><AppWindow /><span className="t">{s.title}</span></button>)}
          <div className="panel-sub">Built</div>
        </>}
        {items.map((f) => (
          <button key={f.path} className="li" onClick={() => app.openFile(f.path)}><AppWindow /><span className="t">{label(f.path)}</span></button>
        ))}{!items.length && !recent?.length && <div className="empty">{all ? "Nothing built yet" : "Nothing built in this chat"}</div>}</div>
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
