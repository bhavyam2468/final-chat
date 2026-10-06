"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, SquarePen, MessageSquareShare, Folder, AppWindow, Link2, Settings2, X } from "lucide-react";
import { AppApi, AppCtx, CanvasSpec, Conv, Msg, OpenOpts, Part, TreeNode, isExternal } from "./ctx";
import { Message } from "./Message";
import { Composer, ComposerHandle, SendPayload, Command, upload } from "./Composer";
import { chatDir } from "@/lib/shared";
import { ChatsPanel, ConvItem, WorkspacePanel, ArtifactsPanel, SourcesPanel, CtxRef } from "./Panels";
import { CanvasLayer } from "./Canvas";
import { Win, cascadeRect, contentRatio, migrateWin, sameSpec, viewport } from "./canvas/types";
import { Settings } from "./Settings";

const rid = () => "tmp" + Math.random().toString(36).slice(2, 10);
function DockStatus({ conv, offerBrief, streamId, onBrief, onUnlink }: { conv: Conv | null; offerBrief: boolean; streamId: string | null; onBrief: () => void; onUnlink: () => void }) {
  if (!offerBrief && !conv?.state?.project) return null;
  return <div className="dock-extra">
    {conv?.state?.project && <button className="promote" onClick={onUnlink} title="Unlink project">Project {conv.state.project}</button>}
    {offerBrief && !streamId && <button className="promote" onClick={onBrief}>Morning brief</button>}
  </div>;
}
const withMode = (c: Conv): Conv => ({ ...c, mode: c.state?.mode === "general" || c.state?.mode === "search" || c.mode === "general" ? "general" : "chat" });
const NONE: Msg[] = [];
const keyOf = (parentId: string | null, threadOf: string | null) => parentId ?? `root:${threadOf ?? ""}`;
const toXml = (d: unknown): string => typeof d !== "object" || d === null ? String(d) : Object.entries(d as Record<string, unknown>).map(([k, v]) => `<${k}>${typeof v === "object" ? toXml(v) : String(v)}</${k}>`).join("\n");

export default function App() {
  const [convs, setConvs] = useState<ConvItem[]>([]);
  const [conv, setConv] = useState<Conv | null>(null);
  const convsRef = useRef(convs); convsRef.current = convs;
  const convTitles = useMemo(() => Object.fromEntries(convs.map((c) => [c.id, c.title])), [convs]);
  // every chat keeps its own messages and its own stream: switching chats never stops or hides a running answer
  const [store, setStore] = useState<Record<string, Msg[]>>({});
  const [view, setViewS] = useState(() => "new:" + rid());
  const viewRef = useRef(view);
  const winsCache = useRef<Record<string, Win[]>>({});
  // A new conversation starts in General. It is intentionally separate from
  // normal chat history and can be promoted in one deliberate action.
  const [surface, setSurface] = useState<"general" | "chat">("general");
  const modeRef = useRef<"chat" | "general">("general");
  const pendingProject = useRef<string | null>(null);
  const [offerBrief, setOfferBrief] = useState(false);
  // canvases live per chat: switching chats parks this chat's windows and restores that chat's
  const setView = useCallback((k: string) => {
    const prev = viewRef.current;
    if (prev !== k) {
      winsCache.current[prev] = winsRef.current;
      const load = winsCache.current[k] ?? (() => { try { const v = JSON.parse(localStorage.getItem("wins:" + k) || "null"); return Array.isArray(v) ? (v as Win[]).map(migrateWin) : null; } catch { return null; } })();
      setWins(load || []);
    }
    viewRef.current = k; setViewS(k);
  }, []);
  const msgs = store[view] || NONE;
  const setMsgsFor = useCallback((k: string, fn: (m: Msg[]) => Msg[]) => setStore((st) => ({ ...st, [k]: fn(st[k] || NONE) })), []);
  const setMsgs = useCallback((v: Msg[] | ((m: Msg[]) => Msg[])) => setMsgsFor(viewRef.current, typeof v === "function" ? v : () => v), [setMsgsFor]);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [running, setRunningS] = useState<Record<string, string>>({}); // chat key → assistant message id
  const runningRef = useRef(running);
  const setRunning = useCallback((fn: (r: Record<string, string>) => Record<string, string>) => setRunningS((r) => { const n = fn(r); runningRef.current = n; return n; }), []);
  const streamId = running[view] || null;
  const attached = useRef(new Set<string>()); // chats this page is currently reading a stream for
  const [serverRunning, setServerRunning] = useState<string[]>([]);
  // side panel widths (drag the inner edge); persisted
  const [pw, setPw] = useState<{ l: number; r: number }>({ l: 272, r: 300 });
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("panelW") || "null"); if (v?.l && v?.r) setPw(v); } catch {} }, []); // eslint-disable-line react-hooks/set-state-in-effect
  const resize = (side: "l" | "r") => (e: React.PointerEvent) => {
    e.preventDefault(); const x0 = e.clientX, w0 = pw[side]; document.body.classList.add("dragging");
    let last = pw;
    const mv = (ev: PointerEvent) => { const w = Math.max(220, Math.min(Math.round(window.innerWidth * 0.45), w0 + (side === "l" ? ev.clientX - x0 : x0 - ev.clientX))); last = { ...last, [side]: w }; setPw(last); };
    const up = () => { document.body.classList.remove("dragging"); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); localStorage.setItem("panelW", JSON.stringify(last)); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const [panels, setPanels] = useState({ chats: false, ws: false, art: false, src: false });
  const [thread, setThread] = useState<string | null>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const winsRef = useRef(wins); winsRef.current = wins;
  const [recent, setRecent] = useState<CanvasSpec[]>([]);
  // remember each chat's windows (shape, size, position, pinned, peeked) across reloads
  useEffect(() => {
    winsCache.current[view] = wins;
    if (!view.startsWith("new:")) { try { localStorage.setItem("wins:" + view, JSON.stringify(wins)); } catch { /* quota */ } }
  }, [wins, view]);
  /* eslint-disable react-hooks/set-state-in-effect -- mirror the per-chat localStorage list */
  useEffect(() => {
    if (!conv?.id) { setRecent([]); return; }
    try { setRecent(JSON.parse(localStorage.getItem("recent:" + conv.id) || "[]")); } catch { setRecent([]); }
  }, [conv?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [dockW, setDockWS] = useState(560);
  const [ctxRev, setCtxRev] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only preference, read after hydration
  useEffect(() => { const v = Number(localStorage.getItem("dockW")); setDockWS(v >= 320 ? Math.min(v, innerWidth - 380) : Math.round(Math.min(720, Math.max(380, innerWidth * 0.42)))); }, []);
  const setDockW = useCallback((w: number) => { setDockWS(w); localStorage.setItem("dockW", String(w)); }, []);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [theme, setThemeS] = useState("dark");
  const [settings, setSettings] = useState(false);
  const [quotes, setQuotes] = useState<{ main: string | null; thread: string | null }>({ main: null, thread: null });
  const [editing, setEditing] = useState<string | null>(null);
  const [qpop, setQpop] = useState<{ x: number; y: number; text: string } | null>(null);
  const active = useRef<"main" | "thread">("main");
  const mainRef = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const convRef = useRef<Conv | null>(null); convRef.current = conv;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only preference, read after hydration
  useEffect(() => { const t = localStorage.getItem("theme") || "dark"; setThemeS(t); const h = new Date().getHours(); const day = new Date().toISOString().slice(0, 10); setOfferBrief(h >= 5 && h < 11 && localStorage.getItem("briefDay") !== day); }, []);
  // Copying a rendered formula copies the LaTeX, not the glyph soup.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const node = window.getSelection()?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const ann = el?.closest(".katex")?.querySelector("annotation");
      if (ann?.textContent && e.clipboardData) { e.clipboardData.setData("text/plain", ann.textContent); e.preventDefault(); }
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
  const setTheme = useCallback((t: string) => { setThemeS(t); localStorage.setItem("theme", t); document.documentElement.dataset.theme = t; }, []);
  const refreshTree = useCallback(() => { fetch("/api/workspace").then((r) => r.json()).then(setTree).catch(() => {}); }, []);
  const refreshConvs = useCallback(() => {
    fetch("/api/conversations").then((r) => r.json()).then(setConvs).catch(() => {});
    fetch("/api/chat").then((r) => r.json()).then((j) => setServerRunning(j.running || [])).catch(() => {});
  }, []);
  useEffect(() => { refreshTree(); refreshConvs(); }, [refreshTree, refreshConvs]);
  // Developer mode lives in the console only: window.__dev.enable() | disable() | mock() | samples()
  useEffect(() => {
    const post = (b: object) => fetch("/api/dev", { method: "POST", body: JSON.stringify(b) }).then((r) => r.json());
    (window as unknown as { __dev: object }).__dev = {
      enable: () => post({ enable: true }).then((r) => (console.info("developer mode on: __dev.mock() switches to the offline model, __dev.samples() writes example files"), r)),
      disable: () => post({ enable: false }),
      mock: () => post({ mock: true }),
      samples: () => post({ samples: true }).then((r) => { refreshTree(); return r; }),
    };
  }, [refreshTree]);

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
    setView(id); setEditing(null);
    const j = await fetch(`/api/conversations/${id}`).then((r) => r.json());
    if (j.error || viewRef.current !== id) return;
    // a chat streaming in this page: its live messages are ahead of the server copy
    const live = !!runningRef.current[id];
    const ms: Msg[] = live ? (storeRef.current[id] || j.messages) : j.messages;
    const by = new Map(ms.map((m) => [m.id, m]));
    const s: Record<string, string> = {};
    const target = leaf || focusMsg;
    let t = target ? by.get(target) : undefined;
    if (t?.threadOf) setThread(t.threadOf); else if (target) setThread(null);
    while (t) { s[keyOf(t.parentId, t.threadOf)] = t.id; t = t.parentId ? by.get(t.parentId) : undefined; }
    if (t === undefined && target) { const tm = by.get(target); if (tm?.threadOf) { let a = by.get(tm.threadOf); while (a) { s[keyOf(a.parentId, a.threadOf)] = a.id; a = a.parentId ? by.get(a.parentId) : undefined; } } }
    const loaded = withMode(j.conversation); modeRef.current = loaded.mode || "chat"; setSurface(loaded.mode || "chat"); setConv(loaded); setMsgsFor(id, () => ms); setSel((x) => ({ ...x, ...s }));
    if (!target) setThread(null);
    if (!live) attachRef.current(id); // re-attach if the server is still answering (e.g. after a reload)
    // Reopen a conversation at its latest turn. A focused search result is
    // the only intentional exception.
    setTimeout(() => {
      if (focusMsg) document.querySelector(`[data-mid="${focusMsg}"]`)?.scrollIntoView({ block: "center" });
      else scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "auto" });
    }, 80);
  }, [setView, setMsgsFor]);

  const setMode = useCallback((m: "general" | "chat") => { modeRef.current = m; setSurface(m); }, []);
  const newChat = useCallback(() => { setMode("general"); setView("new:" + rid()); setConv(null); setThread(null); setEditing(null); setTimeout(() => mainRef.current?.focus(), 0); }, [setView, setMode]);
  const promote = useCallback(async () => {
    const c = convRef.current;
    // Before the first message there is no database row to patch; switching
    // the pending composer is enough and the next POST creates a chat.
    if (!c) { setMode("chat"); return; }
    await fetch(`/api/conversations/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "chat" }) });
    setMode("chat"); setConv({ ...c, mode: "chat", state: { ...(c.state || {}), mode: "chat" } }); refreshConvs();
  }, [setMode, refreshConvs]);

  // ---- streaming (one reader per chat; events patch that chat's messages wherever the user is)
  const storeRef = useRef(store); storeRef.current = store;
  const stopAsked = useRef(new Set<string>()); // Stop pressed before a new chat got its id
  const consume = useCallback(async (res: Response, key0: string, ids: { ta: string; tu?: string }, attach = false) => {
    let key = key0, ta = ids.ta; const tu = ids.tu;
    const patchA = (fn: (parts: Part[]) => Part[]) => setMsgsFor(key, (ms) => ms.map((m) => (m.id === ta ? { ...m, parts: fn(m.parts) } : m)));
    attached.current.add(key);
    try {
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.t === "meta") {
            const cid = e.conversationId as string;
            if (attach) {
              // re-attached to a run started elsewhere: the user message is saved, the answer is not yet
              ta = e.assistantId;
              setMsgsFor(key, (ms) => ms.some((m) => m.id === ta) ? ms.map((m) => m.id === ta ? { ...m, streamStartedAt: Number(e.startedAt) || undefined } : m) : [...ms, { id: ta, conversationId: cid, parentId: e.parentId, threadOf: e.threadOf ?? null, role: "assistant", content: "", parts: [], attachments: [], quote: null, createdAt: new Date(Number(e.startedAt) || Date.now()).toISOString(), pending: true, streamStartedAt: Number(e.startedAt) || undefined }]);
              setSel((x) => ({ ...x, [keyOf(e.parentId, e.threadOf ?? null)]: ta }));
              setRunning((r) => ({ ...r, [key]: ta }));
              continue;
            }
            const map: Record<string, string> = { [ta]: e.assistantId, ...(e.userId && tu ? { [tu]: e.userId } : {}) };
            const r = (x: string | null) => (x && map[x]) || x;
            if (key !== cid) { // a new chat got its id: move its messages, stream and view over
              const old = key; key = cid; attached.current.delete(old); attached.current.add(cid);
              setStore((st) => { const n = { ...st, [cid]: st[old] || [] }; delete n[old]; return n; });
              setRunning((x) => { const n = { ...x, [cid]: x[old] }; delete n[old]; return n; });
              if (viewRef.current === old) {
                setView(cid);
                const project = pendingProject.current || undefined;
                pendingProject.current = null;
                if (project) fetch(`/api/conversations/${cid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) });
                setConv({ id: cid, title: e.title, context: [], summary: null, summaryUpTo: null, mode: modeRef.current, state: project ? { project } : undefined });
              }
              refreshConvs();
            }
            setMsgsFor(key, (ms) => ms.map((m) => ({ ...m, id: r(m.id)!, parentId: r(m.parentId), conversationId: cid, ...(m.id === ta && Number(e.startedAt) ? { streamStartedAt: Number(e.startedAt) } : {}) })));
            setSel((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k)!, r(v)!])));
            ta = e.assistantId; setRunning((x) => ({ ...x, [key]: ta }));
            if (stopAsked.current.has(key0)) { stopAsked.current.delete(key0); fetch("/api/chat", { method: "POST", body: JSON.stringify({ stop: true, conversationId: cid }) }); }
          } else if (e.t === "reasoning") patchA((p) => {
            const id = typeof e.id === "string" ? e.id : undefined;
            let i = id ? p.findIndex((x) => x.type === "reasoning" && x.id === id) : -1;
            if (i < 0 && !id) for (let k = p.length - 1; k >= 0; k--) { const x = p[k]; if (x.type === "reasoning" && x.ms === undefined) { i = k; break; } }
            if (i >= 0 && p[i].type === "reasoning") return p.map((x, k) => k === i && x.type === "reasoning" ? { ...x, text: x.text + e.d, startedAt: x.startedAt ?? e.startedAt } : x);
            return [...p, { type: "reasoning", id, text: e.d, startedAt: e.startedAt }];
          });
          else if (e.t === "reasoningEnd") patchA((p) => {
            const i = p.findIndex((x) => x.type === "reasoning" && (e.id ? x.id === e.id : x.ms === undefined));
            return i < 0 ? p : p.map((x, k) => k === i && x.type === "reasoning" ? { ...x, ms: Number(e.ms) || 0 } : x);
          });
          else if (e.t === "retext") patchA((p) => {
            // the server rewrote the current text part (reasoning retracted, loop cut, printed tool call removed)
            let i = p.length - 1; while (i >= 0 && p[i].type === "reasoning") i--;
            if (i < 0 || p[i].type !== "text") return p;
            return e.text ? p.map((x, k) => (k === i ? { ...x, text: e.text } : x)) : p.filter((_, k) => k !== i);
          });
          else if (e.t === "text") patchA((p) => { const l = p[p.length - 1]; return l?.type === "text" ? [...p.slice(0, -1), { ...l, text: l.text + e.d }] : [...p, { type: "text", text: e.d }]; });
          else if (e.t === "toolStart") patchA((p) => {
            const i = p.findIndex((x) => x.type === "tool" && x.id === e.id);
            const draft = { type: "tool" as const, id: String(e.id), name: String(e.name || ""), args: (e.args || {}) as Record<string, unknown>, startedAt: e.startedAt as number | undefined };
            return i < 0 ? [...p, draft] : p.map((x, k) => k === i && x.type === "tool" ? { ...x, ...draft, args: Object.keys(draft.args).length ? draft.args : x.args } : x);
          });
          else if (e.t === "toolDraft") patchA((p) => p.map((x) => x.type === "tool" && x.id === e.id ? { ...x, name: String(e.name || x.name), args: (e.args || x.args) as Record<string, unknown>, startedAt: x.startedAt ?? e.startedAt as number | undefined } : x));
          else if (e.t === "tool") patchA((p) => {
            const i = p.findIndex((x) => x.type === "tool" && x.id === e.id);
            const update = { name: String(e.name), args: e.args as Record<string, unknown>, startedAt: e.startedAt as number | undefined };
            return i < 0 ? [...p, { type: "tool", id: String(e.id), ...update }] : p.map((x, k) => k === i && x.type === "tool" ? { ...x, ...update, startedAt: x.startedAt ?? update.startedAt } : x);
          });
          else if (e.t === "toolStatus") patchA((p) => p.map((x) => x.type === "tool" && x.id === e.id ? { ...x, status: String(e.status || "") } : x));
          else if (e.t === "toolOutput") patchA((p) => p.map((x) => (x.type === "tool" && x.id === e.id ? { ...x, live: (x.live || "") + e.chunk } : x)));
          else if (e.t === "canvas") { if (viewRef.current === key) openCanvasRef.current(e.spec, { dock: e.dock }); }
          else if (e.t === "compacted") setCtxRev((r) => r + 1);
          else if (e.t === "toolResult") { patchA((p) => p.map((x) => (x.type === "tool" && x.id === e.id ? { ...x, result: e.result, ok: e.ok, meta: e.meta, status: undefined, live: undefined } : x))); refreshTree(); }
          else if (e.t === "context") { if (viewRef.current === key) setConv((c) => (c ? { ...c, context: e.context } : c)); }
          else if (e.t === "artifact") refreshTree(); // canvas cards open themselves
          else if (e.t === "error" || e.t === "notice") patchA((p) => [...p, { type: "text", text: `\n\n> ${e.text}\n` }]);
        }
      }
    } catch { /* connection dropped: the run continues on the server; loadConv re-attaches */ }
    attached.current.delete(key);
    setRunning((r) => { const n = { ...r }; delete n[key]; return n; });
    refreshTree(); refreshConvs(); setCtxRev((r) => r + 1);
    // the server saved the final message (partial if stopped) before it reported done: take the saved copy
    if (!key.startsWith("new:")) fetch(`/api/conversations/${key}`).then((r) => r.json()).then((j) => { if (!j.messages || runningRef.current[key]) return; setMsgsFor(key, () => j.messages); if (viewRef.current === key) { const c = withMode(j.conversation); setConv(c); if (c.mode) { modeRef.current = c.mode; setSurface(c.mode); } } }).catch(() => {});
  }, [setMsgsFor, setRunning, setView, refreshConvs, refreshTree]);

  const attachTo = useCallback(async (id: string) => {
    if (attached.current.has(id) || runningRef.current[id]) return;
    const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`).catch(() => null);
    if (!res || res.status !== 200 || attached.current.has(id)) return;
    consume(res, id, { ta: "" }, true);
  }, [consume]);
  const attachRef = useRef(attachTo); attachRef.current = attachTo;

  const send = useCallback(async (payload: SendPayload | null, parentId: string | null, threadOf: string | null) => {
    const key = viewRef.current;
    if (runningRef.current[key]) return;
    const tu = rid(); const ta = rid();
    const now = new Date().toISOString();
    const cid = convRef.current?.id || "";
    const aParent = payload ? tu : parentId;
    setMsgsFor(key, (ms) => [...ms,
      ...(payload ? [{ id: tu, conversationId: cid, parentId, threadOf, role: "user" as const, content: payload.content, parts: [], attachments: payload.attachments, quote: payload.quote, createdAt: now }] : []),
      { id: ta, conversationId: cid, parentId: aParent, threadOf, role: "assistant" as const, content: "", parts: [], attachments: [], quote: null, createdAt: now, pending: true }]);
    setSel((s) => ({ ...s, ...(payload ? { [keyOf(parentId, threadOf)]: tu } : {}), [keyOf(aParent, threadOf)]: ta }));
    setRunning((r) => ({ ...r, [key]: ta }));
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
    const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ conversationId: cid || undefined, parentId, threadOf, user: payload || undefined, mode: modeRef.current }) }).catch(() => null);
    if (!res || !res.ok) {
      const err = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "Network error";
      setMsgsFor(key, (ms) => ms.map((m) => (m.id === ta ? { ...m, pending: false, parts: [{ type: "text", text: `> ${err || "Request failed"}` }] } : m)));
      setRunning((r) => { const n = { ...r }; delete n[key]; return n; });
      return;
    }
    consume(res, key, { ta, tu: payload ? tu : undefined });
  }, [consume, setMsgsFor, setRunning]);

  // Stop: the server stops the run, saves what was written so far, then ends the stream
  const stop = useCallback(() => {
    const key = viewRef.current;
    if (key.startsWith("new:")) { stopAsked.current.add(key); return; }
    fetch("/api/chat", { method: "POST", body: JSON.stringify({ stop: true, conversationId: key }) });
  }, []);
  const sendMain = useCallback((p: SendPayload) => { const last = mainPath[mainPath.length - 1]; send(p, last?.id ?? null, null); }, [mainPath, send]);
  const sendThread = useCallback((p: SendPayload) => { const last = threadPath[threadPath.length - 1]; send(p, last?.id ?? null, thread); }, [threadPath, send, thread]);

  // ---- canvases
  // dock-first: canvases open beside the chat by default; if the dock is taken they float,
  // sized around their content (a 16:9 image opens as a ~16:9 window hugging it, centred).
  // An explicit dock request displaces the current occupant — it parks in the rail.
  const openCanvas = useCallback((spec: CanvasSpec, o?: OpenOpts) => {
    const remember = () => {
      const k = viewRef.current; if (k.startsWith("new:")) return;
      try {
        const l = [spec, ...JSON.parse(localStorage.getItem("recent:" + k) || "[]").filter((x: CanvasSpec) => JSON.stringify(x) !== JSON.stringify(spec))].slice(0, 8);
        localStorage.setItem("recent:" + k, JSON.stringify(l)); setRecent(l);
      } catch { /* quota */ }
    };
    void contentRatio(spec).then((ratio) => {
      remember();
      setWins((ws) => {
        const vp = viewport();
        const dock = (o?.dock ?? true) && vp.w >= 760; // dock-first; narrow screens float
        const exists = ws.find((w) => sameSpec(w.spec, spec));
        const z = Math.max(0, ...ws.map((w) => w.z)) + 1;
        // the sidebar holds one window: an explicit dock displaces the occupant into the rail
        const undock = (w: Win): Win => (dock && w.dock && (!exists || w.id !== exists.id) ? { ...w, dock: false, min: true, home: { x: w.x, y: w.y, w: w.w, h: w.h }, wasDock: true } : w);
        if (exists) {
          const me = { ...exists, z, min: false, peek: null, dock: dock || (exists.dock && !exists.min) };
          return ws.map((w) => (w.id === exists.id ? me : undock(w)));
        }
        const r = cascadeRect(ratio ? ratio.ratio : null, ratio?.pw, ws.filter((w) => !w.dock && !w.min).length, vp);
        return [...ws.map(undock), { id: rid(), spec, x: r.x, y: r.y, w: r.w, h: r.h, z, min: false, pinned: false, dock }];
      });
    });
  }, []);
  const openCanvasRef = useRef(openCanvas); openCanvasRef.current = openCanvas;
  // while something runs in the background, keep the Chats dots current
  useEffect(() => { if (!serverRunning.length) return; const t = setInterval(refreshConvs, 4000); return () => clearInterval(t); }, [serverRunning.length, refreshConvs]);
  const runningIds = useMemo(() => [...new Set([...serverRunning, ...Object.keys(running)])], [serverRunning, running]);
  const openFile = useCallback((p: string) => {
    if (isExternal(p)) { window.open(p, "_blank"); return; }
    const clean = p.replace(/^\/?files\//, "").replace(/^\.\//, "");
    const chat = clean.match(/^chats\/([\w-]+)(?:\/(?:chat\.json)?)?$/);
    if (chat) { openCanvas({ kind: "chat", id: chat[1], title: convsRef.current.find((c) => c.id === chat[1])?.title || "Chat" }); return; }
    openCanvas({ kind: "file", path: clean, title: clean.split("/").pop() || clean });
  }, [openCanvas]);

  const toggleContext = useCallback(async (p: string) => {
    const c = convRef.current;
    if (!c) { mainRef.current?.insert("@" + p + " "); return; }
    const next = c.context.includes(p) ? c.context.filter((x) => x !== p) : [...c.context, p];
    setConv({ ...c, context: next });
    await fetch(`/api/conversations/${c.id}`, { method: "PATCH", body: JSON.stringify({ context: next }) });
  }, []);

  const api: AppApi = useMemo(() => ({
    openFile, openCanvas, refreshTree, tree, context: conv?.context || [], toggleContext,
    sendUiEvent: (d: unknown, o?: { label?: string; prompt?: string }) => {
      const attr = o?.label ? ` label="${o.label.replace(/"/g, "&quot;")}"` : "";
      sendMain({ content: `<ui_event${attr}>\n${o?.prompt ? `<instruction>${o.prompt}</instruction>\n` : ""}${toXml(d)}\n</ui_event>`, attachments: [], quote: null });
    },
    sendText: (t: string) => sendMain({ content: t, attachments: [], quote: null }),
    decide: async (messageId: string, partId: string, decision: "approve" | "deny", cmd: string, password?: string) => {
      const cid = convRef.current?.id; if (!cid) return "No conversation";
      const r = await fetch(`/api/conversations/${cid}/approve`, { method: "POST", body: JSON.stringify({ messageId, partId, decision, password }) });
      if (!r.ok) return ((await r.json().catch(() => ({}))) as { error?: string }).error || "Failed";
      setMsgs((ms) => ms.map((m) => (m.id !== messageId ? m : { ...m, parts: m.parts.map((p) => (p.type === "tool" && p.id === partId ? { ...p, meta: { ...(p.meta as object), approval: { ...((p.meta as { approval?: object }).approval || {}), decision } } } : p)) })));
      sendMain({ content: decision === "approve" ? `Approved: \`${cmd.length > 200 ? cmd.slice(0, 200) + "…" : cmd}\`. Run it.` : "Denied. Do not run it. Suggest a safer way if there is one.", attachments: [], quote: null });
      return null;
    },
    mention: (p: string) => mainRef.current?.insert("@" + p + " "),
    addFiles: (fs: File[]) => mainRef.current?.addFiles(fs),
    quote: (t: string) => setQuotes((q) => ({ ...q, [active.current]: t })),
    convId: conv?.id || null,
    convTitles,
    openChat: (id: string) => { loadConv(id); },
  }), [openFile, openCanvas, refreshTree, tree, conv?.context, conv?.id, convTitles, loadConv, toggleContext, sendMain, setMsgs]);

  // ---- quote on selection
  useEffect(() => {
    const up = () => setTimeout(() => {
      const s = window.getSelection(); const t = s?.toString().trim();
      if (!s || !t || !s.rangeCount) { setQpop(null); return; }
      const node = s.anchorNode?.parentElement;
      // quote works on chat text and rendered docs alike; PDF selections have their own popover
      // (quote-with-page-and-context, highlight, copy) inside the viewer
      if (!node?.closest(".ai-content, .docview, .reader") || node.closest(".txtlayer")) { setQpop(null); return; }
      if (node.closest(".thread")) active.current = "thread"; else active.current = "main";
      const r = s.getRangeAt(0).getBoundingClientRect();
      setQpop({ x: r.left + r.width / 2, y: r.top - 8, text: t });
    }, 0);
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // ---- drag & drop: over the chat = save to uploads, over the input bar = attach
  const [fileDrag, setFileDrag] = useState(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes("Files");
    const enter = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setFileDrag((n) => n + 1); } };
    // entering a child element fires dragleave on its parent, so nesting is counted — but leaving the window
    // (relatedTarget is null) ends the drag outright, otherwise the count can never come back down.
    const leave = (e: DragEvent) => { if (hasFiles(e)) setFileDrag((n) => (e.relatedTarget ? Math.max(0, n - 1) : 0)); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      setFileDrag(0); // a drop ends the drag wherever it lands, the input bar included
      if ((e.target as HTMLElement).closest(".composer")) return; // the input bar attaches to the message
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
      const dir = convRef.current ? chatDir(convRef.current.id) + "/uploads" : "uploads";
      void upload(files, dir).then(() => refreshTree());
    };
    const end = () => setFileDrag(0);
    addEventListener("dragenter", enter); addEventListener("dragleave", leave); addEventListener("dragover", over); addEventListener("drop", drop); addEventListener("dragend", end); addEventListener("blur", end);
    return () => { removeEventListener("dragenter", enter); removeEventListener("dragleave", leave); removeEventListener("dragover", over); removeEventListener("drop", drop); removeEventListener("dragend", end); removeEventListener("blur", end); };
  }, [refreshTree]);

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
      else if (e.key === "Escape" && !(e.target as HTMLElement).closest("input,textarea")) { if (thread) setThread(null); else if (settings) setSettings(false); else setPanels({ chats: false, ws: false, art: false, src: false }); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [newChat, thread, settings]);

  const sources = useMemo(() => {
    const seen = new Set<string>(); const out: { url: string; title: string; snippet?: string }[] = [];
    for (const m of [...mainPath, ...threadPath]) for (const p of m.parts) if (p.type === "tool" && p.meta && (p.meta as { sources?: unknown[] }).sources)
      for (const s of (p.meta as { sources: { url: string; title: string; snippet?: string }[] }).sources) if (!seen.has(s.url)) { seen.add(s.url); out.push(s); }
    return out;
  }, [mainPath, threadPath]);

  const chipNew = useCallback((mode: "chat" | "general", text: string) => {
    const id = "new:" + rid();
    try { localStorage.setItem("draft:" + id, JSON.stringify({ text, chips: [] })); } catch { /* ignore quota */ }
    setMode(mode); setView(id); setConv(null); setThread(null); setEditing(null);
    setTimeout(() => mainRef.current?.focus(), 0);
  }, [setMode, setView]);
  const linkProject = useCallback(async (name?: string) => {
    const clean = (name || "").trim();
    if (!clean) { mainRef.current?.insert("/project "); return; }
    const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean }) });
    const j = await r.json().catch(() => ({}));
    if (!j.id) return;
    const c = convRef.current;
    if (!c) { pendingProject.current = j.id; setMode("chat"); setView("new:" + rid()); setConv(null); setThread(null); setEditing(null); return; }
    await fetch(`/api/conversations/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: j.id }) });
    setConv({ ...c, state: { ...(c.state || {}), project: j.id } });
  }, [setMode, setView]);
  const runBrief = useCallback(() => {
    localStorage.setItem("briefDay", new Date().toISOString().slice(0, 10));
    setOfferBrief(false);
    chipNew("general", "Morning brief. Search what matters today: the date, a few cited headlines, and anything in system/brief.md if it exists. Short. No filler.\n\n");
  }, [chipNew]);
  const commands: Command[] = useMemo(() => [
    { name: "new", hint: "New chat", run: newChat },
    { name: "research", hint: "Deep research in a new chat", run: (arg?: string) => chipNew("chat", "Research this. Search, open the pages, cite only those, and put the report in a canvas.\n\n" + (arg || "")) },
    { name: "background", hint: "Keep working if I switch chats", run: (arg?: string) => chipNew("chat", "Do this to completion even if I switch chats. Write the result in this chat's artifacts folder and end with where it is.\n\n" + (arg || "")) },
    { name: "brief", hint: "Morning brief", run: (arg?: string) => { localStorage.setItem("briefDay", new Date().toISOString().slice(0, 10)); setOfferBrief(false); chipNew("general", "Morning brief. Search what matters today: the date, a few cited headlines, and anything in system/brief.md if it exists. Short. No filler.\n\n" + (arg || "")); } },
    { name: "google", hint: "Use connected Google Workspace tools", run: (arg?: string) => mainRef.current?.insert("Use the Google Workspace MCP tools if they are connected. If none are, say which server to add in Settings and stop.\n\n" + (arg || "")) },
    { name: "project", hint: "Link a project: /project name", run: (arg?: string) => { void linkProject(arg); } },
    { name: "compact", hint: "Summarise history", run: async () => { const c = convRef.current, last = mainPath[mainPath.length - 1]; if (!c || !last) return; await fetch(`/api/conversations/${c.id}/compact`, { method: "POST", body: JSON.stringify({ leafId: last.id, scope: "history", keepLast: 4 }) }); loadConv(c.id, last.id); setCtxRev((r) => r + 1); } },
    { name: "fold", hint: "Fold old tool output", run: async () => { const c = convRef.current, last = mainPath[mainPath.length - 1]; if (!c || !last) return; await fetch(`/api/conversations/${c.id}/compact`, { method: "POST", body: JSON.stringify({ leafId: last.id, scope: "tools", keepLast: 2 }) }); loadConv(c.id, last.id); setCtxRev((r) => r + 1); } },
    { name: "chats", hint: "Chats", run: () => setPanels((p) => ({ ...p, chats: true })) },
    { name: "workspace", hint: "Files", run: () => setPanels((p) => ({ ...p, ws: true })) },
    { name: "artifacts", hint: "Artifacts", run: () => setPanels((p) => ({ ...p, art: true })) },
    { name: "sources", hint: "Sources", run: () => setPanels((p) => ({ ...p, src: true })) },
    { name: "context", hint: "Clear active context", run: async () => { const c = convRef.current; if (!c) return; setConv({ ...c, context: [] }); await fetch(`/api/conversations/${c.id}`, { method: "PATCH", body: JSON.stringify({ context: [] }) }); } },
    { name: "export", hint: "Download chat", run: () => { if (convRef.current) location.href = `/api/conversations/${convRef.current.id}/export`; } },
    { name: "theme", hint: "Toggle theme", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { name: "settings", hint: "Model, tools, MCP, skills", run: () => setSettings(true) },
  ], [newChat, linkProject, chipNew, mainPath, loadConv, setTheme, theme]);

  const renderTurn = (m: Msg, isThread: boolean, last = false) => {
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
      threadCount={isThread ? 0 : msgs.filter((x) => x.threadOf === m.id).length} last={last} />;
  };

  const anchor = thread ? msgs.find((m) => m.id === thread) : null;
  const rightCount = [!!thread, panels.ws, panels.art, panels.src, settings].filter(Boolean).length;
  const tog = (k: keyof typeof panels) => setPanels((p) => ({ ...p, [k]: !p[k] }));
  const hasOpenPanel = panels.chats || panels.ws || panels.art || panels.src || settings || !!thread;
  const chromeIdle = idle && !hasOpenPanel;
  const docked = wins.some((w) => w.dock);
  const leaf = (thread ? threadPath : mainPath).filter((m) => !m.id.startsWith("tmp")).slice(-1)[0];
  const ctxRef: CtxRef | null = useMemo(() => (conv ? { convId: conv.id, leafId: leaf?.id || null, thread, rev: ctxRev + (streamId ? 0 : 1000), reload: () => { const c = convRef.current; if (c) loadConv(c.id, leaf?.id); } } : null), [conv, leaf?.id, thread, ctxRev, streamId, loadConv]);

  return (
    <AppCtx.Provider value={api}>
      <div className={"shell" + (mainPath.length === 0 && !thread ? " home" : "") + (docked ? " has-dock" : "") + (panels.chats ? " has-l" : "") + (rightCount > 0 ? " has-r" : "")}
        style={{ ["--dockw" as string]: docked ? dockW + "px" : "0px", ["--lw" as string]: pw.l + "px", ["--rw" as string]: (settings ? Math.max(pw.r, 400) : pw.r) + "px" }}>
        <div className={"chrome l" + (chromeIdle ? " is-idle" : "")}>
          <button className={"ib" + (panels.chats ? " on" : "")} aria-label="Chats" onClick={() => tog("chats")}><PanelLeft /></button>
          <button className={"ib" + (surface === "general" && !conv ? " on" : "")} aria-label="New chat" title="New chat · opens General mode" onClick={newChat}><SquarePen /></button>
          {(surface === "general" || conv?.mode === "general") && <button className="ib" aria-label="Open in chat" onClick={promote} title="Open in chat"><MessageSquareShare /></button>}
        </div>
        <div className={"chrome r" + (chromeIdle ? " is-idle" : "")}>
          <button className={"ib" + (panels.ws ? " on" : "")} aria-label="Workspace" onClick={() => tog("ws")}><Folder /></button>
          <button className={"ib" + (panels.art ? " on" : "")} aria-label="Artifacts" onClick={() => tog("art")}><AppWindow /></button>
          {sources.length > 0 && <button className={"ib" + (panels.src ? " on" : "")} aria-label="Sources" onClick={() => tog("src")}><Link2 /></button>}
          <button className="ib" aria-label="Settings" onClick={() => setSettings(true)}><Settings2 /></button>
        </div>

        <div className="scroll" ref={scroller}>
          <main className="column">{mainPath.map((m, i) => renderTurn(m, false, i === mainPath.length - 1))}</main>
        </div>

        <div className="dock">
          <div className="dock-stack">
          <DockStatus conv={conv} offerBrief={offerBrief} streamId={streamId} onBrief={runBrief} onUnlink={async () => { const c = convRef.current; if (!c) return; await fetch(`/api/conversations/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: null }) }); setConv({ ...c, state: { ...(c.state || {}), project: undefined } }); }} />
          <Composer ref={mainRef} capture draftKey={view} onSend={sendMain} streaming={!!streamId && !threadPath.some((m) => m.id === streamId)} onStop={stop}
            quote={quotes.main} onClearQuote={() => setQuotes((q) => ({ ...q, main: null }))} commands={commands} onFocus={() => (active.current = "main")} />
          </div>
        </div>

        {panels.chats && <div className="lstack"><div className="rsz" onPointerDown={resize("l")} aria-hidden /><ChatsPanel convs={convs} current={conv?.id || null} running={runningIds}
          onOpen={(id, leaf, msg) => { loadConv(id, leaf, msg); }} onClose={() => setPanels((p) => ({ ...p, chats: false }))}
          onDelete={async (id) => { await fetch(`/api/conversations/${id}`, { method: "DELETE" }); if (conv?.id === id) newChat(); refreshConvs(); }} /></div>}

        {rightCount > 0 && <div className={"rstack" + (rightCount > 1 ? " multi" : "")}><div className="rsz" onPointerDown={resize("r")} aria-hidden />
          {settings && <Settings onClose={() => setSettings(false)} theme={theme} setTheme={setTheme} />}
            {thread && anchor && <div className="panel thread">
            <div className="panel-head"><span>Thread</span><span className="sp" /><button className="ib sm" aria-label="Close thread" onClick={() => setThread(null)}><X /></button></div>
            <div className="anchor">{anchor.content.replace(/<[^>]+>/g, "").slice(0, 300)}</div>
            <div className="panel-body">{threadPath.map((m, i) => renderTurn(m, true, i === threadPath.length - 1))}</div>
            <Composer inline draftKey={view + ":t:" + thread} onSend={sendThread} streaming={!!streamId && threadPath.some((m) => m.id === streamId)} onStop={stop}
              quote={quotes.thread} onClearQuote={() => setQuotes((q) => ({ ...q, thread: null }))} onFocus={() => (active.current = "thread")} autoFocus />
          </div>}
          {panels.ws && <WorkspacePanel onClose={() => tog("ws")} ctx={ctxRef} />}
          {panels.art && <ArtifactsPanel onClose={() => tog("art")} recent={recent} />}
          {panels.src && <SourcesPanel sources={sources} onClose={() => tog("src")} />}
        </div>}

        {fileDrag > 0 && <div className="dropveil" aria-hidden>
          <div className="dz">Drop to save into <b>{conv ? "this chat's uploads" : "workspace uploads"}</b></div>
          <div className="dz sub">…or onto the input bar to attach</div>
        </div>}
        <CanvasLayer wins={wins} setWins={setWins} dockW={dockW} setDockW={setDockW} />
        {qpop && <button className="qpop" style={{ left: qpop.x, top: qpop.y }} onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setQuotes((q) => ({ ...q, [active.current]: qpop.text })); setQpop(null); window.getSelection()?.removeAllRanges(); }}>Quote</button>}
      </div>
    </AppCtx.Provider>
  );
}
