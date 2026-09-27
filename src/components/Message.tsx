"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { youtubeId } from "@/lib/shared";
import { Copy, Check, GitBranch, RotateCcw, MessageSquare, ChevronLeft, ChevronRight, FileText, Search, Globe, Terminal, Code2, FilePen, FolderTree, BookOpen, Layers, Package, Trash2, Plug, AppWindow, X, Monitor, Image as ImageIcon, ListChecks, Play, ScrollText, RotateCw, Square, ShieldCheck, Send } from "lucide-react";
import { StreamMarkdown, SMComponents } from "@/lib/streammark/StreamMarkdown";
import { Block } from "./Block";
import { useSmoothText } from "@/lib/streammark/useSmoothText";
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

type Meta = { icon: typeof FileText; live: string; done: string; arg?: string };
const M = (icon: Meta["icon"], live: string, done: string, arg?: string): Meta => ({ icon, live, done, arg });
/** Running tools read in the present ("Reading"), finished ones in the past ("Read"). */
const TOOL_META: Record<string, Meta> = {
  skill_open: M(BookOpen, "Opening skill", "Opened skill", "name"), context_add: M(Layers, "Adding to context", "Added to context", "path"),
  context_remove: M(Layers, "Removing from context", "Removed from context", "path"), compact_context: M(Layers, "Compacting context", "Compacted context", "scope"),
  fs_list: M(FolderTree, "Listing", "Listed", "path"), fs_read: M(FileText, "Reading", "Read", "path"), fs_search: M(Search, "Searching files for", "Searched files for", "pattern"),
  fs_write: M(FilePen, "Writing", "Wrote", "path"), fs_edit: M(FilePen, "Editing", "Edited", "path"), fs_insert: M(FilePen, "Inserting into", "Inserted into", "path"),
  fs_delete: M(Trash2, "Deleting", "Deleted", "path"), fs_move: M(FilePen, "Moving to", "Moved to", "to"),
  run_python: M(Code2, "Running Python", "Ran Python"), pip_install: M(Package, "Installing", "Installed", "packages"),
  shell: M(Terminal, "Running", "Ran", "command"), host_shell: M(Monitor, "Running on your machine", "Ran on your machine", "command"),
  web_search: M(Search, "Searching", "Searched", "query"), web_fetch: M(Globe, "Reading", "Read", "url"), web_extract: M(Globe, "Extracting from", "Extracted from", "url"),
  view_image: M(ImageIcon, "Looking at", "Looked at", "path"), todo: M(ListChecks, "Updating plan", "Plan"), ask_user: M(MessageSquare, "Asking", "Asked", "question"),
  canvas_open: M(AppWindow, "Opening", "Opened", "target"), ui_search: M(AppWindow, "Looking up components", "Looked up components", "query"),
  proc_start: M(Play, "Starting", "Started", "name"), proc_logs: M(ScrollText, "Reading logs of", "Read logs of", "name"), proc_restart: M(RotateCw, "Restarting", "Restarted", "name"),
  proc_stop: M(Square, "Stopping", "Stopped", "name"), browser: M(Globe, "Opening in browser", "Viewed in browser", "target"), check: M(ShieldCheck, "Checking", "Checked", "path"),
  quality_check: M(ShieldCheck, "Checking design", "Design check"),
};

type Src = { url: string; title: string; snippet?: string };
export function SourceList({ items }: { items: Src[] }) {
  return <div className="srcs">{items.map((s, i) => { let host = ""; try { host = new URL(s.url).hostname; } catch {}
    return <a key={i} className="src" href={s.url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" />
      <div><b>{s.title}</b><small>{host}{s.snippet ? " · " + s.snippet : ""}</small></div></a>; })}</div>;
}

type Todo = { text: string; status: "todo" | "doing" | "done" };
function TodoList({ items }: { items: Todo[] }) {
  return <ul className="todo">{items.map((t, i) => <li key={i} className={"s-" + t.status}><span className="box">{t.status === "done" ? <Check /> : null}</span>{t.text}</li>)}</ul>;
}

function AskCard({ q, options, multi, live }: { q: string; options: string[]; multi: boolean; live: boolean }) {
  const app = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const send = (v: string[]) => { if (!live || sent || !v.length) return; setSent(true); app.sendText(v.join(", ")); };
  return <div className="ask">
    <div className="ask-q">{q}</div>
    <div className="ask-o">{options.map((o) => <button key={o} disabled={!live || sent} className={picked.includes(o) ? "on" : ""}
      onClick={() => (multi ? setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o])) : send([o]))}>{o}</button>)}
      {multi && live && !sent && <button className="ib" aria-label="Send" disabled={!picked.length} onClick={() => send(picked)}><Send /></button>}</div>
  </div>;
}

type Approval = { cmd: string; reason: string; host: boolean; decision?: "approve" | "deny" };
function ApproveBar({ ap, live, mid, pid }: { ap: Approval; live: boolean; mid?: string; pid: string }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const go = (d: "approve" | "deny") => { if (!mid || busy) return; setBusy(true); app.decide(mid, pid, d, ap.cmd).finally(() => setBusy(false)); };
  return <div className="approve">
    <div className="ap-why">{ap.reason}{ap.host ? " · on your machine" : ""}</div>
    <pre>{ap.cmd}</pre>
    {ap.decision ? <small>{ap.decision === "approve" ? "Approved" : "Denied"}</small>
      : live && mid ? <div className="ap-act"><button className="txt-btn" disabled={busy} onClick={() => go("deny")}>Deny</button><button className="txt-btn solid" disabled={busy} onClick={() => go("approve")}>Run it</button></div> : null}
  </div>;
}

/** A host command needs the user's sudo password: type it here and the waiting call runs immediately. */
function SudoBar({ pid }: { pid: string }) {
  const app = useApp();
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(false);
  const [sent, setSent] = useState(false);
  const go = () => { if (sent || !pw) return; setSent(true); app.sudoPassword(pid, pw, remember).catch(() => setSent(false)); };
  if (sent) return <div className="approve"><div className="ap-why">Password sent — running…</div></div>;
  return <div className="approve">
    <div className="ap-why">This command needs your password. It is used for this call only.</div>
    <form className="ap-act" onSubmit={(e) => { e.preventDefault(); go(); }}>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input className="ap-pw" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="sudo password" aria-label="sudo password" />
      <label className="ap-rem"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />keep for this chat</label>
      <button className="txt-btn solid" type="submit" disabled={!pw}>Run</button>
    </form>
  </div>;
}

const fmtMs = (ms: number) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
/** Model reasoning (<think> blocks or reasoning_content): collapsed, never copied, never re-sent. */
function Reasoning({ text, ms, live }: { text: string; ms?: number; live: boolean }) {
  return <details className="reason">
    <summary>{live ? <span className="shimmer">Thinking</span> : ms ? `Thought for ${fmtMs(ms)}` : "Thought"}</summary>
    <div className="reason-body">{text.trim()}</div>
  </details>;
}

const ToolCall = memo(function ToolCall({ p, lastTodo, live, mid }: { p: Extract<Part, { type: "tool" }>; lastTodo?: boolean; live?: boolean; mid?: string }) {
  const [open, setOpen] = useState(false);
  const app = useApp();
  const mcp = p.name.match(/^mcp__(.+?)__(.+)$/);
  const pending = p.result === undefined;
  const m = TOOL_META[p.name] || { icon: Plug, live: mcp ? `${mcp[1]} · ${mcp[2]}` : p.name, done: mcp ? `${mcp[1]} · ${mcp[2]}` : p.name };
  const Icon = m.icon;
  const argv = m.arg ? p.args[m.arg] : undefined;
  let target = Array.isArray(argv) ? argv.join(" ") : typeof argv === "string" ? argv : "";
  const meta = p.meta as { before?: string; after?: string; sources?: Src[]; path?: string; image?: string; todo?: Todo[]; question?: string; options?: string[]; multi?: boolean; sudo?: { answered?: boolean }; approval?: Approval } | undefined;
  const ap = meta?.approval;
  if (ap) target = ""; // the approval bar shows the full command
  if (p.name === "todo" && meta?.todo) target = `${meta.todo.filter((t) => t.status === "done").length}/${meta.todo.length}`;
  if (p.name === "quality_check" && !pending) target = p.ok === false ? `${(p.result || "").split("\n").filter((l) => l.startsWith("- ")).length} issues` : "clean";
  const openable = typeof p.args.path === "string" && ["fs_write", "fs_edit", "fs_insert", "fs_read", "context_add", "view_image"].includes(p.name);
  if (p.name === "ask_user" && meta?.question) return <AskCard q={meta.question} options={meta.options || []} multi={!!meta.multi} live={!!live} />;
  // a running tool that streams output stays open: never let a long run look frozen
  const streamingOut = pending && !!p.out;
  const expanded = open || streamingOut;
  const raw = p.out || "";
  let body: React.ReactNode = null;
  if (expanded) {
    if (pending) body = <pre className="live-out">{raw}<i className="caret" /></pre>;
    else if (meta?.sources && p.name === "web_search") body = <SourceList items={meta.sources} />;
    else if (meta && "after" in meta) body = <div className="diff">{lineDiff(meta.before || "", meta.after || "").map((l, i) => <div key={i} className={l.k}>{l.k === "add" ? "+ " : l.k === "del" ? "- " : "  "}{l.t}</div>)}</div>;
    else if (p.name === "run_python") body = <><pre>{String(p.args.code || "")}</pre><pre>{p.result}</pre></>;
    else body = <>{Object.keys(p.args).length > 0 && !["shell", "host_shell", "todo", "quality_check"].includes(p.name) && <pre>{JSON.stringify(p.args, null, 2)}</pre>}<pre>{p.result}</pre></>;
  }
  return (
    <div className={"tool" + (pending ? " live" : "")}>
      <button className="tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon /><span>{pending ? m.live : ap ? (ap.decision === "deny" ? "Not run" : ap.decision === "approve" ? "Approved" : "Needs approval") : m.done}</span>{target && <span className="tgt">{target}</span>}
        {pending ? <span className="spin" /> : p.ok === false && !ap ? <X className="err" /> : null}
      </button>
      {p.name === "todo" && lastTodo && meta?.todo && <TodoList items={meta.todo} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {meta?.image && !pending && <img className="tool-shot" src={fileUrl(meta.image)} alt="" onClick={() => app.openFile(meta.image!)} />}
      {expanded && <div className="tool-body">
        {!pending && openable && <div className="tool-open"><button className="txt-btn" onClick={() => app.openFile(String(p.args.path))}><AppWindow /> Open {String(p.args.path).split("/").pop()}</button></div>}
        {body}
      </div>}
      {ap && <ApproveBar ap={ap} live={!!live} mid={mid} pid={p.id} />}
      {meta?.sudo && pending && <SudoBar pid={p.id} />}
    </div>
  );
});

/** <canvas title="…" [dock]> anything you could put in chat </canvas>. A lone <ui> block fills the window;
    a lone YouTube link becomes a player; anything else renders as rich markdown (with inline blocks, media, math). */
function CanvasCard({ title, body, done, attrs }: { title: string; body: string; done: boolean; attrs: Record<string, string> }) {
  const app = useApp();
  const liveAtMount = useRef(!done);
  const dock = attrs.dock !== undefined && attrs.dock !== "false";
  const open = useCallback(() => {
    const t = body.trim();
    const yt = youtubeId(t);
    const onlyUi = /^<ui[\s>]/.test(t) && /<\/ui>$/.test(t) && t.indexOf("<ui", 1) < 0;
    if (yt && /^\S+$/.test(t)) app.openCanvas({ kind: "youtube", title, id: yt }, { dock });
    else if (onlyUi) app.openCanvas({ kind: "ui", title, source: t.replace(/^<ui[^>]*>/, "").replace(/<\/ui>$/, "") }, { dock });
    else app.openCanvas({ kind: "md", title, body }, { dock });
  }, [app, title, body, dock]);
  useEffect(() => { if (done && liveAtMount.current) { liveAtMount.current = false; open(); } }, [done, open]);
  return <div className="canvas-card" onClick={done ? open : undefined} role="button"><AppWindow /><span className="t">{title}</span><small>{done ? "Open" : "Building…"}</small></div>;
}

type Card = { name: string; size: number; kind: string; mime: string; excerpt?: string; rows?: string[][]; total?: number; pages?: number; count?: number; error?: string };
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** Inline preview of a workspace file linked alone on a line; the same file opens in a canvas. */
function FileCard({ href, label }: { href: string; label: string }) {
  const app = useApp();
  const p = decodeURIComponent(href.replace(/^\.?\//, "").replace(/^files\//, ""));
  const [c, setC] = useState<Card | null>(null);
  useEffect(() => { let live = true; fetch(`/api/preview?as=card&path=${encodeURIComponent(p)}`).then((r) => r.json()).then((j) => live && setC(j)).catch(() => {}); return () => { live = false; }; }, [p]);
  if (c?.error) return <p><a className="sm-link" href={href} onClick={(e) => { e.preventDefault(); app.openFile(p); }}>{label || p}</a></p>;
  const meta = c ? [c.kind === "doc" && c.pages ? `${c.pages} pages` : "", c.kind === "sheet" && c.total ? `${c.total} rows` : "", c.kind === "archive" ? `${c.count} entries` : "", fmtSize(c.size)].filter(Boolean).join(" · ") : "";
  return <div className="filecard" role="button" onClick={() => app.openFile(p)}>
    <div className="fc-h"><FileText /><span className="t">{label && label !== p ? label : c?.name || p}</span><small>{meta}</small><AppWindow className="fc-open" /></div>
    {c?.kind === "image" && /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(p)} alt="" />}
    {c?.rows && <div className="fc-rows"><table><tbody>{c.rows.map((r, i) => <tr key={i}>{r.slice(0, 6).map((x, j) => i ? <td key={j}>{x}</td> : <th key={j}>{x}</th>)}</tr>)}</tbody></table></div>}
    {c?.excerpt && !c.rows && <pre className="fc-x">{c.excerpt}</pre>}
  </div>;
}

export function useMdHandlers() {
  const app = useApp();
  const onLink = useCallback((href: string) => { if (isExternal(href)) return false; app.openFile(decodeURIComponent(href.replace(/^\.?\//, ""))); return true; }, [app]);
  const components = useMemo<SMComponents>(() => ({
    ui: ({ source, done }) => <Block source={source} done={done} />,
    canvas: (p) => <CanvasCard {...p} />,
    file: (p) => <FileCard {...p} />,
  }), []);
  const resolveSrc = useCallback((s: string) => (isExternal(s) || s.startsWith("data:") || s.startsWith("/") ? s : fileUrl(s)), []);
  return { onLink, components, resolveSrc };
}

/** Live text part: bursty chunks are paced into a steady reveal before rendering. */
function LiveText({ text, streaming, h, unverified }: { text: string; streaming: boolean; h: ReturnType<typeof useMdHandlers>; unverified?: string[] }) {
  const s = useSmoothText(text, streaming);
  return <StreamMarkdown text={s.text} streaming={s.live} unverified={unverified} {...h} />;
}

export const AssistantBody = memo(function AssistantBody({ parts, streaming, last, mid }: { parts: Part[]; streaming: boolean; last?: boolean; mid?: string }) {
  const h = useMdHandlers();
  const [animate] = useState(streaming); // messages loaded from history render instantly
  if (!parts.length && streaming) return <div className="thinking" />;
  let lastTodo = -1;
  parts.forEach((p, i) => { if (p.type === "tool" && p.name === "todo") lastTodo = i; });
  return <>{parts.map((p, i) => p.type === "text"
    ? animate ? <LiveText key={i} text={p.text} streaming={streaming && i === parts.length - 1} h={h} unverified={p.unverified} /> : <StreamMarkdown key={i} text={p.text} streaming={false} unverified={p.unverified} {...h} />
    : p.type === "reasoning" ? <Reasoning key={"r" + i} text={p.text} ms={p.ms} live={streaming && i === parts.length - 1} />
    : <ToolCall key={p.id + i} p={p} lastTodo={i === lastTodo} live={!!last && !streaming} mid={mid} />)}</>;
});

/** <ui_event label="…"> from a BlocksUI form/button: shown as a compact card instead of raw XML. */
function UiEvent({ content }: { content: string }) {
  const label = content.match(/^<ui_event[^>]*\blabel="([^"]*)"/)?.[1] || "Submitted";
  const body = content.replace(/^<ui_event[^>]*>\n?/, "").replace(/<\/ui_event>\s*$/, "").replace(/<instruction>[\s\S]*?<\/instruction>\n?/, "");
  const fields = [...body.matchAll(/^<([\w-]+)>([\s\S]*?)<\/\1>$/gm)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, " ").trim()] as const);
  return <details className="uievt"><summary><Send /><span>{label.replace(/&quot;/g, '"')}</span>{fields.length > 0 && <small>{fields.length} field{fields.length > 1 ? "s" : ""}</small>}</summary>
    {fields.length ? <dl>{fields.slice(0, 40).map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v.slice(0, 400) || "—"}</dd></div>)}</dl> : <pre>{body.trim().slice(0, 2000)}</pre>}
  </details>;
}

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
  onEdit?: () => void; onRegenerate?: () => void; onThread?: () => void; threadCount?: number; last?: boolean;
};

export const Message = memo(function Message({ m, streaming, sib, onNav, onEdit, onRegenerate, onThread, threadCount, last }: Props) {
  if (m.role === "user") return (
    <div className="turn user">
      {m.quote && <div className="quoteline">{m.quote}</div>}
      <Attachments items={m.attachments} />
      {m.content && (m.content.startsWith("<ui_event") ? <UiEvent content={m.content} /> : <div className="bubble">{m.content}</div>)}
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
      <div className="ai-content"><AssistantBody parts={m.parts} streaming={streaming} last={last} mid={m.id} /></div>
      {!streaming && <div className="actions">
        <Nav i={sib.i} n={sib.n} go={onNav} />
        <CopyBtn text={text} />
        {onRegenerate && <button className="ib sm" aria-label="Regenerate" onClick={onRegenerate}><RotateCcw /></button>}
        {onThread && <><button className="ib sm" aria-label="Thread" onClick={onThread}><MessageSquare /></button>{threadCount ? <span className="threadcount">{threadCount}</span> : null}</>}
      </div>}
    </div>
  );
});
