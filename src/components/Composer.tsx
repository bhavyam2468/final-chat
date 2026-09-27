"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, ArrowUp, Square, X, FileText, Hash, File as FileIcon } from "lucide-react";
import { Attachment, flatFiles, fileUrl, useApp } from "./ctx";

export type SendPayload = { content: string; attachments: Attachment[]; quote: string | null };
export type ComposerHandle = { insert: (t: string) => void; focus: () => void; addFiles: (f: FileList | File[]) => void };
export type Command = { name: string; hint: string; run: () => void };

type Chip = Attachment & { loading?: boolean; key: string; preview?: string };

type Props = {
  onSend: (p: SendPayload) => void; streaming?: boolean; onStop?: () => void;
  quote?: string | null; onClearQuote?: () => void; inline?: boolean; capture?: boolean;
  commands?: Command[]; initial?: SendPayload; onCancel?: () => void; onFocus?: () => void; autoFocus?: boolean;
  /** localStorage key the draft is kept under, so an unfinished prompt survives a chat switch or reload. */
  draftKey?: string;
};

export async function upload(files: File[]): Promise<Attachment[]> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const r = await fetch("/api/workspace/upload", { method: "POST", body: fd });
  return r.json();
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(p, ref) {
  const app = useApp();
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => p.initial?.content ?? (p.draftKey && typeof localStorage !== "undefined" ? localStorage.getItem("draft:" + p.draftKey) ?? "" : ""));
  const [chips, setChips] = useState<Chip[]>(() => (p.initial?.attachments || []).map((a) => ({ ...a, key: a.path })));
  const [focused, setFocused] = useState(false);
  const [drag, setDrag] = useState(false);
  const [menuIdx, setMenuIdx] = useState(0);
  const [caret, setCaret] = useState(0);

  // draft autosave (per chat) — an unfinished prompt is never lost by switching or reloading
  useEffect(() => {
    if (!p.draftKey) return;
    const k = "draft:" + p.draftKey;
    const t = setTimeout(() => { if (text) localStorage.setItem(k, text); else localStorage.removeItem(k); }, 250);
    return () => clearTimeout(t);
  }, [text, p.draftKey]);

  const autosize = useCallback(() => { const t = ta.current; if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + "px"; }, []);
  useLayoutEffect(autosize, [text, autosize]);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const files = [...list]; if (!files.length) return;
    const temp: Chip[] = files.map((f) => ({ key: Math.random().toString(36), path: "", name: f.name, mime: f.type, size: f.size, loading: true, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined }));
    setChips((c) => [...c, ...temp]);
    try {
      const res = await upload(files);
      setChips((c) => c.map((x) => { const i = temp.findIndex((t) => t.key === x.key); return i < 0 ? x : { ...x, ...res[i], loading: false }; }));
      app.refreshTree();
    } catch { setChips((c) => c.filter((x) => !temp.some((t) => t.key === x.key))); }
  }, [app]);

  useImperativeHandle(ref, () => ({
    insert: (t: string) => { setText((v) => (v && !v.endsWith(" ") ? v + " " : v) + t); setTimeout(() => ta.current?.focus(), 0); },
    focus: () => ta.current?.focus(),
    addFiles,
  }), [addFiles]);

  // type-anywhere capture: a bare keystroke focuses the input, and so does a paste
  useEffect(() => {
    if (!p.capture) return;
    const busy = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], iframe") || document.querySelector(".scrim");
    const onKey = (e: KeyboardEvent) => {
      if (busy(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1) ta.current?.focus();
    };
    // Ctrl+V outside any field should open the composer and land the text in it, not vanish
    const onPaste = (e: ClipboardEvent) => {
      if (busy(e.target)) return;
      const files = [...(e.clipboardData?.files || [])];
      e.preventDefault();
      ta.current?.focus();
      if (files.length) { addFiles(files); return; }
      const t = e.clipboardData?.getData("text/plain") || "";
      if (t) setText((v) => v + t);
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
    if (p.draftKey) localStorage.removeItem("draft:" + p.draftKey);
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
