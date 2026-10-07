"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Square, X, Copy, Check, CornerUpRight } from "lucide-react";
import { StreamMarkdown } from "@/lib/streammark/StreamMarkdown";
import css from "./summon.module.css";

/* The summon surface: one question, one answer, no chrome.
   It is a plain page on purpose — it renders the same in a browser tab, in a Chrome app window
   (`minimalist-chat summon`, the global hotkey), and on a phone's home screen. Everything it does
   goes through the app's own APIs (/api/chat), never through the UI. */

type Ev = { t: string; d?: string; id?: string; name?: string; text?: string; conversationId?: string };

const LABEL: Record<string, string> = {
  web_search: "Searching the web", web_fetch: "Opening a page", fs_read: "Reading a file", fs_search: "Searching your files",
  fs_list: "Looking around", shell: "Running a command", host_shell: "Running a command on your machine", run_python: "Running Python",
  start_workflow: "Starting a workflow", template_search: "Searching the template library", template_get: "Reading a template",
  ask_user: "Waiting for you", view_image: "Looking at an image",
};

export default function Summon() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conv, setConv] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [locked, setLocked] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const convRef = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const stream = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ta.current?.focus();
    fetch("/api/settings").then((r) => r.json()).then((j) => setLocked(!!j.caps?.locked)).catch(() => {});
  }, []);
  useEffect(() => { const el = stream.current; if (el && busy) el.scrollTop = el.scrollHeight; }, [answer, busy, tool]);

  const fit = useCallback(() => {
    const el = ta.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(132, Math.max(30, el.scrollHeight)) + "px";
  }, []);

  const send = useCallback(async (raw: string) => {
    const content = raw.trim();
    if (!content || busy) return;
    setQ(""); setAnswer(""); setReasoning(false); setTool(null); setErr(null); setConv(null); convRef.current = null; setBusy(true);
    try { if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission(); } catch { /* notifications are optional */ }
    const ac = new AbortController(); abort.current = ac;
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        // a new chat per ask, born in the quiet "general" mode: no mode lens, no tool nagging
        body: JSON.stringify({ conversationId: null, parentId: null, mode: "general", user: { content } }),
      });
      if (!res.ok || !res.body) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setErr(j.error || `The app answered ${res.status}.`); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let e: Ev; try { e = JSON.parse(line) as Ev; } catch { continue; }
          if (e.t === "meta") { convRef.current = e.conversationId || null; setConv(convRef.current); }
          else if (e.t === "text") { acc += e.d || ""; setAnswer(acc); setReasoning(false); }
          else if (e.t === "retext") { acc = e.text || ""; setAnswer(acc); }
          else if (e.t === "reasoning") setReasoning(true);
          else if (e.t === "reasoningEnd") setReasoning(false);
          else if (e.t === "toolStart" || e.t === "toolDraft" || e.t === "tool") setTool(String(e.name || ""));
          else if (e.t === "toolResult") setTool(null);
          else if (e.t === "error" || e.t === "notice") setErr(String(e.text || "").slice(0, 400));
        }
      }
      // the window is usually not focused when a long answer lands
      if (acc && document.hidden) { try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Workspace", { body: acc.replace(/[#*`>_\n]+/g, " ").slice(0, 140) }); } catch { /* fine */ } }
    } catch (e) {
      if (!/abort/i.test(String(e))) setErr("Lost the connection to the app. Is it still running?");
    } finally { setBusy(false); setTool(null); abort.current = null; }
  }, [busy]);

  const stop = useCallback(async () => {
    const id = convRef.current;
    abort.current?.abort();
    if (id) await fetch("/api/chat", { method: "POST", body: JSON.stringify({ stop: true, conversationId: id }) }).catch(() => {});
    setBusy(false);
  }, []);

  const dismiss = useCallback(() => {
    try { window.close(); } catch { /* a browser tab cannot close itself — the user closes it */ }
    setTimeout(() => ta.current?.blur(), 10);
  }, []);

  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(answer); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  }, [answer]);

  const title = tool ? LABEL[tool] || "Working" : reasoning ? "Thinking" : null;

  return (
    <div className={css.wrap} data-conv={conv || ""}>
      <header className={css.head}>
        <span className={css.mark} aria-hidden />
        <span className={css.brand}>Ask</span>
        {busy && <span className={css.pulse} aria-hidden />}
        <span className={css.spacer} />
        {answer && !busy && <button className={css.ib} title={copied ? "Copied" : "Copy the answer"} aria-label="Copy" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}
        {answer && !busy && !locked && conv && <a className={css.ib} title="Open this in the workspace" aria-label="Open in workspace" href={`/?chat=${conv}`} target="_blank" rel="noreferrer"><CornerUpRight size={14} /></a>}
        <button className={css.ib} title="Close (Esc)" aria-label="Close" onClick={dismiss}><X size={14} /></button>
      </header>

      <div className={css.stream} ref={stream} data-role="stream">
        {err && <p className={css.err}>{err}</p>}
        {!err && !answer && !title && <p className={css.hint}>{locked ? "Ask anything about your workspace." : "Ask anything. Enter sends, Shift+Enter breaks the line, Esc closes."}</p>}
        {title && <p className={css.working}><span className={css.spin} aria-hidden />{title}…</p>}
        {answer && <StreamMarkdown text={answer} streaming={busy} />}
        {answer && !busy && conv && <a className={css.more} href={`/?chat=${conv}`} target="_blank" rel="noreferrer">Open in the workspace</a>}
      </div>

      <form className={css.bar} onSubmit={(e) => { e.preventDefault(); void send(q); }}>
        <textarea
          ref={ta} className={css.input} rows={1} value={q} placeholder="Ask anything" spellCheck={false} autoFocus
          onChange={(e) => { setQ(e.target.value); fit(); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); if (busy) void stop(); else dismiss(); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(q); }
          }}
        />
        {busy
          ? <button type="button" className={css.send} aria-label="Stop" title="Stop (Esc)" onClick={() => void stop()}><Square size={13} /></button>
          : <button type="submit" className={css.send} aria-label="Send" title="Send (Enter)" disabled={!q.trim()}><ArrowUp size={15} /></button>}
      </form>
    </div>
  );
}
