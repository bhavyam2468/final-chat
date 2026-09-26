import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { WS, HOME } from "./workspace";
import type { Settings } from "./settings";

/**
 * Process execution for the agent (shell, python, pip).
 *
 * terminal = "sandbox": cwd = workspace, HOME = workspace, app secrets stripped from env.
 *   If bubblewrap (`bwrap`) is installed the process is really isolated: whole system read-only,
 *   /home, /root and the app directory hidden, only the workspace writable, network kept.
 *   Without bwrap it is a soft sandbox (still cwd/HOME/env confined, but not enforced).
 * terminal = "host": your real shell. cwd = $HOME when file access is home/full, else workspace.
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

function baseEnv(sandboxed: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1", WORKSPACE: WS };
  if (sandboxed) { for (const k of APP_SECRETS) delete env[k]; env.HOME = WS; }
  return env;
}

function spawnRun(cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; input?: string }): Promise<RunOut> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: o.cwd, env: o.env });
    let out = "";
    const cap = (d: Buffer) => { if (out.length < 400000) out += d; };
    const t = setTimeout(() => { p.kill("SIGKILL"); out += `\n(timeout after ${Math.round(o.timeout / 1000)}s)`; }, o.timeout);
    p.stdout.on("data", cap); p.stderr.on("data", cap);
    p.on("close", (code) => { clearTimeout(t); res({ out, code: code ?? 1 }); });
    p.on("error", (e) => { clearTimeout(t); res({ out: String(e), code: 1 }); });
    if (o.input !== undefined) { p.stdin.write(o.input); p.stdin.end(); } else p.stdin.end();
  });
}

/** Wrap argv in bubblewrap when sandboxing is requested and available. */
function wrap(argv: string[], sandboxed: boolean): string[] {
  if (!sandboxed || !hasBwrap()) return argv;
  const app = process.cwd();
  const hide = ["/home", "/root", "/Users"].filter((d) => fs.existsSync(d));
  if (!hide.some((h) => app.startsWith(h + path.sep))) hide.push(app);
  return ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
    ...hide.flatMap((d) => ["--tmpfs", d]), "--bind", WS, WS, "--chdir", WS, "--setenv", "HOME", WS,
    "--unshare-pid", "--die-with-parent", "--new-session", "--", ...argv];
}

export function mode(st: Settings) {
  const sandboxed = st.terminal !== "host";
  return { sandboxed, isolated: sandboxed && hasBwrap(), cwd: sandboxed || st.access === "sandbox" ? WS : HOME };
}

export async function runShell(st: Settings, command: string, timeoutMs = 120000): Promise<RunOut> {
  const m = mode(st);
  const env = baseEnv(m.sandboxed);
  let prelude = "";
  if (usesSudo(command)) {
    if (m.sandboxed) return { out: "sudo is unavailable in the sandboxed terminal. The user can switch Terminal to host and enable sudo in Settings → Access.", code: 126 };
    if (!st.sudo) return { out: "sudo is disabled. Ask the user to enable it in Settings → Access if this is really needed.", code: 126 };
    const pw = st.secrets?.SUDO_PASSWORD;
    if (pw) {
      const helper = path.join(os.tmpdir(), `ws-askpass-${process.pid}.sh`);
      if (!fs.existsSync(helper)) fs.writeFileSync(helper, '#!/bin/sh\nprintf "%s\\n" "$WS_SUDO_PW"\n', { mode: 0o700 });
      env.SUDO_ASKPASS = helper; env.WS_SUDO_PW = pw;
      prelude = 'sudo() { command sudo -A "$@"; }; export -f sudo; ';
    } else prelude = 'sudo() { command sudo -n "$@"; }; export -f sudo; ';
  }
  const [cmd, ...args] = wrap(["bash", "-lc", prelude + command], m.sandboxed);
  return spawnRun(cmd, args, { cwd: m.cwd, env, timeout: timeoutMs });
}

export async function runPython(st: Settings | null, code: string, timeoutMs = 120000): Promise<RunOut> {
  const sandboxed = st ? st.terminal !== "host" : true;
  const [cmd, ...args] = wrap(["python3", "-"], sandboxed);
  return spawnRun(cmd, args, { cwd: WS, env: baseEnv(sandboxed), timeout: timeoutMs, input: code });
}

/** pip always runs on the host interpreter (installing is an explicit, visible action). */
export async function pipInstall(pkgs: string[]): Promise<RunOut> {
  const safe = pkgs.filter((p) => /^[\w.\-\[\],<>=!~]+$/.test(p));
  if (!safe.length) return { out: "no valid package names", code: 1 };
  return spawnRun("python3", ["-m", "pip", "install", "--break-system-packages", "-q", ...safe], { cwd: WS, env: baseEnv(false), timeout: 300000 });
}

/** Plain helper for trusted internal commands (converters etc.). */
export const runRaw = (cmd: string, args: string[], cwd = WS, timeout = 60000, input?: string) => spawnRun(cmd, args, { cwd, env: baseEnv(false), timeout, input });
