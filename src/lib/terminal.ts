import { spawn, ChildProcess } from "child_process";
import fsSync from "fs";
import type { Settings } from "./settings";
import { baseEnv, hasBwrap, hostDenied, wrap } from "./exec";
import { WS, HOME } from "./workspace";

/**
 * Interactive terminal sessions for the canvas, backed by a real pseudo-tty (`script -qfc`, util-linux).
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
  child: ChildProcess; log: string; dropped: number;
  listeners: Set<(e: { t: "data" | "exit"; chunk?: string; code?: number }) => void>;
  exit: number | null; started: number; cols: number; rows: number;
};
const MAX_LOG = 300_000;
const MAX_SESSIONS = 12;

const g = globalThis as unknown as { __terms?: Map<string, Term> };
const terms: Map<string, Term> = (g.__terms ??= new Map());


/** util-linux `script` gives us the pseudo-tty; the server's PATH can be unusual, so look in the usual places. */
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
  const prelude = `stty rows ${rows} cols ${cols} 2>/dev/null; `;
  let inner: string;
  if (host) {
    const shell = process.env.SHELL || "/bin/bash";
    inner = `${prelude}exec ${q(shell)} -i`;
  } else {
    // the agent's own sandbox: bwrap namespace when available, otherwise the soft sandbox (cwd/HOME/env confined)
    const [cmd, ...args] = wrap(["/bin/bash", "--noprofile", "--norc", "-i"], true, WS);
    inner = `${prelude}exec ${[cmd, ...args].map(q).join(" ")}`;
  }
  const env = { ...(host ? baseEnv(false) : baseEnv(true)), TERM: "xterm-256color", COLORTERM: "truecolor", LINES: String(rows), COLUMNS: String(cols) };
  // spawn reports ENOENT when the cwd is missing: the workspace folder may not exist before the first agent run
  try { fsSync.mkdirSync(cwd, { recursive: true }); } catch {}
  const child = spawn(scriptBin(), ["-qfc", inner, "/dev/null"], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const p: Term = { id: termId(), host, title: o.title || (host ? "Host terminal" : "Terminal"), child, log: "", dropped: 0, listeners: new Set(), exit: null, started: Date.now(), cols, rows };
  const onData = (d: Buffer) => {
    const s = d.toString();
    p.log += s; emit(p, { t: "data", chunk: s });
    if (p.log.length > MAX_LOG) { const cut = p.log.length - MAX_LOG * 0.8; p.dropped += cut; p.log = p.log.slice(cut); }
  };
  child.stdout!.on("data", onData);
  child.stderr!.on("data", onData);
  child.on("exit", (code, sig) => { p.exit = code ?? (sig ? 128 : 1); emit(p, { t: "exit", code: p.exit }); });
  child.on("error", (e) => { p.log += String(e); emit(p, { t: "data", chunk: String(e) }); p.exit = 1; });
  terms.set(p.id, p);
  return { ok: true, id: p.id };
}

export function termWrite(id: string, data: string) {
  const p = terms.get(id);
  if (!p) return { ok: false, error: "no such terminal session" };
  if (p.exit !== null) return { ok: false, error: "session has exited" };
  try { p.child.stdin!.write(data); return { ok: true as const }; }
  catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "write failed" }; }
}

export function termKill(id: string) {
  const p = terms.get(id);
  if (!p) return { ok: false, error: "no such terminal session" };
  if (p.exit === null) {
    try { if (p.child.pid) process.kill(-p.child.pid, "SIGTERM"); } catch { try { p.child.kill("SIGTERM"); } catch {} }
    setTimeout(() => { if (p.exit === null) { try { if (p.child.pid) process.kill(-p.child.pid, "SIGKILL"); } catch { try { p.child.kill("SIGKILL"); } catch {} } } }, 1500);
  }
  terms.delete(id);
  return { ok: true as const };
}

export const termGet = (id: string) => terms.get(id);
export const termList = () => [...terms.values()].map((p) => ({ id: p.id, host: p.host, title: p.title, running: p.exit === null, started: p.started, cols: p.cols, rows: p.rows }));

for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => { for (const p of terms.values()) if (p.exit === null) { try { if (p.child.pid) process.kill(-p.child.pid, "SIGTERM"); } catch {} } if (sig !== "exit") process.exit(0); });
}
