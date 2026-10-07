"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, ArrowUp, Square, X, FileText, Inbox, Zap, Navigation, ArrowDownToLine, Workflow } from "lucide-react";
import { Attachment, ProcInfo, QueueItem, fileUrl, useApp } from "./ctx";
import { chatDir } from "@/lib/shared";
import { Palette, PaletteHandle, PaletteMode, PaletteApi } from "./palette";
import { DEFAULT_MODE, ModeId, modeOf } from "@/lib/modes";

export type SendPayload = { content: string; attachments: Attachment[]; quote: string | null };
export type ComposerHandle = { insert: (t: string) => void; focus: () => void; addFiles: (f: FileList | File[]) => void; modes: () => void; workflows: () => void; clear: () => void };
export type Command = { name: string; hint: string; panel?: Exclude<PaletteMode, "commands">; seed?: string; run?: (arg?: string) => void };

type Chip = Attachment & { loading?: boolean; key: string; preview?: string };

type Props = {
  onSend: (p: SendPayload) => void; streaming?: boolean; onStop?: () => void;
  quote?: string | null; onClearQuote?: () => void; inline?: boolean; capture?: boolean;
  commands?: Command[]; initial?: SendPayload; onCancel?: () => void; onFocus?: () => void; autoFocus?: boolean;
  /** per-chat draft: text + attachments survive chat switches and reloads (localStorage "draft:<key>") */
  draftKey?: string;
  /** queued messages (main composer): Enter queues while the AI responds; the queue sends when it ends */
  queue?: QueueItem[];
  onEnqueue?: (p: SendPayload) => void;
  onSteer?: (p: SendPayload) => void;
  onSteerQueued?: (id: string) => void;
  onDequeue?: (id: string) => void;
  onUpdateQueued?: (id: string, p: SendPayload) => void;
  /** agent-started background processes, shown for review above the input */
  procs?: ProcInfo[];
  onOpenProc?: (name: string) => void;
  /** omnibox data (chats, workspace, sources, settings, processes) — omit for plain composers */
  palette?: Omit<PaletteApi, "mention" | "attachPath">;
  /** the chat's mode: shown as a chip, switched from the /mode picker */
  mode?: ModeId; onMode?: (id: ModeId) => void;
  /** a workflow chip turns the next message into that workflow's input instead of a chat message */
  onRunWorkflow?: (id: string, question: string) => void;
};
type Draft = { text: string; chips: Attachment[] };
const readDraft = (k: string): Draft | null => { try { return JSON.parse(localStorage.getItem("draft:" + k) || "null"); } catch { return null; } };

export async function upload(files: File[], dir?: string): Promise<Attachment[]> {
  const fd = new FormData();
  if (dir) fd.append("dir", dir);
  files.forEach((f) => fd.append("files", f));
  const r = await fetch("/api/workspace/upload", { method: "POST", body: fd });
  return r.json();
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const mimeGuess = (name: string) =>
  IMG_EXT.test(name) ? `image/${name.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`
  : /\.pdf$/i.test(name) ? "application/pdf"
  : /\.(mp4|webm|mov|mkv|m4v)$/i.test(name) ? "video/mp4"
  : /\.(mp3|wav|ogg|m4a|flac|opus)$/i.test(name) ? "audio/mpeg"
  : "application/octet-stream";

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(p, ref) {
  const app = useApp();
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const palRef = useRef<PaletteHandle>(null);
  const [text, setText] = useState(p.initial?.content || "");
  const [chips, setChips] = useState<Chip[]>(() => (p.initial?.attachments || []).map((a) => ({ ...a, key: a.path })));
  const [focused, setFocused] = useState(false);
  const [drag, setDrag] = useState(false);
  const [caret, setCaret] = useState(0);
  // omnibox: null = plain input; "commands"/"files" open automatically, panel modes are explicit
  const [mode, setMode] = useState<PaletteMode | null>(null);
  const [editingQ, setEditingQ] = useState<string | null>(null);
  /** workflow chip: the message being written is that workflow's input, not a chat message */
  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [showProcs, setShowProcs] = useState(false);

  // drafts: save on every change (cheap), load when the chat changes
  const keyRef = useRef(p.draftKey);
  useEffect(() => {
    if (!p.draftKey) return;
    keyRef.current = p.draftKey;
    const d = readDraft(p.draftKey);
    setText(d?.text || ""); setChips((d?.chips || []).map((a) => ({ ...a, key: a.path }))); setMode(null); setEditingQ(null); setFlow(null);
  }, [p.draftKey]);
  useEffect(() => {
    const k = keyRef.current; if (!k) return;
    const done = chips.filter((c) => !c.loading).map(({ path, name, mime, size }) => ({ path, name, mime, size }));
    if (!text && !done.length) localStorage.removeItem("draft:" + k);
    else localStorage.setItem("draft:" + k, JSON.stringify({ text, chips: done }));
  }, [text, chips]);

  const autosize = useCallback(() => {
    const t = ta.current; if (!t) return;
    const max = Math.max(32, window.innerHeight * 0.4);
    const current = Number.parseFloat(t.style.height) || 0;
    t.style.height = "auto";
    const contentHeight = t.scrollHeight;
    const next = Math.max(32, Math.min(contentHeight, max));
    // Only the final measured height can paint; equal single-line keystrokes keep the same box.
    if (Math.abs(current - next) > 0.5 || !current) t.style.height = `${next}px`;
    else t.style.height = `${current}px`;
    t.style.overflowY = contentHeight > max ? "auto" : "hidden";
  }, []);
  useLayoutEffect(autosize, [text, autosize]);
  useEffect(() => {
    const row = ta.current?.parentElement;
    if (!row) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      // Width expansion is intentional; measure after its spring settles, not on every frame.
      timer = setTimeout(autosize, 120);
    });
    observer.observe(row);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [autosize]);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const files = [...list]; if (!files.length) return;
    const temp: Chip[] = files.map((f) => ({ key: Math.random().toString(36), path: "", name: f.name, mime: f.type, size: f.size, loading: true, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined }));
    setChips((c) => [...c, ...temp]);
    try {
      const res = await upload(files, app.convId ? chatDir(app.convId) + "/uploads" : undefined); // a chat's attachments live in its folder
      setChips((c) => c.map((x) => { const i = temp.findIndex((t) => t.key === x.key); return i < 0 ? x : { ...x, ...res[i], loading: false }; }));
      app.refreshTree();
    } catch { setChips((c) => c.filter((x) => !temp.some((t) => t.key === x.key))); }
  }, [app]);

  /** a workspace file becomes a chip without re-uploading it */
  const addPathChip = useCallback((path: string) => {
    const name = path.split("/").pop() || path;
    setChips((c) => c.some((x) => x.path === path) ? c : [...c, { key: Math.random().toString(36), path, name, mime: mimeGuess(name), size: 0 }]);
  }, []);

  useImperativeHandle(ref, () => ({
    insert: (t: string) => { setText((v) => (v && !v.endsWith(" ") ? v + " " : v) + t); setTimeout(() => ta.current?.focus(), 0); },
    focus: () => ta.current?.focus(),
    addFiles,
    modes: () => openPanelRef.current?.("modes"),
    workflows: () => openPanelRef.current?.("workflows"),
    // a command that consumed the text (a workflow question) takes it out of the box itself
    clear: () => { setText(""); setChips([]); setCaret(0); },
  }), [addFiles]);

  // type-anywhere capture
  useEffect(() => {
    if (!p.capture) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && p.commands && !document.querySelector(".scrim, .panel.settings")) {
        // the omnibox: every surface one keystroke away
        e.preventDefault(); ta.current?.focus(); setMode((m) => (m ? null : "commands")); return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], iframe")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 && !document.querySelector(".scrim, .panel.settings")) ta.current?.focus();
    };
    // Ctrl/Cmd+V anywhere pastes into the message box, exactly like typing does
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.("input, textarea, select, [contenteditable=true], iframe") || document.querySelector(".scrim, .panel.settings") || !e.clipboardData) return;
      const files = [...e.clipboardData.files];
      const txt = e.clipboardData.getData("text/plain");
      if (!files.length && !txt) return;
      e.preventDefault();
      if (files.length) addFiles(files);
      if (txt) {
        const el = ta.current; const at = el ? el.selectionStart ?? el.value.length : 0;
        setText((v) => { const i = el && document.activeElement === el ? at : v.length; return v.slice(0, i) + txt + v.slice(i); });
        requestAnimationFrame(() => { const el2 = ta.current; if (!el2) return; el2.focus(); const c = el2.value.length; el2.setSelectionRange(c, c); });
      } else ta.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("paste", onPaste); };
  }, [p.capture, addFiles]);

  useEffect(() => { if (p.autoFocus) ta.current?.focus(); }, [p.autoFocus]);
  useEffect(() => { if (p.quote) ta.current?.focus(); }, [p.quote]);

  // ---- omnibox triggers -------------------------------------------------
  // "/" at the start opens the command list; "@" opens file search; panel modes keep their own text.
  const slash = text.match(/^\/([\w-]*)(?:\s([\s\S]*))?$/);
  const atTok = text.match(/(?:^|\s)@([\w./~-]*)$/);

  useEffect(() => {
    if (mode === null) {
      if (slash && !text.includes("\n")) setMode("commands");
      else if (atTok) setMode("files");
    } else if (mode === "commands" && !slash) setMode(null); // trigger edited away: back to plain input
    else if (mode === "files" && !atTok) setMode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const collapsePalette = useCallback((clear = false) => {
    setMode(null); setEditingQ(null);
    if (clear) { setText(""); setCaret(0); }
    setTimeout(() => ta.current?.focus(), 0);
  }, []);

  const openPanelRef = useRef<((m: PaletteMode, seed?: string) => void) | null>(null);
  const openPanel = useCallback((m: PaletteMode, seed?: string) => {
    setText(seed || ""); setCaret((seed || "").length);
    setMode(m); palRef.current?.reset();
    setTimeout(() => ta.current?.focus(), 0);
  }, []);
  openPanelRef.current = openPanel;

  // ---- send / queue / steer --------------------------------------------
  const ready = chips.every((c) => !c.loading);
  const hasContent = !!(text.trim() || chips.length);
  const payload = (): SendPayload | null => {
    if (!hasContent || !ready) return null;
    return { content: text.trim(), attachments: chips.map(({ path, name, mime, size }) => ({ path, name, mime, size })), quote: p.quote || null };
  };
  const clearInput = () => { setText(""); setChips([]); setCaret(0); p.onClearQuote?.(); };

  const send = () => {
    const pay = payload(); if (!pay) return;
    // A workflow chip changes what Enter means: the text becomes the run's input and the chat stays
    // free, because the run lives in its own window and only posts its result.
    if (flow && pay.content) { clearInput(); setFlow(null); p.onRunWorkflow?.(flow.id, pay.content); return; }
    clearInput(); p.onSend(pay);
  };
  const queueIt = () => {
    const pay = payload(); if (!pay) return;
    clearInput();
    if (p.onEnqueue) p.onEnqueue(pay); else p.onSend(pay);
  };
  const steerNow = () => {
    const pay = payload(); if (!pay) return;
    clearInput();
    if (p.onSteer) p.onSteer(pay); else p.onSend(pay);
  };
  /** pull a queued item back into the editor (order is kept when it is committed again) */
  const editQueued = (it: QueueItem) => {
    if (!p.onDequeue) return;
    p.onDequeue(it.id); setEditingQ(it.id); setText(it.content); setMode(null);
    requestAnimationFrame(() => { ta.current?.focus(); const c = it.content.length; ta.current?.setSelectionRange(c, c); setCaret(c); });
  };
  const commitQueuedEdit = () => {
    const id = editingQ; if (!id) return;
    const pay = payload();
    setEditingQ(null);
    if (pay) { clearInput(); p.onUpdateQueued?.(id, pay); }
    else if (!text.trim() && !chips.length) setEditingQ(null); // emptied: drop it
  };

  const canSend = hasContent && ready && !p.streaming;
  const canQueue = hasContent && ready && !!p.streaming;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // omnibox navigation first: the palette owns the arrow keys while it is open
    if (mode) {
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Tab", "Enter", "Escape"].includes(e.key) && !(e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
        if (palRef.current?.key(e)) { e.preventDefault(); return; } // Esc while entering a value cancels the entry instead of closing
      }
      if (e.key === "Escape") { e.preventDefault(); collapsePalette(!["commands", "files"].includes(mode)); return; }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (palRef.current?.entering()) { e.preventDefault(); return; } // a settings value owns the bar right now
        if (hasContent) { e.preventDefault(); steerNow(); return; }
      }
      return; // typing filters; other keys behave as usual
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (flow && text.trim() && ready) { send(); return; } // a run is independent of the chat's stream
      if ((e.metaKey || e.ctrlKey) && hasContent && (p.onSteer || !p.streaming)) { steerNow(); return; } // ⌘/Ctrl+⏎: steer now (sends if idle)
      if (p.streaming) {
        if (editingQ) { commitQueuedEdit(); return; }
        if (!hasContent && p.queue?.length && p.onSteerQueued) { p.onSteerQueued(p.queue[p.queue.length - 1].id); return; } // ⏎ again: steer it now
        if (canQueue) { queueIt(); return; }
        if (!p.onEnqueue) return; // plain composers (threads) stay read-only while streaming
        return;
      }
      if (canSend) send();
      return;
    }
    if (e.key === "ArrowUp" && !text && !chips.length && p.streaming && p.queue?.length && p.onDequeue) { e.preventDefault(); editQueued(p.queue[p.queue.length - 1]); return; }
    if (e.key === "Escape") {
      if (editingQ) { setEditingQ(null); setText(""); return; }
      // Esc stops a running answer (the partial stays); an empty composer is the safe place for it
      if (p.streaming && !text && !chips.length && p.onStop) { e.preventDefault(); p.onStop(); return; }
      if (p.onCancel) p.onCancel(); else ta.current?.blur(); return;
    }
    if (e.key === "Backspace" && !text && !chips.length) {
      if (p.quote) { p.onClearQuote?.(); return; }
      e.preventDefault(); if (p.onCancel) p.onCancel(); else ta.current?.blur();
    }
  };

  const open = p.inline || focused || !!text || chips.length > 0 || !!p.quote || !!mode;
  const palQuery = mode === "commands" ? (slash?.[1] || "") : mode === "files" ? (atTok?.[1] || "") : text;
  const palArg = slash?.[2] || "";
  const paletteApi: PaletteApi | null = p.palette ? {
    ...p.palette,
    mention: (path: string) => {
      // replace the "@token" that opened the palette, like the old inline menu did
      const el = ta.current; const at = el ? (el.selectionStart ?? el.value.length) : text.length;
      const before = text.slice(0, at); const m = before.match(/(?:^|\s)@([\w./~-]*)$/);
      const start = m ? before.lastIndexOf("@") : at;
      const nt = text.slice(0, start) + "@" + path + " " + text.slice(at);
      setText(nt); collapsePalette();
      setTimeout(() => { const c = start + path.length + 2; ta.current?.setSelectionRange(c, c); ta.current?.focus(); setCaret(c); }, 0);
    },
    attachPath: (path: string) => { addPathChip(path); collapsePalette(); },
    setWorkflow: (id: string, name: string) => { setFlow({ id, name }); collapsePalette(); },
  } : null;

  return (
    <div className={`composer${open ? " open" : ""}${p.inline ? " inline" : ""}${drag ? " drag" : ""}${mode && paletteApi ? " pal-open" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
      {mode && paletteApi && <Palette ref={palRef} mode={mode} query={palQuery} arg={palArg} api={paletteApi} collapse={(clear) => collapsePalette(!!clear)} onPanel={openPanel} setInput={(t) => { setText(t); setCaret(t.length); }} />}
      {!!p.queue?.length && <div className="qstrip">
        <div className="qstrip-head"><Inbox size={12} /><span>{p.queue.length} queued</span></div>
        {p.queue.map((it, i) => (
          <div key={it.id} className={"qitem" + (editingQ === it.id ? " editing" : "")}>
            <span className="q-n">{i + 1}</span>
            <button className="q-body" onMouseDown={(e) => e.preventDefault()} onClick={() => editQueued(it)}>
              <span className="q-text">{it.content || it.attachments.map((a) => a.name).join(", ")}</span>
            </button>
            <button className="ib sm" aria-label="Steer now" onClick={() => { if (editingQ === it.id) { setEditingQ(null); setText(""); } p.onSteerQueued?.(it.id); }}><Zap /></button>
            <button className="ib sm" aria-label="Remove from queue" onClick={() => { if (editingQ === it.id) { setEditingQ(null); setText(""); } p.onDequeue?.(it.id); }}><X /></button>
          </div>
        ))}
      </div>}
      {!!p.procs?.length && <div className="pbar-wrap">
        {showProcs && <div className="pop-scrim" onClick={() => setShowProcs(false)} />}
        <button className={"pbar" + (showProcs ? " open" : "")} aria-label={`${p.procs.filter((x) => x.running).length} background ${p.procs.filter((x) => x.running).length === 1 ? "process" : "processes"}`}
          onClick={() => setShowProcs((v) => !v)}>
          {p.procs.map((pr) => <i key={pr.name} className={pr.running ? "on" : ""} />)}
        </button>
        {showProcs && <div className="pbar-pop" role="menu" aria-label="Background processes">
          {p.procs.map((pr) => (
            <button key={pr.name} role="menuitem" className="pbar-row" onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setShowProcs(false); p.onOpenProc?.(pr.name); }}>
              <i className={pr.running ? "on" : ""} />
              <span className="n">{pr.name}</span>
              <span className="s">{pr.running ? `running${pr.ports.length ? ` · :${pr.ports[0]}` : ""}` : `exited ${pr.exit}`}</span>
            </button>
          ))}
        </div>}
      </div>}
      {p.quote && <div className="cquote"><p>{p.quote}</p><button className="ib sm" aria-label="Remove quote" onClick={p.onClearQuote}><X /></button></div>}
      {chips.length > 0 && <div className="chips">{chips.map((c) => {
        const isImg = c.mime.startsWith("image/");
        return <div key={c.key} className={`chip${isImg ? " img" : ""}${c.loading ? " loading" : ""}`} title={c.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {isImg ? <img src={c.preview || fileUrl(c.path)} alt={c.name} /> : <><FileText size={14} /><span>{c.name}</span></>}
          <button className="x" aria-label="Remove" onClick={() => setChips((x) => x.filter((y) => y.key !== c.key))}><X /></button>
        </div>; })}</div>}
      <div className="row">
        {p.mode && p.mode !== DEFAULT_MODE && (
          <button className="cmode" aria-label={`Mode: ${modeOf(p.mode).label}`} title={`${modeOf(p.mode).hint} — click to leave this mode`}
            onClick={() => p.onMode?.(DEFAULT_MODE)}><span>{modeOf(p.mode).label}</span><X size={11} /></button>
        )}
        {flow && (
          <button className="cwork" aria-label={`Workflow: ${flow.name}`} title={`${flow.name}: this message is the run's input — click to send it as a normal message instead`}
            onClick={() => setFlow(null)}><Workflow size={12} /><span>{flow.name}</span><X size={11} /></button>
        )}
        <button className="ib" aria-label="Attach" onClick={() => fileIn.current?.click()}><Plus /></button>
        <input ref={fileIn} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <textarea ref={ta} rows={1} value={text} aria-label="Message"
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown} onFocus={() => { setFocused(true); p.onFocus?.(); }} onBlur={() => setFocused(false)}
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); addFiles(f); } }} />
        <span className={"send-slot" + (p.streaming ? " two" : "")}>
          {p.streaming ? (
            <>
              {canQueue && <button className="send ghost" aria-label="Steer now" onClick={steerNow}><Navigation /></button>}
              {canQueue ? <button className="send" aria-label="Queue message" onClick={queueIt}><ArrowDownToLine /></button>
                : p.queue?.length ? <button className="send" aria-label="Steer queued message" onClick={() => p.onSteerQueued?.(p.queue![p.queue!.length - 1].id)}><Zap /></button>
                : p.onStop ? <button className="send" aria-label="Stop" title="Stop generating (Esc)" onClick={p.onStop}><Square /></button>
                : <span className="send-placeholder" aria-hidden="true" />}
            </>
          ) : canSend ? <button className="send" aria-label="Send" onClick={send}><ArrowUp /></button>
          : <span className="send-placeholder" aria-hidden="true" />}
        </span>
      </div>
    </div>
  );
});
