"use client";
/* Terminal in a canvas window, rendered with xterm.js — a real VT100-class emulator:
   colors (256 + truecolor), cursor positioning, the caret, mouse selection, copy/paste,
   bracketed paste, and full-size tracking (the window resizes the pty, programs get SIGWINCH).
   Two faces:
   - a live PTY session (sandboxed bash, or the user's real shell when host access is on): the
     browser forwards raw keystrokes, the tty echoes everything back — tab-completion, shell
     history, line editors and password prompts behave exactly like a local terminal;
   - the output of a process the agent started (proc_start): a read-only follow view. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Square, RotateCw, Plus, Copy, Clipboard, Eraser } from "lucide-react";
import { CanvasSpec, useApp } from "./ctx";
import type { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/** Resolve any CSS color (oklch, color-mix, hex…) to #rrggbb via the canvas parser. */
const conv = (() => { try { return document.createElement("canvas").getContext("2d"); } catch { return null; } })();
function solid(v: string, fb: string): string {
  if (!conv) return fb;
  conv.fillStyle = "#000000"; conv.fillStyle = v.trim();
  const s = conv.fillStyle;
  return typeof s === "string" && /^#[0-9a-f]{3,8}$/i.test(s) ? s : fb;
}
function withAlpha(hex: string, a: number, fb: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return fb;
  const n = parseInt(hex.slice(1), 16);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x.toString(16).padStart(2, "0")).join("")}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}
function mix(a: string, b: string, wa: number, fb: string): string {
  const pa = solid(a, ""), pb = solid(b, "");
  if (!/^#[0-9a-f]{6}$/i.test(pa) || !/^#[0-9a-f]{6}$/i.test(pb)) return fb;
  const x = parseInt(pa.slice(1), 16), y = parseInt(pb.slice(1), 16);
  const ch = (sa: number, sb: number) => Math.round(sa * wa + sb * (1 - wa));
  const r = ch((x >> 16) & 255, (y >> 16) & 255), g = ch((x >> 8) & 255, (y >> 8) & 255), bl = ch(x & 255, y & 255);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const FALLBACK = ["#2e2e2e", "#c75646", "#59a564", "#dbd085", "#5d8fd4", "#b066c6", "#57a3a8", "#cccccc"];
const FALLBACK_BRIGHT = ["#5f5f5f", "#e09690", "#9dcf9e", "#e6d9a3", "#b3c9ef", "#d3a7e0", "#9fd3d8", "#f0f0f0"];

/** The app's own palette, resolved for xterm. Re-read on theme change. */
function termTheme(): import("@xterm/xterm").ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => solid(cs.getPropertyValue(n) || "", fb);
  const bg = mix(v("--bg", "#171613"), v("--fg", "#e8e2d4"), 0.1, "#100f0d");
  const fg = v("--fg", "#e8e2d4");
  const cols = Array.from({ length: 8 }, (_, i) => v(`--ans-${i}`, FALLBACK[i]));
  const bright = Array.from({ length: 8 }, (_, i) => v(`--ans-b${i}`, FALLBACK_BRIGHT[i]));
  return {
    background: bg, foreground: fg, cursor: fg, cursorAccent: bg,
    selectionBackground: withAlpha(fg, 0.28, "#444"),
    black: cols[0], red: cols[1], green: cols[2], yellow: cols[3], blue: cols[4], magenta: cols[5], cyan: cols[6], white: cols[7],
    brightBlack: bright[0], brightRed: bright[1], brightGreen: bright[2], brightYellow: bright[3], brightBlue: bright[4], brightMagenta: bright[5], brightCyan: bright[6], brightWhite: bright[7],
  };
}

/** Mount xterm into `holder`, wire size + theme tracking; returns the Terminal and a disposer. */
async function mountTerm(holder: HTMLDivElement, opts: { readOnly?: boolean; fontSize?: number } = {}): Promise<{ term: XTerm; fit: { fit: () => void; proposeDimensions: () => { cols: number; rows: number } | undefined } | null; dispose: () => void }> {
  const { Terminal } = await import("@xterm/xterm");
  const { FitAddon } = await import("@xterm/addon-fit");
  const term = new Terminal({
    fontFamily: 'var(--font-mono), ui-monospace, "JetBrains Mono", Menlo, monospace',
    fontSize: opts.fontSize ?? 13.5, lineHeight: 1.25,
    cursorBlink: true, cursorStyle: "bar", cursorWidth: 2,
    scrollback: 8000, convertEol: false, allowProposedApi: true,
    disableStdin: !!opts.readOnly,
    theme: termTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(holder);
  try { fit.fit(); } catch { /* zero-size while the window animates in */ }
  const ro = new ResizeObserver(() => { if (holder.clientHeight > 40) { try { fit.fit(); } catch { /* not laid out yet */ } } });
  ro.observe(holder);
  // keep the palette in step with theme toggles
  let gone = false;
  const themeObs = new MutationObserver(() => {
    if (gone) { themeObs.disconnect(); return; }
    term.options.theme = termTheme();
  });
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return { term, fit, dispose: () => { gone = true; ro.disconnect(); themeObs.disconnect(); term.dispose(); } };
}

/** Streams a terminal session; writes keystrokes. Reconnect-safe: the backlog arrives first. */
function Shell({ id, host, setBar }: { id: string; host?: boolean; setBar: (n: React.ReactNode) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const [exit, setExit] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [dims, setDims] = useState<string>("");

  const write = useCallback((data: string) => {
    fetch("/api/terminal", { method: "POST", body: JSON.stringify({ action: "write", id, data }) }).catch(() => {});
  }, [id]);

  useEffect(() => {
    let stop = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const el = holder.current;
      if (!el) return;
      let term: XTerm, dispose: () => void;
      try { ({ term, dispose } = await mountTerm(el)); } catch { return; }
      if (stop) { dispose(); return; }
      disposeRef.current = dispose;
      termRef.current = term;
      term.onData((d) => write(d));
      term.onResize(({ cols, rows }) => {
        setDims(`${cols}×${rows}`);
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => fetch("/api/terminal", { method: "POST", body: JSON.stringify({ action: "resize", id, cols, rows }) }).catch(() => {}), 180);
      });
      // copy / paste / select-all inside the terminal
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;
        const mod = ev.metaKey || ev.ctrlKey;
        if (mod && ev.shiftKey && ev.key.toLowerCase() === "c" && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); return false; }
        if (mod && ev.shiftKey && ev.key.toLowerCase() === "v") { navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {}); return false; }
        if (ev.metaKey && !ev.ctrlKey && ev.key.toLowerCase() === "a") { term.selectAll(); return false; }
        return true;
      });
      // stream the session
      try {
        const res = await fetch(`/api/terminal?id=${encodeURIComponent(id)}`);
        if (!res.body || stop) { setReady(true); return; }
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
              if (e.t === "log" || e.t === "data") term.write(e.chunk || "");
              else if (e.t === "exit") { setExit(Number(e.code)); return; }
            } catch {}
          }
        }
      } catch { /* connection dropped; the session itself keeps running on the server */ }
      setReady(true);
    })();
    return () => { stop = true; clearTimeout(resizeTimer); disposeRef.current?.(); disposeRef.current = null; termRef.current = null; };
  }, [id, write]);

  useEffect(() => {
    setBar(<>
      <span className="term-status">{host ? "your machine" : "sandbox"}{exit !== null ? ` · exited ${exit}` : " · live"}</span>
      <span className="sp" />
      {exit === null && <button className="ib sm" aria-label="Kill session" onClick={() => fetch("/api/terminal", { method: "POST", body: JSON.stringify({ action: "kill", id }) })}><Square /></button>}
    </>);
    return () => setBar(null);
  }, [id, host, exit, setBar]);

  const copySel = () => { const t = termRef.current; const s = t?.getSelection(); if (s) navigator.clipboard.writeText(s).catch(() => {}); };
  const paste = () => navigator.clipboard.readText().then((t) => t && termRef.current?.paste(t)).catch(() => {});

  return (
    <div className="term">
      <div className="term-body" ref={holder} aria-label="Terminal" />
      {!ready && <div className="term-veil"><span className="spin" /> connecting…</div>}
      <div className="term-foot">
        <i className={"tdot" + (exit === null ? " live" : "")} />
        <span>{host ? "your machine" : "sandbox"}{exit !== null ? ` · exited ${exit}` : dims ? ` · ${dims}` : ""}</span>
        <span className="sp" />
        <button className="ib sm" aria-label="Copy selection" onClick={copySel}><Copy /></button>
        <button className="ib sm" aria-label="Paste" onClick={paste}><Clipboard /></button>
        <button className="ib sm" aria-label="Clear" onClick={() => termRef.current?.clear()}><Eraser /></button>
      </div>
    </div>
  );
}

function NewTerm({ host, onNew }: { host?: boolean; onNew: (id: string) => void }) {
  const body = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const create = useCallback(() => {
    const el = body.current; const r = el?.getBoundingClientRect();
    const cols = Math.max(40, Math.min(300, Math.floor((r?.width || 640) / 7.45)));
    const rows = Math.max(10, Math.min(160, Math.floor((r?.height || 400) / 17.5)));
    fetch("/api/terminal", { method: "POST", body: JSON.stringify({ action: "create", host, cols, rows }) })
      .then(async (x) => { const j = await x.json(); if (j.id) onNew(j.id); else setErr(j.error || "Could not start a terminal."); })
      .catch(() => setErr("Could not reach the terminal service."));
  }, [host, onNew]);
  useEffect(() => { create(); }, [create]);
  return <div className="term" ref={body}>{err ? <div className="term-veil err">{err}</div> : <div className="term-veil"><span className="spin" /> starting {(host ? "your machine's" : "")} shell…</div>}</div>;
}

/** Read-only follow view of a process the agent started. */
function ProcLog({ name, setBar }: { name: string; setBar: (n: React.ReactNode) => void }) {
  const app = useApp();
  const holder = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const lastLen = useRef(0);
  const prevHead = useRef<string>("");
  const [info, setInfo] = useState<{ status: string; running: boolean } | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const el = holder.current;
      if (!el) return;
      let term: XTerm, dispose: () => void;
      try { ({ term, dispose } = await mountTerm(el, { readOnly: true })); } catch { return; }
      if (stop) { dispose(); return; }
      disposeRef.current = dispose;
      termRef.current = term;
      const load = () => {
        fetch(`/api/proc?name=${encodeURIComponent(name)}`).then((r) => r.json()).then((j) => {
          if (!j || stop) return;
          setInfo({ status: String(j.status || ""), running: !!j.running });
          const log = String(j.log || "");
          const grew = lastLen.current > 0 && log.length > lastLen.current && log.startsWith(prevHead.current);
          if (grew) term.write(log.slice(lastLen.current));
          else if (log.length !== lastLen.current) { term.reset(); term.write(log.slice(-160_000)); }
          prevHead.current = log.slice(0, Math.min(64, log.length));
          lastLen.current = log.length;
        }).catch(() => {});
      };
      load();
      timer = setInterval(load, 1200);
    })();
    return () => { stop = true; if (timer) clearInterval(timer); disposeRef.current?.(); disposeRef.current = null; termRef.current = null; };
  }, [name]);

  useEffect(() => {
    setBar(<>
      <span className="term-status">{info?.status || "…"}</span>
      <span className="sp" />
      {info?.running && <button className="ib sm" aria-label="Restart process" onClick={() => fetch("/api/proc", { method: "POST", body: JSON.stringify({ name, action: "restart" }) })}><RotateCw /></button>}
      {info?.running && <button className="ib sm" aria-label="Stop process" onClick={() => fetch("/api/proc", { method: "POST", body: JSON.stringify({ name }) })}><Square /></button>}
      <button className="ib sm" aria-label="Open live terminal" onClick={() => app.openTerm({})}><Plus /></button>
    </>);
    return () => setBar(null);
  }, [info, name, setBar, app]);

  return (
    <div className="term">
      <div className="term-body" ref={holder} aria-label="Process output" />
      <div className="term-foot">
        <i className={"tdot" + (info?.running ? " live" : "")} />
        <span>{name}{info ? ` · ${info.running ? "running" : "exited"}` : ""} · read-only</span>
        <span className="sp" />
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
