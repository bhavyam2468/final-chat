"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, ArrowUp, Square, X, FileText, Hash, File as FileIcon } from "lucide-react";
import { Attachment, flatFiles, fileUrl, useApp } from "./ctx";
import { chatDir } from "@/lib/shared";

export type SendPayload = { content: string; attachments: Attachment[]; quote: string | null };
export type ComposerHandle = { insert: (t: string) => void; focus: () => void; addFiles: (f: FileList | File[]) => void };
export type Command = { name: string; hint: string; run: () => void };

type Chip = Attachment & { loading?: boolean; key: string; preview?: string };

type Props = {
  onSend: (p: SendPayload) => void; streaming?: boolean; onStop?: () => void;
  quote?: string | null; onClearQuote?: () => void; inline?: boolean; capture?: boolean;
  commands?: Command[]; initial?: SendPayload; onCancel?: () => void; onFocus?: () => void; autoFocus?: boolean;
  /** per-chat draft: text + attachments survive chat switches and reloads (localStorage "draft:<key>") */
  draftKey?: string;
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
  useEffect(() => {
    if (!p.draftKey) return;
    keyRef.current = p.draftKey;
    const d = readDraft(p.draftKey);
    setText(d?.text || ""); setChips((d?.chips || []).map((a) => ({ ...a, key: a.path })));
  }, [p.draftKey]);
  useEffect(() => {
    const k = keyRef.current; if (!k) return;
    const done = chips.filter((c) => !c.loading).map(({ path, name, mime, size }) => ({ path, name, mime, size }));
    if (!text && !done.length) localStorage.removeItem("draft:" + k);
    else localStorage.setItem("draft:" + k, JSON.stringify({ text, chips: done }));
  }, [text, chips]);

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

  // menus
  const before = text.slice(0, caret);
  const mentionQ = before.match(/(?:^|\s)@([\w./~-]*)$/)?.[1];
  const cmdQ = /^\/\w*$/.test(text) ? text.slice(1) : undefined;
  const items = useMemo(() => {
    if (cmdQ !== undefined && p.commands) return p.commands.filter((c) => c.name.startsWith(cmdQ.toLowerCase())).map((c) => ({ key: c.name, label: "/" + c.name, hint: c.hint, run: () => { setText(""); c.run(); }, icon: Hash }));
    if (mentionQ !== undefined) return flatFiles(app.tree).filter((f) => f.path.toLowerCase().includes(mentionQ.toLowerCase()) && !f.path.startsWith("chats/")).slice(0, 8).map((f) => ({
      key: f.path, label: f.name, hint: f.path, icon: FileIcon,
      run: () => { const start = before.lastIndexOf("@"); const nt = text.slice(0, start) + "@" + f.path + " " + text.slice(caret); setText(nt); setTimeout(() => { const c = start + f.path.length + 2; ta.current?.setSelectionRange(c, c); setCaret(c); }, 0); },
    }));
    return [];
  }, [cmdQ, mentionQ, p.commands, app.tree, before, text, caret]);
  useEffect(() => setMenuIdx(0), [items.length]);

  const ready = chips.every((c) => !c.loading);
  const canSend = (text.trim() || chips.length) && ready && !p.streaming;
  const send = () => {
    if (!canSend) return;
    p.onSend({ content: text.trim(), attachments: chips.map(({ path, name, mime, size }) => ({ path, name, mime, size })), quote: p.quote || null });
    setText(""); setChips([]); p.onClearQuote?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenuIdx((i) => (i + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenuIdx((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); items[menuIdx]?.run(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); return; }
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
        {p.streaming ? <button className="send" aria-label="Stop" onClick={p.onStop}><Square fill="currentColor" /></button>
          : canSend ? <button className="send" aria-label="Send" onClick={send}><ArrowUp /></button> : null}
      </div>
    </div>
  );
});
