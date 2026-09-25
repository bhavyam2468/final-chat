"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, SquarePen, Folder, AppWindow, Link2, Settings2, X } from "lucide-react";
import { AppApi, AppCtx, CanvasSpec, Conv, Msg, Part, TreeNode, isExternal } from "./ctx";
import { Message } from "./Message";
import { Composer, ComposerHandle, SendPayload, Command } from "./Composer";
import { ChatsPanel, ConvItem, WorkspacePanel, ArtifactsPanel, SourcesPanel } from "./Panels";
import { CanvasLayer, Win } from "./Canvas";
import { Settings } from "./Settings";

const rid = () => "tmp" + Math.random().toString(36).slice(2, 10);
const keyOf = (parentId: string | null, threadOf: string | null) => parentId ?? `root:${threadOf ?? ""}`;
const toXml = (d: unknown): string => typeof d !== "object" || d === null ? String(d) : Object.entries(d as Record<string, unknown>).map(([k, v]) => `<${k}>${typeof v === "object" ? toXml(v) : String(v)}</${k}>`).join("\n");

export default function App() {
  const [convs, setConvs] = useState<ConvItem[]>([]);
  const [conv, setConv] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [streamId, setStreamId] = useState<string | null>(null);
  const [panels, setPanels] = useState({ chats: false, ws: false, art: false, src: false });
  const [thread, setThread] = useState<string | null>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [theme, setThemeS] = useState("dark");
  const [settings, setSettings] = useState(false);
  const [quotes, setQuotes] = useState<{ main: string | null; thread: string | null }>({ main: null, thread: null });
  const [editing, setEditing] = useState<string | null>(null);
  const [qpop, setQpop] = useState<{ x: number; y: number; text: string } | null>(null);
  const active = useRef<"main" | "thread">("main");
  const mainRef = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const convRef = useRef<Conv | null>(null); convRef.current = conv;

  useEffect(() => { const t = localStorage.getItem("theme") || "dark"; setThemeS(t); }, []);
  const setTheme = useCallback((t: string) => { setThemeS(t); localStorage.setItem("theme", t); document.documentElement.dataset.theme = t; }, []);
  const refreshTree = useCallback(() => { fetch("/api/workspace").then((r) => r.json()).then(setTree).catch(() => {}); }, []);
  const refreshConvs = useCallback(() => { fetch("/api/conversations").then((r) => r.json()).then(setConvs).catch(() => {}); }, []);
  useEffect(() => { refreshTree(); refreshConvs(); }, [refreshTree, refreshConvs]);

  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const onActivity = () => {
      setIdle(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), 2500);
    };
    onActivity();
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("mousedown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);

  // ---- tree helpers
  const kids = useMemo(() => {
    const m = new Map<string, Msg[]>();
    for (const x of msgs) { const k = keyOf(x.parentId, x.threadOf); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); }
    return m;
  }, [msgs]);
  const pathFor = useCallback((threadOf: string | null) => {
    const out: Msg[] = []; let cur: string | null = null;
    for (let g = 0; g < 2000; g++) {
      const ks = kids.get(keyOf(cur, threadOf)); if (!ks?.length) break;
      const pick = ks.find((k) => k.id === sel[keyOf(cur, threadOf)]) ?? ks[ks.length - 1];
      out.push(pick); cur = pick.id;
    }
    return out;
  }, [kids, sel]);
  const mainPath = useMemo(() => pathFor(null), [pathFor]);
  const threadPath = useMemo(() => (thread ? pathFor(thread) : []), [pathFor, thread]);
  const sibOf = useCallback((m: Msg) => { const ks = kids.get(keyOf(m.parentId, m.threadOf)) || [m]; return { i: Math.max(0, ks.findIndex((k) => k.id === m.id)), n: ks.length, ks }; }, [kids]);
  const nav = useCallback((m: Msg, d: number) => { const { i, ks } = sibOf(m); const t = ks[i + d]; if (t) setSel((s) => ({ ...s, [keyOf(m.parentId, m.threadOf)]: t.id })); }, [sibOf]);

  const loadConv = useCallback(async (id: string, leaf?: string, focusMsg?: string) => {
    const j = await fetch(`/api/conversations/${id}`).then((r) => r.json());
    if (j.error) return;
    const ms: Msg[] = j.messages;
    const by = new Map(ms.map((m) => [m.id, m]));
    const s: Record<string, string> = {};
    const target = leaf || focusMsg;
    let t = target ? by.get(target) : undefined;
    if (t?.threadOf) setThread(t.threadOf); else if (target) setThread(null);
    while (t) { s[keyOf(t.parentId, t.threadOf)] = t.id; t = t.parentId ? by.get(t.parentId) : undefined; }
    if (t === undefined && target) { const tm = by.get(target); if (tm?.threadOf) { let a = by.get(tm.threadOf); while (a) { s[keyOf(a.parentId, a.threadOf)] = a.id; a = a.parentId ? by.get(a.parentId) : undefined; } } }
    setConv(j.conversation); setMsgs(ms); setSel(s); setEditing(null);
    if (!target) setThread(null);
    if (focusMsg) setTimeout(() => document.querySelector(`[data-mid="${focusMsg}"]`)?.scrollIntoView({ block: "center" }), 80);
  }, []);

  const newChat = useCallback(() => { abort.current?.abort(); setConv(null); setMsgs([]); setSel({}); setThread(null); setStreamId(null); setTimeout(() => mainRef.current?.focus(), 0); }, []);

  // ---- streaming
  const send = useCallback(async (payload: SendPayload | null, parentId: string | null, threadOf: string | null) => {
    if (streamId) return;
    const tu = rid(); let ta = rid();
    const now = new Date().toISOString();
    const cid = convRef.current?.id || "";
    const aParent = payload ? tu : parentId;
    setMsgs((ms) => [...ms,
      ...(payload ? [{ id: tu, conversationId: cid, parentId, threadOf, role: "user" as const, content: payload.content, parts: [], attachments: payload.attachments, quote: payload.quote, createdAt: now }] : []),
      { id: ta, conversationId: cid, parentId: aParent, threadOf, role: "assistant" as const, content: "", parts: [], attachments: [], quote: null, createdAt: now, pending: true }]);
    setSel((s) => ({ ...s, ...(payload ? { [keyOf(parentId, threadOf)]: tu } : {}), [keyOf(aParent, threadOf)]: ta }));
    setStreamId(ta);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
    const ctrl = new AbortController(); abort.current = ctrl;
    const patchA = (fn: (parts: Part[]) => Part[]) => setMsgs((ms) => ms.map((m) => (m.id === ta ? { ...m, parts: fn(m.parts) } : m)));
    let convId = cid;
    try {
      const res = await fetch("/api/chat", { method: "POST", signal: ctrl.signal, body: JSON.stringify({ conversationId: cid || undefined, parentId: payload ? parentId : parentId, threadOf, user: payload || undefined }) });
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.t === "meta") {
            convId = e.conversationId;
            if (!convRef.current) { setConv({ id: e.conversationId, title: e.title, context: [], summary: null, summaryUpTo: null }); refreshConvs(); }
            const map: Record<string, string> = { [ta]: e.assistantId, ...(e.userId ? { [tu]: e.userId } : {}) };
            const r = (x: string | null) => (x && map[x]) || x;
            setMsgs((ms) => ms.map((m) => ({ ...m, id: r(m.id)!, parentId: r(m.parentId), conversationId: e.conversationId })));
            setSel((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [r(k)!, r(v)!])));
            ta = e.assistantId; setStreamId(ta);
          } else if (e.t === "text") patchA((p) => { const l = p[p.length - 1]; return l?.type === "text" ? [...p.slice(0, -1), { ...l, text: l.text + e.d }] : [...p, { type: "text", text: e.d }]; });
          else if (e.t === "tool") patchA((p) => [...p, { type: "tool", id: e.id, name: e.name, args: e.args }]);
          else if (e.t === "toolResult") { patchA((p) => p.map((x) => (x.type === "tool" && x.id === e.id ? { ...x, result: e.result, ok: e.ok, meta: e.meta } : x))); refreshTree(); }
          else if (e.t === "context") setConv((c) => (c ? { ...c, context: e.context } : c));
          else if (e.t === "artifact") { refreshTree(); openFileRef.current(e.path); }
          else if (e.t === "error" || e.t === "notice") patchA((p) => [...p, { type: "text", text: `\n\n> ${e.text}\n` }]);
        }
      }
    } catch { /* aborted */ }
    setStreamId(null); abort.current = null;
    refreshTree(); refreshConvs();
    if (convId) setTimeout(() => { fetch(`/api/conversations/${convId}`).then((r) => r.json()).then((j) => { if (j.messages && convRef.current?.id === convId) { setMsgs(j.messages); setConv(j.conversation); } }); }, 300);
  }, [streamId, refreshConvs, refreshTree]);

  const stop = useCallback(() => abort.current?.abort(), []);
  const sendMain = useCallback((p: SendPayload) => { const last = mainPath[mainPath.length - 1]; send(p, last?.id ?? null, null); }, [mainPath, send]);
  const sendThread = useCallback((p: SendPayload) => { const last = threadPath[threadPath.length - 1]; send(p, last?.id ?? null, thread); }, [threadPath, send, thread]);

  // ---- canvases
  const openCanvas = useCallback((spec: CanvasSpec) => {
    setWins((ws) => {
      const exists = ws.find((w) => JSON.stringify(w.spec) === JSON.stringify(spec));
      const z = Math.max(0, ...ws.map((w) => w.z)) + 1;
      if (exists) return ws.map((w) => (w === exists ? { ...w, z, min: false } : w));
      const w = Math.min(600, Math.round(innerWidth * 0.46)), h = Math.round(innerHeight * 0.72), n = ws.length;
      return [...ws, { id: rid(), spec, x: innerWidth - w - 24 - n * 24, y: 56 + n * 24, w, h, z, min: false, pinned: false }];
    });
  }, []);
  const openFile = useCallback((p: string) => {
    if (isExternal(p)) { window.open(p, "_blank"); return; }
    const clean = p.replace(/^\/?files\//, "").replace(/^\.\//, "");
    openCanvas({ kind: "file", path: clean, title: clean.split("/").pop() || clean });
  }, [openCanvas]);
  const openFileRef = useRef(openFile); openFileRef.current = openFile;

  const toggleContext = useCallback(async (p: string) => {
    const c = convRef.current;
    if (!c) { mainRef.current?.insert("@" + p + " "); return; }
    const next = c.context.includes(p) ? c.context.filter((x) => x !== p) : [...c.context, p];
    setConv({ ...c, context: next });
    await fetch(`/api/conversations/${c.id}`, { method: "PATCH", body: JSON.stringify({ context: next }) });
  }, []);

  const api: AppApi = useMemo(() => ({
    openFile, openCanvas, refreshTree, tree, context: conv?.context || [], toggleContext,
    sendUiEvent: (d: unknown) => sendMain({ content: `<ui_event>\n${toXml(d)}\n</ui_event>`, attachments: [], quote: null }),
    mention: (p: string) => mainRef.current?.insert("@" + p + " "),
    quote: (t: string) => setQuotes((q) => ({ ...q, [active.current]: t })),
  }), [openFile, openCanvas, refreshTree, tree, conv?.context, toggleContext, sendMain]);

  // ---- quote on selection
  useEffect(() => {
    const up = () => setTimeout(() => {
      const s = window.getSelection(); const t = s?.toString().trim();
      if (!s || !t || !s.rangeCount) { setQpop(null); return; }
      const node = s.anchorNode?.parentElement;
      if (!node?.closest(".ai-content")) { setQpop(null); return; }
      if (node.closest(".thread")) active.current = "thread"; else active.current = "main";
      const r = s.getRangeAt(0).getBoundingClientRect();
      setQpop({ x: r.left + r.width / 2, y: r.top - 8, text: t });
    }, 0);
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // ---- auto-scroll while streaming
  useEffect(() => {
    const el = scroller.current; if (!el || !streamId) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [msgs, streamId]);

  // ---- global shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPanels((p) => ({ ...p, chats: true })); }
      else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); setPanels((p) => ({ ...p, chats: !p.chats })); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); newChat(); }
      else if (mod && e.key === ".") { e.preventDefault(); setPanels((p) => ({ ...p, ws: !p.ws })); }
      else if (e.key === "Escape" && !(e.target as HTMLElement).closest("input,textarea")) { if (thread) setThread(null); else setPanels({ chats: false, ws: false, art: false, src: false }); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [newChat, thread]);

  const sources = useMemo(() => {
    const seen = new Set<string>(); const out: { url: string; title: string; snippet?: string }[] = [];
    for (const m of [...mainPath, ...threadPath]) for (const p of m.parts) if (p.type === "tool" && p.meta && (p.meta as { sources?: unknown[] }).sources)
      for (const s of (p.meta as { sources: { url: string; title: string; snippet?: string }[] }).sources) if (!seen.has(s.url)) { seen.add(s.url); out.push(s); }
    return out;
  }, [mainPath, threadPath]);

  const commands: Command[] = useMemo(() => [
    { name: "new", hint: "New chat", run: newChat },
    { name: "compact", hint: "Summarise history", run: async () => { const c = convRef.current, last = mainPath[mainPath.length - 1]; if (!c || !last) return; await fetch(`/api/conversations/${c.id}/compact`, { method: "POST", body: JSON.stringify({ leafId: last.id }) }); loadConv(c.id, last.id); } },
    { name: "chats", hint: "Chats", run: () => setPanels((p) => ({ ...p, chats: true })) },
    { name: "workspace", hint: "Files", run: () => setPanels((p) => ({ ...p, ws: true })) },
    { name: "artifacts", hint: "Artifacts", run: () => setPanels((p) => ({ ...p, art: true })) },
    { name: "sources", hint: "Sources", run: () => setPanels((p) => ({ ...p, src: true })) },
    { name: "context", hint: "Clear active context", run: async () => { const c = convRef.current; if (!c) return; setConv({ ...c, context: [] }); await fetch(`/api/conversations/${c.id}`, { method: "PATCH", body: JSON.stringify({ context: [] }) }); } },
    { name: "export", hint: "Download chat", run: () => { if (convRef.current) location.href = `/api/conversations/${convRef.current.id}/export`; } },
    { name: "theme", hint: "Toggle theme", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { name: "settings", hint: "Model, tools, MCP, skills", run: () => setSettings(true) },
  ], [newChat, mainPath, loadConv, setTheme, theme]);

  const renderTurn = (m: Msg, isThread: boolean) => {
    const sib = sibOf(m);
    if (editing === m.id) return (
      <div key={m.id} className="turn user"><div style={{ width: "100%" }}>
        <Composer inline autoFocus initial={{ content: m.content, attachments: m.attachments, quote: m.quote }} quote={m.quote}
          onCancel={() => setEditing(null)} onSend={(p) => { setEditing(null); send(p, m.parentId, m.threadOf); }} />
      </div></div>
    );
    return <Message key={m.id} m={m} streaming={m.id === streamId} sib={sib} onNav={(d) => nav(m, d)}
      onEdit={streamId ? undefined : () => setEditing(m.id)}
      onRegenerate={streamId ? undefined : () => send(null, m.parentId, m.threadOf)}
      onThread={isThread ? undefined : () => setThread(m.id)}
      threadCount={isThread ? 0 : msgs.filter((x) => x.threadOf === m.id).length} />;
  };

  const anchor = thread ? msgs.find((m) => m.id === thread) : null;
  const rightCount = [!!thread, panels.ws, panels.art, panels.src].filter(Boolean).length;
  const tog = (k: keyof typeof panels) => setPanels((p) => ({ ...p, [k]: !p[k] }));
  const hasOpenPanel = panels.chats || panels.ws || panels.art || panels.src || settings || !!thread;
  const chromeIdle = idle && !hasOpenPanel;

  return (
    <AppCtx.Provider value={api}>
      <div className="shell">
        <div className={"chrome l" + (chromeIdle ? " is-idle" : "")}>
          <button className={"ib" + (panels.chats ? " on" : "")} aria-label="Chats" onClick={() => tog("chats")}><PanelLeft /></button>
          <button className="ib" aria-label="New chat" onClick={newChat}><SquarePen /></button>
        </div>
        <div className={"chrome r" + (chromeIdle ? " is-idle" : "")}>
          <button className={"ib" + (panels.ws ? " on" : "")} aria-label="Workspace" onClick={() => tog("ws")}><Folder /></button>
          <button className={"ib" + (panels.art ? " on" : "")} aria-label="Artifacts" onClick={() => tog("art")}><AppWindow /></button>
          {sources.length > 0 && <button className={"ib" + (panels.src ? " on" : "")} aria-label="Sources" onClick={() => tog("src")}><Link2 /></button>}
          <button className="ib" aria-label="Settings" onClick={() => setSettings(true)}><Settings2 /></button>
        </div>

        <div className="scroll" ref={scroller}>
          <main className="column">{mainPath.map((m) => renderTurn(m, false))}</main>
        </div>

        <div className="dock">
          <Composer ref={mainRef} capture onSend={sendMain} streaming={!!streamId && !threadPath.some((m) => m.id === streamId)} onStop={stop}
            quote={quotes.main} onClearQuote={() => setQuotes((q) => ({ ...q, main: null }))} commands={commands} onFocus={() => (active.current = "main")} />
        </div>

        {panels.chats && <div className="lstack"><ChatsPanel convs={convs} current={conv?.id || null}
          onOpen={(id, leaf, msg) => { loadConv(id, leaf, msg); }} onClose={() => setPanels((p) => ({ ...p, chats: false }))}
          onDelete={async (id) => { await fetch(`/api/conversations/${id}`, { method: "DELETE" }); if (conv?.id === id) newChat(); refreshConvs(); }} /></div>}

        {rightCount > 0 && <div className={"rstack" + (rightCount > 1 ? " multi" : "")}>
          {thread && anchor && <div className="panel thread">
            <div className="panel-head"><span>Thread</span><span className="sp" /><button className="ib sm" aria-label="Close thread" onClick={() => setThread(null)}><X /></button></div>
            <div className="anchor">{anchor.content.replace(/<[^>]+>/g, "").slice(0, 300)}</div>
            <div className="panel-body">{threadPath.map((m) => renderTurn(m, true))}</div>
            <Composer inline onSend={sendThread} streaming={!!streamId && threadPath.some((m) => m.id === streamId)} onStop={stop}
              quote={quotes.thread} onClearQuote={() => setQuotes((q) => ({ ...q, thread: null }))} onFocus={() => (active.current = "thread")} autoFocus />
          </div>}
          {panels.ws && <WorkspacePanel onClose={() => tog("ws")} />}
          {panels.art && <ArtifactsPanel onClose={() => tog("art")} />}
          {panels.src && <SourcesPanel sources={sources} onClose={() => tog("src")} />}
        </div>}

        <CanvasLayer wins={wins} setWins={setWins} />
        {qpop && <button className="qpop" style={{ left: qpop.x, top: qpop.y }} onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setQuotes((q) => ({ ...q, [active.current]: qpop.text })); setQpop(null); window.getSelection()?.removeAllRanges(); }}>Quote</button>}
        {settings && <Settings onClose={() => setSettings(false)} theme={theme} setTheme={setTheme} />}
      </div>
    </AppCtx.Provider>
  );
}
