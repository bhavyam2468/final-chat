"use client";
/* Terminal in a canvas window. Two faces:
   - a live PTY session (sandboxed bash, or the user's real shell when host access is on): the browser
     forwards raw keystrokes, the tty echoes everything back, so tab-completion, shell history and
     password prompts behave exactly like a local terminal;
   - the output of a process the agent started (proc_start): read-only follow view with Stop/Restart.
   Output is rendered with a small SGR interpreter tuned to the app's quiet palette. */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Square, RotateCw, Plus } from "lucide-react";
import { CanvasSpec, useApp } from "./ctx";

const TAIL = 48_000; // bytes of scrollback kept for rendering (the server keeps much more)

/** \r line-rewrites (progress bars, spinners): keep the last segment of each line. */
function carriageReturns(s: string) {
  return s.split("\n").map((l) => { const i = l.lastIndexOf("\r"); return i >= 0 ? l.slice(i + 1) : l; }).join("\n");
}

type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean };
const C256 = (n: number) => {
  if (n < 8) return `var(--ans-${n})`;
  if (n < 16) return `var(--ans-b${n - 8})`;
  if (n < 232) { const v = n - 16; const r = [v >> 6, (v >> 3) & 7, v & 7].map((x) => x * 255 / 7); return `rgb(${r.map(Math.round).join(",")})`; }
  const g = (n - 232) * 255 / 23; return `rgb(${Array(3).fill(Math.round(g)).join(",")})`;
};

/** Parse text into styled spans. ESC sequences other than SGR are dropped. */
function parseAnsi(text: string): { style: Style; text: string }[] {
  const out: { style: Style; text: string }[] = [];
  let style: Style = {};
  let buf = "";
  const flush = () => { if (buf) { out.push({ style, text: buf }); buf = ""; } };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "\x1b") { buf += c; continue; }
    const n = text[i + 1];
    if (n === "[") {
      const end = /[a-zA-Z]/.exec(text.slice(i + 2));
      if (!end) break; // truncated escape at the tail: drop the rest
      const stop = i + 2 + end.index;
      const final = text[stop];
      const params = text.slice(i + 2, stop);
      i = stop;
      if (final !== "m") continue; // cursor movement etc: not meaningful in a scrolling log
      const nums = params === "" ? [0] : params.split(";").map((x) => (x === "" ? 0 : Number(x) || 0));
      flush();
      for (let k = 0; k < nums.length; k++) {
        const v = nums[k];
        if (v === 0) style = {};
        else if (v === 1) style = { ...style, bold: true };
        else if (v === 2) style = { ...style, dim: true };
        else if (v === 3) style = { ...style, italic: true };
        else if (v === 4) style = { ...style, underline: true };
        else if (v === 7) style = { ...style, inverse: true };
        else if (v === 22) style = { ...style, bold: false, dim: false };
        else if (v === 23) style = { ...style, italic: false };
        else if (v === 24) style = { ...style, underline: false };
        else if (v === 27) style = { ...style, inverse: false };
        else if (v === 39) style = { ...style, fg: undefined };
        else if (v === 49) style = { ...style, bg: undefined };
        else if ((v >= 30 && v <= 37) || (v >= 90 && v <= 97)) style = { ...style, fg: C256(v) };
        else if ((v >= 40 && v <= 47) || (v >= 100 && v <= 107)) style = { ...style, bg: C256(v) };
        else if (v === 38 || v === 48) {
          const mode = nums[k + 1];
          let col: string | undefined;
          if (mode === 5) { col = C256(nums[k + 2] || 0); k += 2; }
          else if (mode === 2) { col = `rgb(${nums[k + 2] || 0},${nums[k + 3] || 0},${nums[k + 4] || 0})`; k += 4; }
          else break;
          style = { ...style, ...(v === 38 ? { fg: col } : { bg: col }) };
        }
      }
    } else if (n === "]") { const stop = text.indexOf("\x07", i); if (stop < 0) break; i = stop; }
    else i++; // two-char escapes: drop the pair
  }
  flush();
  return out;
}

const Ansi = memo(function Ansi({ text }: { text: string }) {
  const spans = useMemo(() => parseAnsi(carriageReturns(text)), [text]);
  return <>{spans.map((s, i) => {
    const st: React.CSSProperties = {};
    if (s.style.fg) st.color = s.style.fg;
    if (s.style.bg) st.background = s.style.bg;
    if (s.style.bold) st.fontWeight = 600;
    if (s.style.dim) st.opacity = 0.62;
    if (s.style.italic) st.fontStyle = "italic";
    if (s.style.underline) st.textDecoration = "underline";
    if (s.style.inverse) { const fg = String(st.color || "var(--fg)"); st.color = String(st.background || "var(--bg)"); st.background = fg; }
    return s.text ? <span key={i} style={st}>{s.text}</span> : null;
  })}</>;
});

/** Streams a terminal session; writes keystrokes. Reconnect-safe: the backlog arrives first. */
function Shell({ id, host, setBar }: { id: string; host?: boolean; setBar: (n: React.ReactNode) => void }) {
  const [log, setLog] = useState("");
  const [exit, setExit] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch(`/api/terminal?id=${encodeURIComponent(id)}`);
        if (!res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stop) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const e = JSON.parse(line);
              if (e.t === "log" || e.t === "data") setLog((l) => (l + (e.chunk || "")).slice(-TAIL));
              else if (e.t === "exit") { setExit(Number(e.code)); return; }
            } catch {}
          }
        }
      } catch { /* connection dropped; the session itself keeps running on the server */ }
    })();
    return () => { stop = true; };
  }, [id]);

  useEffect(() => {
    setBar(<>
      <span className="term-status">{host ? "your machine" : "sandbox"}{exit !== null ? ` · exited ${exit}` : " · live"}</span>
      <span className="sp" />
      {exit === null && <button className="ib sm" aria-label="Kill session" title="Kill session" onClick={() => fetch("/api/terminal", { method: "POST", body: JSON.stringify({ action: "kill", id }) })}><Square /></button>}
    </>);
    return () => setBar(null);
  }, [id, host, exit, setBar]);

  useEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log]);
  const onScroll = () => { const el = body.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  const write = useCallback((data: string) => {
    fetch("/api/terminal", { method: "POST", body: JSON.stringify({ action: "write", id, data }) }).catch(() => {});
  }, [id]);

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    let seq: string | null = null;
    if (e.ctrlKey && k.length === 1 && /[a-zA-Z]/.test(k)) seq = String.fromCharCode(k.toUpperCase().charCodeAt(0) & 0x1f);
    else if (e.metaKey || e.ctrlKey || e.altKey) return; // let browser shortcuts through
    else if (k === "Enter") seq = "\r";
    else if (k === "Backspace") seq = "\x7f";
    else if (k === "Tab") seq = "\t";
    else if (k === "Escape") seq = "\x1b";
    else if (k === "ArrowUp") seq = "\x1b[A";
    else if (k === "ArrowDown") seq = "\x1b[B";
    else if (k === "ArrowRight") seq = "\x1b[C";
    else if (k === "ArrowLeft") seq = "\x1b[D";
    else if (k === "Home") seq = "\x1b[H";
    else if (k === "End") seq = "\x1b[F";
    else if (k === "PageUp") seq = "\x1b[5~";
    else if (k === "PageDown") seq = "\x1b[6~";
    else if (k === "Delete") seq = "\x1b[3~";
    else if (k.length === 1) seq = k;
    if (seq === null) return;
    e.preventDefault();
    write(seq);
  };

  return (
    <div className="term" onClick={() => input.current?.focus()}>
      <div className="term-scroll" ref={body} onScroll={onScroll}>
        <pre className="term-out"><Ansi text={log} />{exit !== null && <span className="term-exit">— session exited ({exit}) —</span>}</pre>
      </div>
      {exit === null && <input ref={input} className="term-key" autoFocus aria-label="Terminal input" value=""
        onChange={() => {}} onKeyDown={onKey}
        onPaste={(e) => { e.preventDefault(); write(e.clipboardData.getData("text/plain")); }} />}
    </div>
  );
}

function NewTerm({ host, onNew }: { host?: boolean; onNew: (id: string) => void }) {
  const body = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const create = useCallback(() => {
    const el = body.current; const r = el?.getBoundingClientRect();
    const cols = Math.max(40, Math.min(300, Math.floor((r?.width || 640) / 7.45)));
    const rows = Math.max(10, Math.min(160, Math.floor((r?.height || 400) / 18.5)));
    fetch("/api/terminal", { method: "POST", body: JSON.stringify({ action: "create", host, cols, rows }) })
      .then(async (x) => { const j = await x.json(); if (j.id) onNew(j.id); else setErr(j.error || "Could not start a terminal."); })
      .catch(() => setErr("Could not reach the terminal service."));
  }, [host, onNew]);
  useEffect(() => { create(); }, [create]);
  return <div className="term" ref={body}>{err ? <div className="v-msg err">{err}</div> : <div className="v-msg"><span className="spin" /></div>}</div>;
}

/** Read-only follow view of a process the agent started. */
function ProcLog({ name, setBar }: { name: string; setBar: (n: React.ReactNode) => void }) {
  const app = useApp();
  const [info, setInfo] = useState<{ log: string; status: string; running: boolean } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const load = useCallback(() => { fetch(`/api/proc?name=${encodeURIComponent(name)}`).then((r) => r.json()).then((j) => j && setInfo({ log: String(j.log || ""), status: String(j.status || ""), running: !!j.running })).catch(() => {}); }, [name]);
  useEffect(() => { load(); const t = setInterval(load, 1200); return () => clearInterval(t); }, [load]);
  useEffect(() => { const el = body.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [info?.log]);
  const onScroll = () => { const el = body.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };
  useEffect(() => {
    setBar(<>
      <span className="term-status">{info?.status || "…"}</span>
      <span className="sp" />
      {info?.running && <button className="ib sm" aria-label="Restart process" title="Restart" onClick={() => fetch("/api/proc", { method: "POST", body: JSON.stringify({ name, action: "restart" }) })}><RotateCw /></button>}
      {info?.running && <button className="ib sm" aria-label="Stop process" title="Stop" onClick={() => fetch("/api/proc", { method: "POST", body: JSON.stringify({ name }) })}><Square /></button>}
      <button className="ib sm" aria-label="Open live terminal" title="Open a live terminal" onClick={() => app.openTerm({})}><Plus /></button>
    </>);
    return () => setBar(null);
  }, [info, name, setBar, app]);
  return (
    <div className="term proc">
      <div className="term-scroll" ref={body} onScroll={onScroll}>
        <pre className="term-out">{info ? <Ansi text={info.log.slice(-TAIL)} /> : <span className="spin" />}</pre>
        {info && !info.running && <span className="term-exit">process is not running</span>}
      </div>
    </div>
  );
}

/** A canvas window showing a terminal: an existing session, a new one, or a process's output. */
export function TermView({ spec, setBar }: { spec: Extract<CanvasSpec, { kind: "term" }>; setBar: (n: React.ReactNode) => void }) {
  const [sid, setSid] = useState<string | null>(spec.id || null);
  if (spec.proc) return <ProcLog name={spec.proc} setBar={setBar} />;
  if (sid) return <Shell key={sid} id={sid} host={spec.host} setBar={setBar} />;
  return <NewTerm host={spec.host} onNew={setSid} />;
}
