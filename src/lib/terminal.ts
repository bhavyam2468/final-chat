import { spawn, ChildProcess } from "child_process";
import fsSync from "fs";
import type { Settings } from "./settings";
import { baseEnv, hasBwrap, hostDenied, wrap } from "./exec";
import { WS, HOME } from "./workspace";

/**
 * Interactive terminal sessions for the canvas, backed by a real pseudo-tty.
 *
 * Preferred engine is node-pty (a true kernel pty: resize delivers SIGWINCH, so zsh/bash
 * line editors, vim and htop track the window). When the native module is missing — it is an
 * optional dependency and needs C toolchain + node headers to build — we fall back to
 * util-linux `script -qfc` (a pty too, but a fixed size one).
 *
 * Two modes, mirroring the agent's own split:
 *   sandbox (default) — bash -i inside the agent's sandbox: cwd = workspace, HOME = workspace,
 *     app secrets stripped, bubblewrap namespace when installed. Safe to hand to anyone.
 *   host (only while Settings → Access → Host terminal is on) — the user's real $SHELL in $HOME,
 *     their profile, their toolchains; sudo prompts work because it is a genuine tty.
 *
 * The browser sends raw keystrokes (including escape sequences); the tty echoes everything back,
 * so line editing, tab completion, shell history and password prompts all behave like a real terminal.
 */
export type Term = {
  id: string; host: boolean; title: string;
  pty?: { write: (d: string) => void; resize: (c: number, r: number) => void; kill: () => void; pid: number };
  child?: ChildProcess;
  log: string; dropped: number;
  listeners: Set<(e: { t: "data" | "exit"; chunk?: string; code?: number }) => void>;
  exit: number | null; started: number; cols: number; rows: number;
};
const MAX_LOG = 300_000;
const MAX_SESSIONS = 12;

const g = globalThis as unknown as { __terms?: Map<string, Term>; __ptyLib?: typeof import("node-pty") | null };
const terms: Map<string, Term> = (g.__terms ??= new Map());

/** node-pty when it built; null → `script` fallback (fixed size). */
function ptyLib(): typeof import("node-pty") | null {
  if (g.__ptyLib) return g.__ptyLib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require("node-pty") as typeof import("node-pty");
    g.__ptyLib = lib;
    return lib;
  } catch {
    return null;
  }
}

/** util-linux `script` gives us the fallback pseudo-tty; the server's PATH can be unusual, so look in the usual places. */
let scriptPath: string | null = null;
function scriptBin(): string {
  if (scriptPath) return scriptPath;
  for (const c of ["/usr/bin/script", "/bin/script", "/usr/local/bin/script"]) { try { if (fsSync.existsSync(c)) { scriptPath = c; return c; } } catch {} }
  scriptPath = "script";
  return scriptPath;
}

const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const termId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function emit(p: Term, e: { t: "data" | "exit"; chunk?: string; code?: number }) {
  p.listeners.forEach((l) => l(e));
}

function feed(p: Term, d: Buffer) {
  const s = d.toString();
  p.log += s; emit(p, { t: "data", chunk: s });
  if (p.log.length > MAX_LOG) { const cut = p.log.length - MAX_LOG * 0.8; p.dropped += cut; p.log = p.log.slice(cut); }
}

export function termCreate(st: Settings, o: { host?: boolean; cols?: number; rows?: number; cwd?: string; title?: string }): { ok: true; id: string } | { ok: false; error: string } {
  const host = !!o.host;
  if (host) { const d = hostDenied(st); if (d) return { ok: false, error: d }; }
  if (terms.size >= MAX_SESSIONS) {
    // retire the oldest dead session first, else refuse
    const dead = [...terms.values()].find((t) => t.exit !== null);
    if (dead) terms.delete(dead.id); else return { ok: false, error: "Too many terminal sessions open (12). Close one first." };
  }
  const cols = Math.min(400, Math.max(40, Math.round(o.cols || 110)));
  const rows = Math.min(200, Math.max(10, Math.round(o.rows || 28)));
  const cwd = o.cwd ? (host ? (st.access === "sandbox" ? WS : o.cwd) : WS) : host && st.access !== "sandbox" ? HOME : WS;
  const p: Term = { id: termId(), host, title: o.title || (host ? "Host terminal" : "Terminal"), log: "", dropped: 0, listeners: new Set(), exit: null, started: Date.now(), cols, rows };
  const env = { ...(host ? baseEnv(false) : baseEnv(true)), TERM: "xterm-256color", COLORTERM: "truecolor" };
  // spawn reports ENOENT when the cwd is missing: the workspace folder may not exist before the first agent run
  try { fsSync.mkdirSync(cwd, { recursive: true }); } catch {}

  const pty = ptyLib();
  if (pty) {
    let shell: string, args: string[];
    if (host) {
      shell = process.env.SHELL || "/bin/bash";
      args = ["-i"]; // the shell's own rc files run: profile, toolchains, aliases
    } else {
      const [cmd, ...rest] = wrap(["/bin/bash", "--noprofile", "--norc", "-i"], true, WS);
      shell = cmd; args = rest;
    }
    const session = pty.spawn(shell, args, { name: "xterm-256color", cols, rows, cwd, env });
    p.pty = { write: (d) => session.write(d), resize: (c, r) => session.resize(c, r), kill: () => session.kill(), pid: session.pid };
    p.cols = session.cols ?? cols; p.rows = session.rows ?? rows;
    session.onData((d) => feed(p, Buffer.from(d)));
    session.onExit(({ exitCode }) => { p.exit = exitCode; emit(p, { t: "exit", code: p.exit }); terms.delete(p.id); });
  } else {
    const prelude = `stty rows ${rows} cols ${cols} 2>/dev/null; `;
    let inner: string;
    if (host) {
      const shell = process.env.SHELL || "/bin/bash";
      inner = `${prelude}exec ${q(shell)} -i`;
    } else {
      const [cmd, ...args] = wrap(["/bin/bash", "--noprofile", "--norc", "-i"], true, WS);
      inner = `${prelude}exec ${[cmd, ...args].map(q).join(" ")}`;
    }
    const child = spawn(scriptBin(), ["-qfc", inner, "/dev/null"], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    p.child = child;
    child.stdout!.on("data", (d: Buffer) => feed(p, d));
    child.stderr!.on("data", (d: Buffer) => feed(p, d));
    child.on("exit", (code, sig) => { p.exit = code ?? (sig ? 128 : 1); emit(p, { t: "exit", code: p.exit }); terms.delete(p.id); });
    child.on("error", (e) => { feed(p, Buffer.from(String(e))); p.exit = 1; });
  }
  terms.set(p.id, p);
  return { ok: true, id: p.id };
}

export function termWrite(id: string, data: string) {
  const p = terms.get(id);
  if (!p) return { ok: false, error: "no such terminal session" };
  if (p.exit !== null) return { ok: false, error: "session has exited" };
  try {
    if (p.pty) p.pty.write(data);
    else p.child!.stdin!.write(data);
    return { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "write failed" }; }
}

/** Track the window: a real pty resizes and SIGWINCHes the running programs. */
export function termResize(id: string, cols: number, rows: number) {
  const p = terms.get(id);
  if (!p) return { ok: false, error: "no such terminal session" };
  const c = Math.min(400, Math.max(20, Math.round(cols)));
  const r = Math.min(200, Math.max(6, Math.round(rows)));
  p.cols = c; p.rows = r;
  if (!p.pty) return { ok: true as const, resized: false };
  try { p.pty.resize(c, r); return { ok: true as const, resized: true }; }
  catch { return { ok: true as const, resized: false }; }
}

function killTree(pid: number) {
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }, 1500);
}

export function termKill(id: string) {
  const p = terms.get(id);
  if (!p) return { ok: false, error: "no such terminal session" };
  if (p.exit === null) {
    if (p.pty) { killTree(p.pty.pid); try { p.pty.kill(); } catch {} }
    else if (p.child?.pid) killTree(p.child.pid);
  }
  terms.delete(id);
  return { ok: true as const };
}

export const termGet = (id: string) => terms.get(id);
export const termList = () => [...terms.values()].map((p) => ({ id: p.id, host: p.host, title: p.title, running: p.exit === null, started: p.started, cols: p.cols, rows: p.rows }));
export const termEngine = () => (ptyLib() ? "node-pty" : "script");

for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => { for (const p of terms.values()) if (p.exit === null) { if (p.pty) { try { killTree(p.pty.pid); } catch {} } else if (p.child?.pid) { try { killTree(p.child.pid); } catch {} } } if (sig !== "exit") process.exit(0); });
}
