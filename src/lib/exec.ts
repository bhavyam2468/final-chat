import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { WS, HOME, PY, VENV } from "./workspace";
export { PY, VENV };
import type { Settings } from "./settings";

/**
 * Process execution for the agent (shell, host_shell, python, pip, background processes).
 *
 * Sandbox (tool `shell`, `run_python`, procs without host): cwd = workspace, HOME = workspace, app secrets stripped.
 *   If bubblewrap (`bwrap`) is installed the process is really isolated: whole system read-only,
 *   /home, /root and the app directory hidden, only the workspace writable, network kept.
 *   Without bwrap it is a soft sandbox (still cwd/HOME/env confined, but not enforced).
 * Host (tool `host_shell`, procs with host=true; only when Settings → Access → Host terminal is on):
 *   the user's real shell. cwd = $HOME when file access is home/full, else workspace.
 * sudo: blocked unless settings.sudo is on (host only). With a SUDO_PASSWORD secret, sudo is
 *   wrapped with an askpass helper (`sudo -A`); otherwise `sudo -n` (works with NOPASSWD rules).
 */

export type RunOut = { out: string; code: number };
const APP_SECRETS = ["LLM_API_KEY", "FIRECRAWL_API_KEY", "DATABASE_URL", "GEMINI_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

let bwrapOk: boolean | null = null;
export function hasBwrap() {
  if (bwrapOk === null) {
    try { bwrapOk = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "true"], { timeout: 4000 }).status === 0; }
    catch { bwrapOk = false; }
  }
  return bwrapOk;
}
let sofficeBin: string | null | undefined;
export function soffice() {
  if (sofficeBin === undefined) {
    sofficeBin = null;
    for (const b of ["soffice", "libreoffice"]) { try { if (spawnSync(b, ["--version"], { timeout: 8000 }).status === 0) { sofficeBin = b; break; } } catch {} }
  }
  return sofficeBin;
}

const SUDO_WORDS = new Set(["sudo", "su", "doas", "pkexec", "run0"]);
export function usesSudo(cmd: string) {
  return cmd.split(/[;&|\n()`]+|\$\(/).some((seg) => SUDO_WORDS.has(seg.trim().replace(/^(?:\w+=\S*\s+)*/, "").split(/\s+/)[0]));
}

export function baseEnv(sandboxed: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1", WORKSPACE: WS };
  if (sandboxed) {
    for (const k of APP_SECRETS) delete env[k]; env.HOME = WS;
    // git must never walk up out of the workspace into an enclosing repo (e.g. this app's own checkout):
    // without bwrap, a sandboxed `git reset --hard` would otherwise hit the parent repository.
    env.GIT_CEILING_DIRECTORIES = WS.replace(/[\\/][^\\/]+[\\/]?$/, "");
  }
  return env;
}

function spawnRun(cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; input?: string; onData?: (d: string) => void }): Promise<RunOut> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: o.cwd, env: o.env });
    let out = "", streamed = 0, lastAt = 0;
    const cap = (d: Buffer) => {
      if (out.length < 400000) out += d;
      // live tail for the UI: never silent, but never a firehose either
      if (o.onData && streamed < 60000 && Date.now() - lastAt > 60) { lastAt = Date.now(); const s = d.toString(); streamed += s.length; o.onData(s); }
    };
    const t = setTimeout(() => { p.kill("SIGKILL"); out += `\n(timeout after ${Math.round(o.timeout / 1000)}s)`; }, o.timeout);
    p.stdout.on("data", cap); p.stderr.on("data", cap);
    p.on("close", (code) => { clearTimeout(t); res({ out, code: code ?? 1 }); });
    p.on("error", (e) => { clearTimeout(t); res({ out: String(e), code: 1 }); });
    if (o.input !== undefined) { p.stdin.write(o.input); p.stdin.end(); } else p.stdin.end();
  });
}

/** Wrap argv in bubblewrap when sandboxing is requested and available. */

function wrap(argv: string[], sandboxed: boolean, cwd: string = WS): string[] {
  if (!sandboxed || !hasBwrap()) return argv;
  const app = process.cwd();
  const hide = ["/home", "/root", "/Users"].filter((d) => fs.existsSync(d));
  if (!hide.some((h) => app.startsWith(h + path.sep))) hide.push(app);
  return ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
    ...hide.flatMap((d) => ["--tmpfs", d]), ...(VENV() ? ["--ro-bind", VENV(), VENV()] : []), "--bind", WS, WS, "--chdir", cwd.startsWith(WS) ? cwd : WS, "--setenv", "HOME", WS,
    "--unshare-pid", "--die-with-parent", "--new-session", "--", ...argv];
}

/**
 * Two terminals, two tools: `shell` always runs in the agent's own sandbox; `host_shell` (only offered when the
 * user switches Host terminal on) runs as the user. `host=true` without the switch is refused, never downgraded.
 */
export function mode(st: Settings, host = false) {
  const sandboxed = !host;
  return { sandboxed, isolated: sandboxed && hasBwrap(), cwd: sandboxed || st.access === "sandbox" ? WS : HOME };
}
export const hostDenied = (st: Settings) => (st.terminal !== "host" ? "Host terminal is off. The user can enable it in Settings → Access; until then use shell (sandbox)." : null);

/**
 * Waiting sudo prompts: the shell tool parks on `sudoWait(partId)` and the browser answers it through
 * /api/conversations/:id/sudo. Nothing is written to disk; "remember" keeps it in memory for the chat.
 */
const sudoWaiters = new Map<string, (pw: string | null) => void>();
export function sudoWait(key: string, ms = 180000): Promise<string | null> {
  return new Promise((res) => {
    const done = (v: string | null) => { if (sudoWaiters.delete(key)) res(v); };
    sudoWaiters.set(key, done);
    setTimeout(() => done(null), ms);
  });
}
export function sudoAnswer(key: string, pw: string | null): boolean {
  const r = sudoWaiters.get(key); if (!r) return false;
  sudoWaiters.delete(key); r(pw); return true;
}
const sudoMem = new Map<string, string>();
export const sudoRemember = (chat: string, pw: string) => sudoMem.set(chat, pw);
/** The password for this chat: remembered for the conversation, else the stored secret. */
export function sudoPassword(st: Settings, chat?: string): string | undefined {
  return (chat ? sudoMem.get(chat) : undefined) || st.secrets?.SUDO_PASSWORD;
}
/** Does this command need a password the app does not have yet? */
export function sudoNeedsPassword(st: Settings, command: string, sandboxed: boolean, chat?: string): string | null {
  if (!usesSudo(command) || sandboxed || !st.sudo) return null;
  return sudoPassword(st, chat) ? null : (sandboxed ? "sandbox" : "host_shell needs your sudo password");
}

/** Shell prelude + env for sudo handling. Returns an error string when sudo is not allowed. */
export function sudoSetup(st: Settings, command: string, sandboxed: boolean, env: NodeJS.ProcessEnv, pw?: string): { prelude: string } | { error: string } {
  if (!usesSudo(command)) return { prelude: "" };
  if (sandboxed) return { error: "sudo is unavailable in the sandbox shell. It needs host_shell with Settings → Access → Allow sudo." };
  if (!st.sudo) return { error: "sudo is disabled. Ask the user to enable it in Settings → Access if this is really needed." };
  const secret = pw || st.secrets?.SUDO_PASSWORD;
  if (secret) {
    const helper = path.join(os.tmpdir(), `ws-askpass-${process.pid}.sh`);
    if (!fs.existsSync(helper)) fs.writeFileSync(helper, '#!/bin/sh\nprintf "%s\\n" "$WS_SUDO_PW"\n', { mode: 0o700 });
    env.SUDO_ASKPASS = helper; env.WS_SUDO_PW = secret;
    return { prelude: 'sudo() { command sudo -A "$@"; }; export -f sudo; ' };
  }
  return { prelude: 'sudo() { command sudo -n "$@"; }; export -f sudo; ' };
}

/** argv + spawn options for a bash command in the chosen terminal (shared by one-shot runs and background processes). */
export function shellSpawn(st: Settings, command: string, host: boolean, cwd?: string, sudoPw?: string) {
  const m = mode(st, host);
  const env = baseEnv(m.sandboxed);
  const s = sudoSetup(st, command, m.sandboxed, env, sudoPw);
  if ("error" in s) return { error: s.error };
  const dir = cwd ? cwd : m.cwd;
  const [cmd, ...args] = wrap(["bash", "-lc", s.prelude + command], m.sandboxed, dir);
  return { cmd, args, env, cwd: dir };
}

export async function runShell(st: Settings, command: string, timeoutMs = 120000, host = false, cwd?: string, onData?: (d: string) => void, sudoPw?: string): Promise<RunOut> {
  if (host && hostDenied(st)) return { out: hostDenied(st)!, code: 126 };
  const sp = shellSpawn(st, command, host, cwd, sudoPw);
  if ("error" in sp) return { out: sp.error!, code: 126 };
  return spawnRun(sp.cmd, sp.args, { cwd: sp.cwd, env: sp.env, timeout: timeoutMs, onData });
}

/** run_python and Blocks py() always use the sandbox; host Python goes through host_shell. */
export async function runPython(_st: Settings | null, code: string, timeoutMs = 120000, onData?: (d: string) => void): Promise<RunOut> {
  const sandboxed = true;
  const [cmd, ...args] = wrap([PY(), "-"], sandboxed);
  return spawnRun(cmd, args, { cwd: WS, env: baseEnv(sandboxed), timeout: timeoutMs, input: code, onData });
}

/** pip always runs on the host interpreter (installing is an explicit, visible action). */
export async function pipInstall(pkgs: string[]): Promise<RunOut> {
  const safe = pkgs.filter((p) => /^[\w.\-\[\],<>=!~]+$/.test(p));
  if (!safe.length) return { out: "no valid package names", code: 1 };
  return spawnRun(PY(), ["-m", "pip", "install", ...(VENV() || process.env.PYTHON_BIN ? [] : ["--break-system-packages"]), "-q", ...safe], { cwd: WS, env: baseEnv(false), timeout: 300000 });
}

/** Plain helper for trusted internal commands (converters etc.). */
export const runRaw = (cmd: string, args: string[], cwd = WS, timeout = 60000, input?: string) => spawnRun(cmd, args, { cwd, env: baseEnv(false), timeout, input });
