"use client";
import { memo, useCallback, useMemo, useState } from "react";
import { Copy, Check, GitBranch, RotateCcw, MessageSquare, ChevronLeft, ChevronRight, FileText, Search, Globe, Terminal, Code2, FilePen, FolderTree, BookOpen, Layers, Package, Trash2, Plug, AppWindow, X } from "lucide-react";
import { StreamMarkdown, SMComponents } from "@/lib/streammark/StreamMarkdown";
import { Block } from "./Block";
import { Msg, Part, useApp, fileUrl, isExternal } from "./ctx";

export function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button className="ib sm" aria-label="Copy" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>{ok ? <Check /> : <Copy />}</button>;
}

export function Nav({ i, n, go }: { i: number; n: number; go: (d: number) => void }) {
  if (n < 2) return null;
  return <span className="nav"><button className="ib sm" aria-label="Previous" onClick={() => go(-1)} disabled={i === 0}><ChevronLeft /></button><span>{i + 1}/{n}</span><button className="ib sm" aria-label="Next" onClick={() => go(1)} disabled={i === n - 1}><ChevronRight /></button></span>;
}

function lineDiff(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n");
  if (A.length * B.length > 250000) return [...A.map((t) => ({ t, k: "del" })), ...B.map((t) => ({ t, k: "add" }))];
  const dp = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: string; k: string }[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) { if (A[i] === B[j]) { out.push({ t: A[i], k: "" }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: A[i++], k: "del" }); else out.push({ t: B[j++], k: "add" }); }
  while (i < A.length) out.push({ t: A[i++], k: "del" });
  while (j < B.length) out.push({ t: B[j++], k: "add" });
  // collapse long unchanged runs
  return out.filter((l, idx) => l.k || out.slice(Math.max(0, idx - 2), idx + 3).some((x) => x.k));
}

const TOOL_META: Record<string, { icon: typeof FileText; verb: string; arg?: string }> = {
  skill_open: { icon: BookOpen, verb: "Opened skill", arg: "name" }, context_add: { icon: Layers, verb: "Added to context", arg: "path" },
  context_remove: { icon: Layers, verb: "Removed from context", arg: "path" }, compact_context: { icon: Layers, verb: "Compacted context" },
  fs_list: { icon: FolderTree, verb: "Listed", arg: "path" }, fs_read: { icon: FileText, verb: "Read", arg: "path" },
  fs_write: { icon: FilePen, verb: "Wrote", arg: "path" }, fs_edit: { icon: FilePen, verb: "Edited", arg: "path" },
  fs_delete: { icon: Trash2, verb: "Deleted", arg: "path" }, fs_move: { icon: FilePen, verb: "Moved", arg: "to" },
  run_python: { icon: Code2, verb: "Ran Python" }, pip_install: { icon: Package, verb: "Installed", arg: "packages" },
  shell: { icon: Terminal, verb: "Ran", arg: "command" }, web_search: { icon: Search, verb: "Searched", arg: "query" },
  web_fetch: { icon: Globe, verb: "Read", arg: "url" }, ui_search: { icon: AppWindow, verb: "Looked up components", arg: "query" },
};

type Src = { url: string; title: string; snippet?: string };
export function SourceList({ items }: { items: Src[] }) {
  return <div className="srcs">{items.map((s, i) => { let host = ""; try { host = new URL(s.url).hostname; } catch {}
    return <a key={i} className="src" href={s.url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" />
      <div><b>{s.title}</b><small>{host}{s.snippet ? " · " + s.snippet : ""}</small></div></a>; })}</div>;
}

const ToolCall = memo(function ToolCall({ p }: { p: Extract<Part, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const app = useApp();
  const mcp = p.name.match(/^mcp__(.+?)__(.+)$/);
  const m = TOOL_META[p.name] || { icon: Plug, verb: mcp ? `${mcp[1]} · ${mcp[2]}` : p.name };
  const Icon = m.icon;
  const argv = m.arg ? p.args[m.arg] : undefined;
  const target = Array.isArray(argv) ? argv.join(" ") : typeof argv === "string" ? argv : "";
  const meta = p.meta as { before?: string; after?: string; sources?: Src[]; path?: string } | undefined;
  const pending = p.result === undefined;
  const openable = typeof p.args.path === "string" && ["fs_write", "fs_edit", "fs_read", "context_add"].includes(p.name);
  let body: React.ReactNode = null;
  if (open) {
    if (meta?.sources && p.name === "web_search") body = <SourceList items={meta.sources} />;
    else if (meta && "after" in meta) body = <div className="diff">{lineDiff(meta.before || "", meta.after || "").map((l, i) => <div key={i} className={l.k}>{l.k === "add" ? "+ " : l.k === "del" ? "- " : "  "}{l.t}</div>)}</div>;
    else if (p.name === "run_python") body = <><pre>{String(p.args.code || "")}</pre><pre>{p.result}</pre></>;
    else body = <>{Object.keys(p.args).length > 0 && p.name !== "shell" && <pre>{JSON.stringify(p.args, null, 2)}</pre>}<pre>{p.result}</pre></>;
  }
  return (
    <div className="tool">
      <button className="tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon /><span>{m.verb}</span>{target && <span className="tgt">{target}</span>}
        {pending ? <span className="spin" /> : p.ok === false ? <X className="err" /> : null}
      </button>
      {openable && !pending && <button className="ib sm" aria-label="Open file" onClick={() => app.openFile(String(p.args.path))}><AppWindow /></button>}
      {open && !pending && <div className="tool-body">{body}</div>}
    </div>
  );
});

function CanvasCard({ title, body, done }: { title: string; body: string; done: boolean }) {
  const app = useApp();
  const open = useCallback(() => {
    const yt = body.trim().match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    if (yt && !body.includes("<ui")) app.openCanvas({ kind: "youtube", title, id: yt[1] });
    else if (body.includes("<ui")) app.openCanvas({ kind: "ui", title, source: body.replace(/^[\s\S]*?<ui[^>]*>/, "").replace(/<\/ui>[\s\S]*$/, "") });
    else app.openCanvas({ kind: "md", title, body });
  }, [app, title, body]);
  return <div className="canvas-card" onClick={done ? open : undefined} role="button"><AppWindow /><span className="t">{title}</span><small>{done ? "Open" : "Building…"}</small></div>;
}

export function useMdHandlers() {
  const app = useApp();
  const onLink = useCallback((href: string) => { if (isExternal(href)) return false; app.openFile(decodeURIComponent(href.replace(/^\.?\//, ""))); return true; }, [app]);
  const components = useMemo<SMComponents>(() => ({
    ui: ({ source, done }) => <Block source={source} done={done} />,
    canvas: (p) => <CanvasCard {...p} />,
  }), []);
  const resolveSrc = useCallback((s: string) => (isExternal(s) || s.startsWith("data:") || s.startsWith("/") ? s : fileUrl(s)), []);
  return { onLink, components, resolveSrc };
}

export const AssistantBody = memo(function AssistantBody({ parts, streaming }: { parts: Part[]; streaming: boolean }) {
  const h = useMdHandlers();
  if (!parts.length && streaming) return <div className="thinking" />;
  return <>{parts.map((p, i) => p.type === "text"
    ? <StreamMarkdown key={i} text={p.text} streaming={streaming && i === parts.length - 1} {...h} />
    : <ToolCall key={p.id + i} p={p} />)}</>;
});

export function Attachments({ items }: { items: Msg["attachments"] }) {
  const app = useApp();
  if (!items.length) return null;
  return <div className="atts">{items.map((a) => a.mime.startsWith("image/")
    // eslint-disable-next-line @next/next/no-img-element
    ? <img key={a.path} className="att-img" src={fileUrl(a.path)} alt={a.name} onClick={() => app.openFile(a.path)} />
    : <span key={a.path} className="att-file" onClick={() => app.openFile(a.path)}><FileText /><span>{a.name}</span></span>)}</div>;
}

type Props = {
  m: Msg; streaming: boolean; sib: { i: number; n: number }; onNav: (d: number) => void;
  onEdit?: () => void; onRegenerate?: () => void; onThread?: () => void; threadCount?: number;
};

export const Message = memo(function Message({ m, streaming, sib, onNav, onEdit, onRegenerate, onThread, threadCount }: Props) {
  if (m.role === "user") return (
    <div className="turn user">
      {m.quote && <div className="quoteline">{m.quote}</div>}
      <Attachments items={m.attachments} />
      {m.content && <div className="bubble">{m.content}</div>}
      <div className="actions">
        <Nav i={sib.i} n={sib.n} go={onNav} />
        <CopyBtn text={m.content} />
        {onEdit && <button className="ib sm" aria-label="Branch" onClick={onEdit}><GitBranch /></button>}
      </div>
    </div>
  );
  const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
  return (
    <div className="turn ai" data-mid={m.id}>
      <div className="ai-content"><AssistantBody parts={m.parts} streaming={streaming} /></div>
      {!streaming && <div className="actions">
        <Nav i={sib.i} n={sib.n} go={onNav} />
        <CopyBtn text={text} />
        {onRegenerate && <button className="ib sm" aria-label="Regenerate" onClick={onRegenerate}><RotateCcw /></button>}
        {onThread && <><button className="ib sm" aria-label="Thread" onClick={onThread}><MessageSquare /></button>{threadCount ? <span className="threadcount">{threadCount}</span> : null}</>}
      </div>}
    </div>
  );
});
