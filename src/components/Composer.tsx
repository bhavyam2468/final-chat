"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, ArrowUp, ListPlus, Send, Square, X, FileText, Hash, File as FileIcon, MessageSquare } from "lucide-react";
import { Attachment, flatFiles, fileUrl, useApp } from "./ctx";
import { chatDir } from "@/lib/shared";

export type SendPayload = { content: string; attachments: Attachment[]; quote: string | null };
export type ComposerHandle = { insert: (t: string) => void; focus: () => void; addFiles: (f: FileList | File[]) => void };
export type Command = { name: string; hint: string; run: (arg?: string) => void };

type Chip = Attachment & { loading?: boolean; key: string; preview?: string };

type Props = {
  onSend: (p: SendPayload) => void; streaming?: boolean; onStop?: () => void;
  onQueue?: (p: SendPayload) => void; onSteer?: (p: SendPayload) => void;
  queued?: { id: string; preview: string }[]; onRemoveQueued?: (id: string) => void;
  quote?: string | null; onClearQuote?: () => void; inline?: boolean; capture?: boolean;
  commands?: Command[]; initial?: SendPayload; onCancel?: () => void; onFocus?: () => void; autoFocus?: boolean;
  /** per-chat draft: text + attachments survive chat switches and reloads (localStorage "draft:<key>") */
  draftKey?: string;
};
type Draft = { text: string; chips: Chip[] };
const readDraft = (k: string): Draft | null => { try { return JSON.parse(localStorage.getItem("draft:" + k) || "null"); } catch { return null; } };

export async function upload(files: File[], dir?: string): Promise<Attachment[]> {
  const fd = new FormData();
  if (dir) fd.append("dir", dir);
  files.forEach((f) => fd.append("files", f));
  const r = await fetch("/api/workspace/upload", { method: "POST", body: fd });
  return r.json();
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(p, ref) {
  const app = useApp();
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(p.initial?.content || "");
  const [chips, setChips] = useState<Chip[]>(() => (p.initial?.attachments || []).map((a) => ({ ...a, key: a.path })));
  const [focused, setFocused] = useState(false);
  const [drag, setDrag] = useState(false);
  const [menuIdx, setMenuIdx] = useState(0);
  const [caret, setCaret] = useState(0);

  // drafts: save on every change (cheap), load when the chat changes
  const keyRef = useRef(p.draftKey);
  const latestKey = useRef(p.draftKey); latestKey.current = p.draftKey;
  const skipDraftSave = useRef(true);
  const latestDraft = useRef({ key: p.draftKey, text, chips }); latestDraft.current = { key: p.draftKey, text, chips };
  const persistDraft = (k: string | undefined, value: Draft) => {
    if (!k) return;
    const done = value.chips.filter((c) => !c.loading).map(({ path, name, mime, size }) => ({ path, name, mime, size }));
    if (!value.text && !done.length) localStorage.removeItem("draft:" + k);
    else localStorage.setItem("draft:" + k, JSON.stringify({ text: value.text, chips: done }));
  };
  useEffect(() => {
    keyRef.current = p.draftKey; skipDraftSave.current = true;
    const d = p.draftKey ? readDraft(p.draftKey) : null;
    setText(d?.text || (p.draftKey ? "" : p.initial?.content || ""));
    setChips((d?.chips || (p.draftKey ? [] : p.initial?.attachments || [])).map((a) => ({ ...a, key: a.path })));
  }, [p.draftKey, p.initial?.content, p.initial?.attachments]);
  useEffect(() => {
    if (skipDraftSave.current) { skipDraftSave.current = false; return; }
    const k = p.draftKey; if (!k) return;
    const value = { text, chips };
    const save = () => persistDraft(k, value);
    const timer = setTimeout(save, 220);
    return () => { clearTimeout(timer); if (latestKey.current !== k) save(); };
  }, [text, chips, p.draftKey]);
  useEffect(() => () => persistDraft(latestDraft.current.key, { text: latestDraft.current.text, chips: latestDraft.current.chips }), []);

  const autosize = useCallback(() => { const t = ta.current; if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + "px"; }, []);
  useLayoutEffect(autosize, [text, autosize]);

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

  useImperativeHandle(ref, () => ({
    insert: (t: string) => { setText((v) => (v && !v.endsWith(" ") ? v + " " : v) + t); setTimeout(() => ta.current?.focus(), 0); },
    focus: () => ta.current?.focus(),
    addFiles,
  }), [addFiles]);

  // type-anywhere capture
  useEffect(() => {
    if (!p.capture) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], iframe")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 && !document.querySelector(".scrim")) ta.current?.focus();
    };
    // Ctrl/Cmd+V anywhere pastes into the message box, exactly like typing does
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.("input, textarea, select, [contenteditable=true], iframe") || document.querySelector(".scrim") || !e.clipboardData) return;
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

  // Keep the potentially large workspace walk out of the keypress/render hot path for @mentions.
  const workspaceFiles = useMemo(() => flatFiles(app.tree), [app.tree]);
  // menus
  const before = text.slice(0, caret);
  const mentionQ = before.match(/(?:^|\s)@([\w./~-]*)$/)?.[1];
  const slash = text.match(/^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i);
  const cmdQ = slash && !text.includes("\n") ? slash[1] : undefined;
  const cmdArg = slash?.[2]?.trim();
  const items = useMemo(() => {
    if (cmdQ !== undefined && p.commands) return p.commands.filter((c) => c.name.startsWith(cmdQ.toLowerCase())).map((c) => ({ key: c.name, label: "/" + c.name, hint: c.hint, run: () => { setText(""); c.run(cmdArg); }, icon: Hash }));
    if (mentionQ !== undefined) {
      const q = mentionQ.toLowerCase();
      const insertMention = (path: string) => {
        const start = before.lastIndexOf("@"); const nt = text.slice(0, start) + "@" + path + " " + text.slice(caret); setText(nt);
        setTimeout(() => { const c = start + path.length + 2; ta.current?.setSelectionRange(c, c); setCaret(c); }, 0);
      };
      const chats = Object.entries(app.convTitles).filter(([id, title]) => !q || `${id} ${title}`.toLowerCase().includes(q)).slice(0, 5).map(([id, title]) => ({
        key: `chat:${id}`, label: title || id, hint: `Chat · @chats/${id}/chat.json`, icon: MessageSquare, run: () => insertMention(`chats/${id}/chat.json`),
      }));
      const files = workspaceFiles.filter((f) => {
        const chatUpload = /^chats\/[\w-]+\/uploads\//.test(f.path);
        return (!f.path.startsWith("chats/") || chatUpload) && f.path.toLowerCase().includes(q);
      }).slice(0, 8).map((f) => ({
        key: f.path, label: f.name, hint: f.path, icon: FileIcon, run: () => insertMention(f.path),
      }));
      return [...chats, ...files].slice(0, 10);
    }
    return [];
  }, [cmdQ, cmdArg, mentionQ, p.commands, workspaceFiles, app.convTitles, before, text, caret]);
  useEffect(() => setMenuIdx(0), [items.length]);

  const ready = chips.every((c) => !c.loading);
  const hasDraft = !!(text.trim() || chips.length);
  const canSend = hasDraft && ready && (!p.streaming || !!p.onQueue);
  const send = (action: "send" | "queue" | "steer" = "send") => {
    if (!canSend) return;
    const payload = { content: text.trim(), attachments: chips.map(({ path, name, mime, size }) => ({ path, name, mime, size })), quote: p.quote || null };
    if (!p.streaming || action === "send") p.onSend(payload);
    else if (action === "steer") p.onSteer?.(payload);
    else p.onQueue?.(payload);
    setText(""); setChips([]); p.onClearQuote?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenuIdx((i) => (i + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenuIdx((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); items[menuIdx]?.run(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(p.streaming ? (e.altKey || e.metaKey || e.ctrlKey ? "steer" : "queue") : "send");
      return;
    }
    if (e.key === "Escape") { if (p.onCancel) p.onCancel(); else ta.current?.blur(); return; }
    if (e.key === "Backspace" && !text && !chips.length) {
      if (p.quote) { p.onClearQuote?.(); return; }
      e.preventDefault(); if (p.onCancel) p.onCancel(); else ta.current?.blur();
    }
  };

  const open = p.inline || focused || !!text || chips.length > 0 || !!p.quote;
  return (
    <div className={`composer${open ? " open" : ""}${p.inline ? " inline" : ""}${drag ? " drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
      {items.length > 0 && focused && <div className="menu" role="listbox">{items.map((it, i) => { const I = it.icon; return <button key={it.key} className={i === menuIdx ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); it.run(); }}><I />{it.label}<small>{it.hint}</small></button>; })}</div>}
      {!!p.queued?.length && <div className="queue-tray"><div className="queue-tray-title">Up next</div>{p.queued.map((item) => <div key={item.id} className="queue-item"><span>{item.preview || "Attached message"}</span><button className="ib sm" aria-label="Remove queued message" title="Remove from queue" onClick={() => p.onRemoveQueued?.(item.id)}><X /></button></div>)}</div>}
      {p.quote && <div className="cquote"><p>{p.quote}</p><button className="ib sm" aria-label="Remove quote" onClick={p.onClearQuote}><X /></button></div>}
      {chips.length > 0 && <div className="chips">{chips.map((c) => {
        const isImg = c.mime.startsWith("image/");
        return <div key={c.key} className={`chip${isImg ? " img" : ""}${c.loading ? " loading" : ""}`} title={c.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {isImg ? <img src={c.preview || fileUrl(c.path)} alt={c.name} /> : <><FileText size={14} /><span>{c.name}</span></>}
          <button className="x" aria-label="Remove" onClick={() => setChips((x) => x.filter((y) => y.key !== c.key))}><X /></button>
        </div>; })}</div>}
      <div className="row">
        <button className="ib" aria-label="Attach" onClick={() => fileIn.current?.click()}><Plus /></button>
        <input ref={fileIn} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <textarea ref={ta} rows={1} value={text} aria-label="Message"
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown} onFocus={() => { setFocused(true); p.onFocus?.(); }} onBlur={() => setFocused(false)}
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); addFiles(f); } }} />
        {p.streaming ? <>
          {canSend && <button className="send queue-action" aria-label="Queue message" title="Queue for after this response · Enter" onClick={() => send("queue")}><ListPlus /></button>}
          {canSend && p.onSteer && <button className="send steer-action" aria-label="Steer agent now" title="Send as live direction · Alt+Enter" onClick={() => send("steer")}><Send /></button>}
          <button className="send stop-action" aria-label="Stop" title="Stop response" onClick={p.onStop}><Square fill="currentColor" /></button>
        </> : canSend ? <button className="send" aria-label="Send" title="Send" onClick={() => send("send")}><ArrowUp /></button> : null}
      </div>
    </div>
  );
});
