"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Folder, FileText, X, Upload, Trash2, Layers, AppWindow, GitBranch, Download } from "lucide-react";
import { TreeNode, useApp, flatFiles } from "./ctx";
import { upload } from "./Composer";
import { SourceList } from "./Message";

export type ConvItem = { id: string; title: string; branches: { leafId: string; label: string }[] };

export function ChatsPanel({ convs, current, onOpen, onDelete, onClose }: {
  convs: ConvItem[]; current: string | null; onOpen: (id: string, leaf?: string, msg?: string) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ convId: string; title: string; messageId: string; snippet: string }[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => fetch("/api/search?q=" + encodeURIComponent(q)).then((r) => r.json()).then(setHits), 160);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="panel" style={{ maxHeight: "100%" }}>
      <div className="panel-head"><span>Chats</span><span className="sp" /><button className="ib sm" aria-label="Close" onClick={onClose}><X /></button></div>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" autoFocus onKeyDown={(e) => e.key === "Escape" && onClose()} />
      <div className="panel-body">
        {q ? hits.map((h) => (
          <button key={h.messageId} className="li" style={{ flexDirection: "column", alignItems: "stretch" }} onClick={() => onOpen(h.convId, undefined, h.messageId)}>
            <span className="t">{h.title}</span><span className="snip">{h.snippet}</span>
          </button>
        )) : convs.map((c) => (
          <div key={c.id}>
            <div className={"li" + (c.id === current ? " on" : "")} role="button" onClick={() => onOpen(c.id)}>
              {c.branches.length > 0
                ? <button aria-label="Branches" onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [c.id]: !o[c.id] })); }}>{open[c.id] ? <ChevronDown /> : <ChevronRight />}</button>
                : <span style={{ width: 14 }} />}
              <span className="t">{c.title || "Untitled"}</span>
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

export function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const app = useApp();
  return (
    <div className="panel">
      <div className="panel-head"><span>Workspace</span><span className="sp" />
        <label className="ib sm" aria-label="Upload" style={{ cursor: "pointer" }}><Upload /><input type="file" multiple hidden onChange={async (e) => { if (e.target.files) { await upload([...e.target.files]); app.refreshTree(); } e.target.value = ""; }} /></label>
        <button className="ib sm" aria-label="Close" onClick={onClose}><X /></button>
      </div>
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
