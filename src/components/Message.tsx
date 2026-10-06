"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { youtubeId } from "@/lib/shared";
import { Copy, Check, GitBranch, RotateCcw, MessageSquare, ChevronLeft, ChevronRight, FileText, Search, Globe, Terminal, Code2, FilePen, FolderTree, BookOpen, Layers, Package, Trash2, Plug, AppWindow, X, Monitor, Image as ImageIcon, ListChecks, Play, ScrollText, RotateCw, Square, ShieldCheck, Send, Bookmark } from "lucide-react";
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
/** Each known tool gets a human label; unknown/MCP calls use the same readable generic presentation. */
const TOOL_META: Record<string, Meta> = {
  skill_open: M(BookOpen, "Loading skill", "Loaded skill", "name"), skill_create: M(BookOpen, "Writing skill", "Wrote skill", "name"),
  skill_install: M(Package, "Installing skills", "Installed skills", "source"), mcp_search: M(Search, "Searching MCP servers", "Searched MCP servers", "query"),
  mcp_add: M(Package, "Adding MCP server", "Added MCP server", "name"), mcp_remove: M(Trash2, "Removing MCP server", "Removed MCP server", "name"),
  context_add: M(Layers, "Adding file to context", "Added file to context", "path"),
  context_remove: M(Layers, "Removing file from context", "Removed file from context", "path"), compact_context: M(Layers, "Summarising conversation", "Summarised conversation", "scope"),
  fs_list: M(FolderTree, "Listing folder", "Listed folder", "path"), fs_read: M(FileText, "Reading file", "Read file", "path"), fs_search: M(Search, "Searching files", "Searched files", "pattern"),
  fs_write: M(FilePen, "Writing file", "Wrote file", "path"), fs_edit: M(FilePen, "Updating file", "Updated file", "path"), fs_insert: M(FilePen, "Adding to file", "Added to file", "path"),
  fs_delete: M(Trash2, "Moving to trash", "Moved to trash", "path"), fs_move: M(FilePen, "Moving file", "Moved file", "to"),
  run_python: M(Code2, "Running Python", "Ran Python"), pip_install: M(Package, "Installing packages", "Installed packages", "packages"),
  shell: M(Terminal, "Running command", "Ran command", "command"), host_shell: M(Monitor, "Running command on your machine", "Ran command on your machine", "command"),
  web_search: M(Search, "Searching the web", "Searched the web", "query"), web_fetch: M(Globe, "Reading webpage", "Read webpage", "url"), web_extract: M(Globe, "Extracting page details", "Extracted page details", "url"),
  view_image: M(ImageIcon, "Opening image", "Opened image", "path"), todo: M(ListChecks, "Updating plan", "Updated plan"), ask_user: M(MessageSquare, "Asking you", "Asked you", "question"),
  canvas_open: M(AppWindow, "Opening preview", "Opened preview", "target"), ui_search: M(AppWindow, "Searching UI components", "Found UI components", "query"),
  proc_start: M(Play, "Starting process", "Started process", "name"), proc_logs: M(ScrollText, "Reading process output", "Read process output", "name"), proc_restart: M(RotateCw, "Restarting process", "Restarted process", "name"),
  proc_stop: M(Square, "Stopping process", "Stopped process", "name"), browser: M(Globe, "Using browser", "Used browser", "target"), check: M(ShieldCheck, "Running checks", "Finished checks", "path"),
  quality_check: M(ShieldCheck, "Reviewing design", "Reviewed design"), remember: M(Bookmark, "Saving memory", "Saved memory", "text"), forget: M(Bookmark, "Removing memory", "Removed memory", "id"),
  project_open: M(FolderTree, "Opening project", "Opened project", "name"), diff_since: M(GitBranch, "Checking recent changes", "Checked recent changes", "hours"),
  adb_devices: M(Monitor, "Checking connected devices", "Checked connected devices"), adb_install: M(Package, "Installing on device", "Installed on device", "path"),
  adb_launch: M(Play, "Opening app on device", "Opened app on device", "package"), adb_shot: M(ImageIcon, "Capturing device screen", "Captured device screen"),
  adb_tap: M(Monitor, "Sending touch input", "Sent touch input"), adb_logcat: M(ScrollText, "Reading device logs", "Read device logs"), adb_shell: M(Terminal, "Running device command", "Ran device command", "command"),
};
const humanize = (s: string) => s.replace(/^mcp__/, "").replace(/__/g, " · ").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
type Src = { url: string; title: string; snippet?: string };
/** Search sources stay with their search/fetch tool call; also used in the Sources side panel. */
export function SourceList({ items }: { items: Src[] }) {
  return <div className="srcs">{items.map((s, i) => { let host = ""; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch {}
    return <a key={i} className="src" href={s.url} target="_blank" rel="noreferrer" title={s.snippet || s.title}>
      <span className="n">{i + 1}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" />
      <span className="t"><b>{host}</b><small>{s.title}</small>{s.snippet && <span className="src-snippet">{s.snippet}</span>}</span>
    </a>; })}</div>;
}

type Todo = { text: string; status: "todo" | "doing" | "done" };
function TodoList({ items }: { items: Todo[] }) {
  return <ul className="todo">{items.map((t, i) => <li key={i} className={"s-" + t.status}><span className="box">{t.status === "done" ? <Check /> : null}</span>{t.text}</li>)}</ul>;
}

function AskCard({ q, options, multi, live }: { q: string; options: string[]; multi: boolean; live: boolean }) {
  const app = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null); // free-text answer, open when not null
  const send = (v: string) => { if (!live || sent || !v.trim()) return; setSent(v); app.sendText(v); };
  const done = !live || !!sent;
  return <div className="ask">
    <div className="ask-q">{q}</div>
    <div className="ask-o">{options.map((o) => <button key={o} disabled={done} className={picked.includes(o) || sent === o ? "on" : ""}
      onClick={() => (multi ? setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o])) : send(o))}>{o}</button>)}
      {!done && other === null && <button className="ghost" onClick={() => setOther("")}>Other</button>}
      {multi && !done && other === null && <button className="ib" aria-label="Send" disabled={!picked.length} onClick={() => send(picked.join(", "))}><Send /></button>}
    </div>
    {!done && other !== null && <form className="ask-other" onSubmit={(e) => { e.preventDefault(); send([...picked, other.trim()].filter(Boolean).join(", ")); }}>
      <input autoFocus aria-label="Your answer" value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setOther(null)} />
      <button className="ib" aria-label="Send" disabled={!other.trim()}><Send /></button>
    </form>}
    {!done && <button className="ask-skip" onClick={() => send("(skipped: decide yourself and say what you assumed)")}>Skip</button>}
  </div>;
}

type Approval = { cmd: string; reason: string; host: boolean; sudo?: boolean; decision?: "approve" | "deny" };
function ApproveBar({ ap, live, mid, pid }: { ap: Approval; live: boolean; mid?: string; pid: string }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const go = (d: "approve" | "deny") => {
    if (!mid || busy || (d === "approve" && ap.sudo && !pw)) return;
    setBusy(true); setErr("");
    app.decide(mid, pid, d, ap.cmd, ap.sudo && d === "approve" ? pw : undefined).then((e) => { if (e) setErr(e); }).finally(() => { setBusy(false); setPw(""); });
  };
  return <div className="approve">
    <div className="ap-why">{ap.reason}{ap.host ? " · on your machine" : ""}</div>
    <pre>{ap.cmd}</pre>
    {ap.decision ? <small>{ap.decision === "approve" ? "Approved" : "Denied"}</small>
      : live && mid ? <form className="ap-act" onSubmit={(e) => { e.preventDefault(); go("approve"); }}>
        {/* the password goes to sudo only: verified server-side, kept in memory for 30 min, never shown to the model */}
        {ap.sudo && <input className="ap-pw" type="password" autoFocus autoComplete="current-password" aria-label="Sudo password" value={pw} onChange={(e) => setPw(e.target.value)} />}
        {err && <span className="ap-err">{err}</span>}
        <button type="button" className="txt-btn" disabled={busy} onClick={() => go("deny")}>Deny</button>
        <button type="submit" className={"txt-btn solid" + (busy ? " busy" : "")} disabled={busy || (ap.sudo && !pw)}>{ap.sudo ? "Run with sudo" : "Run it"}</button>
      </form> : null}
  </div>;
}

const fmtMs = (ms: number) => ms < 1000 ? "<1s" : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
/** Model reasoning follows the provider's actual stream and duration; it folds when the step finishes. */
function Reasoning({ text, ms, startedAt, live }: { text: string; ms?: number; startedAt?: number; live: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(0);
  useEffect(() => { const el = body.current; if (live && el) el.scrollTop = el.scrollHeight; }, [text, live]);
  useEffect(() => {
    if (!live || ms !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, ms]);
  if (!text.trim()) return null;
  const duration = ms ?? (startedAt && now ? Math.max(0, now - startedAt) : 0);
  return <details className="reason" open={live || undefined}>
    <summary>{live ? <><span className="shimmer">Thinking</span>{duration > 0 && <small>{fmtMs(duration)}</small>}</> : ms !== undefined ? `Thought for ${fmtMs(ms)}` : "Thought"}</summary>
    <div className="reason-body" ref={body}>{text.trim()}</div>
  </details>;
}

/** Tool output streaming in while the tool runs, pinned to the bottom. */
function LiveOut({ text }: { text: string }) {
  const el = useRef<HTMLPreElement>(null);
  useEffect(() => { if (el.current) el.current.scrollTop = el.current.scrollHeight; }, [text]);
  return <pre ref={el} className="live-out">{text}</pre>;
}
function Elapsed({ startedAt }: { startedAt?: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t0 = startedAt || Date.now();
    const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - t0) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return seconds >= 3 ? <span className="elapsed">{fmtMs(seconds * 1000)}</span> : null;
}

const SECRET_KEY = /(password|secret|token|api.?key|authorization|credential)/i;
const OMIT_FROM_FIELDS = new Set(["code", "content", "text", "find", "replace", "edits", "steps", "items"]);
function concise(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 180);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.every((x) => typeof x === "string") ? value.join(", ").slice(0, 180) : `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return `${Object.keys(value).length} detail${Object.keys(value).length === 1 ? "" : "s"}`;
  return value == null ? "" : String(value);
}
function ArgFields({ args, omit = [] }: { args: Record<string, unknown>; omit?: string[] }) {
  const skip = new Set([...OMIT_FROM_FIELDS, ...omit]);
  const entries = Object.entries(args).filter(([k, v]) => !skip.has(k) && v !== undefined).slice(0, 12);
  if (!entries.length) return null;
  return <dl className="tool-args">{entries.map(([k, v]) => <div key={k}><dt>{humanize(k)}</dt><dd>{SECRET_KEY.test(k) ? "••••" : concise(v) || "—"}</dd></div>)}</dl>;
}
function StreamPreview({ name, args }: { name: string; args: Record<string, unknown> }) {
  if (name === "fs_edit") {
    const items = Array.isArray(args.edits) ? args.edits : [args];
    const edits = items.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const x = raw as Record<string, unknown>;
      const find = x.find ?? x.old_string ?? x.search ?? x.old;
      const replace = x.replace ?? x.new_string ?? x.new;
      return typeof find === "string" || typeof replace === "string" ? [{ find: String(find || ""), replace: String(replace || "") }] : [];
    });
    if (edits.length) return <div className="tool-preview-wrap"><div className="tool-preview-title">Preparing {edits.length} file edit{edits.length === 1 ? "" : "s"}</div>{edits.slice(0, 4).map((e, i) => <div className="tool-edit-preview" key={i}><span>Find</span><pre>{e.find.slice(0, 700) || "…"}</pre><span>Replace</span><pre>{e.replace.slice(0, 700) || "(remove)"}</pre></div>)}</div>;
  }
  const value = name === "fs_write" ? args.content : name === "fs_insert" ? args.text : name === "run_python" ? args.code : ["shell", "host_shell", "adb_shell"].includes(name) ? args.command : undefined;
  if (typeof value !== "string" || !value) return null;
  const title = name === "fs_write" ? "File contents" : name === "fs_insert" ? "Inserted text" : name === "run_python" ? "Python" : "Command";
  return <div className="tool-preview-wrap"><div className="tool-preview-title">{title}{value.length > 2200 ? " · preview" : ""}</div><pre className="tool-preview">{value.slice(0, 2200)}{value.length > 2200 ? "\n…" : ""}</pre></div>;
}
function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }): React.ReactNode {
  if (value === null || value === undefined) return <span className="result-muted">—</span>;
  if (typeof value === "string") return <span>{value.length > 1600 ? value.slice(0, 1600) + "…" : value}</span>;
  if (typeof value === "number" || typeof value === "boolean") return <span>{String(value)}</span>;
  if (depth > 3) return <span className="result-muted">More details</span>;
  if (Array.isArray(value)) return <ul className="result-list">{value.slice(0, 40).map((v, i) => <li key={i}><StructuredValue value={v} depth={depth + 1} /></li>)}{value.length > 40 && <li className="result-muted">and {value.length - 40} more</li>}</ul>;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
  if (!entries.length) return <span className="result-muted">No details</span>;
  return <dl className="result-fields">{entries.map(([k, v]) => <div key={k}><dt>{humanize(k)}</dt><dd>{SECRET_KEY.test(k) ? "••••" : <StructuredValue value={v} depth={depth + 1} />}</dd></div>)}</dl>;
}
function ReadableResult({ result, name }: { result: string; name: string }) {
  let value: unknown;
  try {
    value = JSON.parse(result);
    if (typeof value === "string") { try { value = JSON.parse(value); } catch { /* a normal text result */ } }
  } catch { value = undefined; }
  if (value !== undefined) return <div className="tool-structured"><StructuredValue value={value} /></div>;
  const match = result.match(/^exit\s+(\d+)\n/);
  const consoleLike = /^(run_python|shell|host_shell|pip_install|adb_|proc_logs)/.test(name);
  return <>
    {match && <div className={"tool-exit" + (match[1] === "0" ? " ok" : " err")}>Exit code {match[1]}</div>}
    <pre className={consoleLike ? "tool-console" : "tool-result"}>{match ? result.slice(match[0].length) : result}</pre>
  </>;
}

const ToolCall = memo(function ToolCall({ p, lastTodo, live, mid }: { p: Extract<Part, { type: "tool" }>; lastTodo?: boolean; live?: boolean; mid?: string }) {
  // The initial state is chosen once. After that, the user's toggle is the only
  // authority: completion, streamed output and parent rerenders must not reopen
  // or fold this call.
  const [open, setOpen] = useState(() => p.result === undefined);
  const app = useApp();
  const pending = p.result === undefined;
  const liveOut = p.live;
  const mcp = p.name.match(/^mcp__(.+?)__(.+)$/);
  const m: Meta = TOOL_META[p.name] || { icon: Plug, live: mcp ? `Using ${mcp[1]} · ${humanize(mcp[2])}` : p.name ? `Using ${humanize(p.name)}` : "Preparing tool call", done: mcp ? `Used ${mcp[1]} · ${humanize(mcp[2])}` : p.name ? `Used ${humanize(p.name)}` : "Tool call", arg: undefined };
  const Icon = m.icon;
  const meta = p.meta as { before?: string; after?: string; sources?: Src[]; path?: string; image?: string; todo?: Todo[]; question?: string; options?: string[]; multi?: boolean; memory?: { id: string; text: string; scope: string } } | undefined;
  const ap = (p.meta as { approval?: Approval } | undefined)?.approval;
  let target = m.arg ? concise(p.args[m.arg]) : "";
  if (!m.arg && mcp) target = Object.entries(p.args).filter(([k]) => !SECRET_KEY.test(k)).slice(0, 2).map(([k, v]) => `${humanize(k)}: ${concise(v)}`).filter((x) => !x.endsWith(": ")).join(" · ");
  if (ap) target = "";
  if (p.name === "todo" && meta?.todo) target = `${meta.todo.filter((t) => t.status === "done").length}/${meta.todo.length}`;
  if (p.name === "quality_check" && !pending) target = p.ok === false ? `${(p.result || "").split("\n").filter((l) => l.startsWith("- ")).length} issues` : "Clean";
  const filePath = typeof p.args.path === "string" && ["fs_write", "fs_edit", "fs_insert", "fs_read", "context_add", "view_image"].includes(p.name) && p.ok !== false ? p.args.path : null;
  if (p.name === "ask_user" && meta?.question) return <AskCard q={meta.question} options={meta.options || []} multi={!!meta.multi} live={!!live} />;
  const omit = [m.arg || ""];
  let body: React.ReactNode = null;
  if (open && pending) body = <>
    <div className="tool-activity" aria-live="polite"><span className="tool-activity-dot" /><span>{p.status || (p.name ? m.live : "Preparing tool call")}</span><i className="tool-activity-track"><b /></i></div>
    <StreamPreview name={p.name} args={p.args} />
    <ArgFields args={p.args} omit={omit} />
    {liveOut && <LiveOut text={liveOut} />}
  </>;
  else if (open && p.result !== undefined) {
    const changed = !!meta && "after" in meta;
    const sources = meta?.sources?.filter((s) => s.url) || [];
    body = <>
      {meta?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="tool-shot" src={fileUrl(meta.image)} alt="Tool result" onClick={() => app.openFile(meta.image!)} />
      )}
      {sources.length > 0 && <SourceList items={sources} />}
      {changed ? <div className="diff">{lineDiff(meta?.before || "", meta?.after || "").map((l, i) => <div key={i} className={l.k}>{l.k === "add" ? "+ " : l.k === "del" ? "- " : "  "}{l.t}</div>)}</div>
        : p.result && !(p.name === "web_search" && sources.length > 0) && <ReadableResult result={p.result} name={p.name} />}
    </>;
  }
  const copyTool = () => {
    const arg = p.args.command || p.args.code || p.args.path || p.args.query || "";
    navigator.clipboard.writeText(`$ ${p.name}${arg ? " " + concise(arg) : ""}\n${p.result || ""}`);
  };
  return (
    <div className={"tool" + (pending ? " live" : "")}>
      <div className="tool-line">
        <button className="tool-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <Icon /><span>{pending ? m.live : ap ? (ap.decision === "deny" ? "Not run" : ap.decision === "approve" ? "Approved" : "Needs approval") : m.done}</span>
          {target && (filePath && !pending
            ? <span className="tgt link" role="link" title="Open file" onClick={(e) => { e.stopPropagation(); app.openFile(filePath); }}>{target}</span>
            : <span className="tgt">{target}</span>)}
          {pending ? <><Elapsed startedAt={p.startedAt} /><span className="spin" /></> : p.ok === false && !ap ? <X className="err" /> : null}
        </button>
        {!pending && <button className="ib sm tool-copy" aria-label="Copy tool call" title="Copy command and output" onClick={copyTool}><Copy /></button>}
      </div>
      {p.name === "todo" && lastTodo && meta?.todo && <TodoList items={meta.todo} />}
      {open && body && <div className="tool-body">{body}</div>}
      {meta?.memory && <MemoryNote mem={meta.memory} />}
      {ap && <ApproveBar ap={ap} live={!!live} mid={mid} pid={p.id} />}
    </div>
  );
});

function ActivityGroup({ children, active, count }: { children: React.ReactNode; active: boolean; count: number }) {
  // Deliberately uncontrolled: the DOM owns <details>. Activity/completion/stream
  // changes may update the summary, but never write the `open` attribute, so a
  // user's choice survives every render of this group.
  return <details className="activity-group">
    <summary><span className={active ? "shimmer" : ""}>{active ? "Working" : "Activity"}</span><small>{count} steps</small>{active && <i className="spin" />}</summary>
    <div className="activity-group-body">{children}</div>
  </details>;
}

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
    const placement = dock ? { dock: true } : undefined;
    if (yt && /^\S+$/.test(t)) app.openCanvas({ kind: "youtube", title, id: yt }, placement);
    else if (onlyUi) app.openCanvas({ kind: "ui", title, source: t.replace(/^<ui[^>]*>/, "").replace(/<\/ui>$/, "") }, placement);
    else app.openCanvas({ kind: "md", title, body }, placement);
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
    {c?.kind === "image" && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl(p)} alt="" />
    )}
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

function MemoryNote({ mem }: { mem: { id: string; text: string; scope: string } }) {
  const [gone, setGone] = useState(false);
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(mem.text);
  if (gone) return <div className="mem-note">Forgotten</div>;
  const label = mem.scope === "profile" ? "Profile" : mem.scope === "project" ? "Project" : "Noted";
  return <div className="mem-note"><Bookmark /><span>{label}</span>
    {edit ? <input className="tx" value={text} aria-label="Edit memory" onChange={(e) => setText(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter") { await fetch("/api/memory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mem.id, text }) }); setEdit(false); } if (e.key === "Escape") setEdit(false); }} />
      : <span className="tx" onClick={() => setEdit(true)} title="Edit">{text}</span>}
    <button type="button" onClick={async () => { const r = await fetch("/api/memory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mem.id }) }); if (r.ok) setGone(true); }}>Undo</button></div>;
}

function Changes({ parts }: { parts: Part[] }) {
  const files = parts.filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool" && !!p.meta && typeof p.meta === "object" && "after" in (p.meta as object));
  if (!files.length) return null;
  return <details className="changes"><summary>Changed {files.length} file{files.length > 1 ? "s" : ""}</summary>
    {files.map((p) => {
      const meta = p.meta as { before?: string; after?: string; path?: string };
      return <div key={p.id} className="diff"><div className="tgt">{String(p.args.path || meta.path || p.name)}</div>{lineDiff(meta.before || "", meta.after || "").slice(0, 80).map((l, i) => <div key={i} className={l.k}>{l.k === "add" ? "+ " : l.k === "del" ? "- " : "  "}{l.t}</div>)}</div>;
    })}
  </details>;
}

function ThinkingState({ startedAt }: { startedAt?: number }) {
  return <div className="thinking-live"><span className="spin" /><span className="shimmer">Thinking</span><Elapsed startedAt={startedAt} /></div>;
}
function StreamSilence({ revision, active }: { revision: Part[]; active: boolean }) {
  const [elapsed, setElapsed] = useState<{ revision: Part[]; ms: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed({ revision, ms: Date.now() - t0 }), 1000);
    return () => clearInterval(timer);
  }, [revision, active]);
  const ms = elapsed?.revision === revision ? elapsed.ms : 0;
  if (!active || ms < 2000) return null;
  return <div className="stream-silence"><span className="spin" /><span>Waiting for model</span><small>No new output · {fmtMs(ms)}</small></div>;
}

export const AssistantBody = memo(function AssistantBody({ parts, streaming, last, mid, startedAt }: { parts: Part[]; streaming: boolean; last?: boolean; mid?: string; startedAt?: number }) {
  const h = useMdHandlers();
  const [animate] = useState(streaming); // messages loaded from history render instantly
  if (!parts.length && streaming) return <ThinkingState startedAt={startedAt} />;
  let lastTodo = -1;
  parts.forEach((p, i) => { if (p.type === "tool" && p.name === "todo") lastTodo = i; });
  const visible = parts.map((p, index) => ({ p, index })).filter(({ p }) => p.type !== "reasoning" || !!p.text.trim());
  const render = ({ p, index }: { p: Part; index: number }, key: string): React.ReactNode => p.type === "text"
    ? animate ? <LiveText key={key} text={p.text} streaming={streaming && index === parts.length - 1} h={h} unverified={p.unverified} />
      : <StreamMarkdown key={key} text={p.text} streaming={false} unverified={p.unverified} {...h} />
    : p.type === "reasoning" ? <Reasoning key={key} text={p.text} ms={p.ms} startedAt={p.startedAt} live={streaming && p.ms === undefined && !parts.slice(index + 1).some((x) => x.type === "text")} />
      : <ToolCall key={key} p={p} lastTodo={index === lastTodo} live={!!last && !streaming} mid={mid} />;
  const isActivity = (p: Part) => p.type === "tool" || p.type === "reasoning";
  const activePart = ({ p, index }: { p: Part; index: number }) => p.type === "tool" ? p.result === undefined : p.type === "reasoning" && streaming && p.ms === undefined && !parts.slice(index + 1).some((x) => x.type === "text");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < visible.length;) {
    const item = visible[i];
    if (!isActivity(item.p)) {
      out.push(render(item, `part-${item.index}`));
      i++;
      continue;
    }
    let end = i + 1;
    while (end < visible.length && isActivity(visible[end].p)) end++;
    const batch = visible.slice(i, end);
    const nodes = batch.map((x) => render(x, `part-${x.index}`));
    if (batch.length > 1) out.push(<ActivityGroup key={`group-${item.index}`} active={batch.some((x) => activePart(x))} count={batch.length}>{nodes}</ActivityGroup>);
    else out.push(nodes[0]);
    i = end;
  }
  const hasActiveTool = parts.some((p) => p.type === "tool" && p.result === undefined);
  const hasLiveThought = parts.some((p, i) => p.type === "reasoning" && p.ms === undefined && !parts.slice(i + 1).some((x) => x.type === "text"));
  return <>{out}<StreamSilence revision={parts} active={streaming && !hasActiveTool && !hasLiveThought} /></>;
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
  onEdit?: () => void; onRegenerate?: () => void; onThread?: () => void; threadCount?: number; last?: boolean; quiet?: boolean;
};

export const Message = memo(function Message({ m, streaming, sib, onNav, onEdit, onRegenerate, onThread, threadCount, last, quiet }: Props) {
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
      <div className="ai-content"><AssistantBody parts={m.parts} streaming={streaming} last={last} mid={m.id} startedAt={m.streamStartedAt} />{!streaming && !quiet && <Changes parts={m.parts} />}</div>
      {!streaming && <div className="actions">
        <Nav i={sib.i} n={sib.n} go={onNav} />
        <CopyBtn text={text} />
        {onRegenerate && <button className="ib sm" aria-label="Regenerate" onClick={onRegenerate}><RotateCcw /></button>}
        {onThread && <><button className="ib sm" aria-label="Thread" onClick={onThread}><MessageSquare /></button>{threadCount ? <span className="threadcount">{threadCount}</span> : null}</>}
      </div>}
    </div>
  );
});
