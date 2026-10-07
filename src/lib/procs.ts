import { spawn, ChildProcess, execFile } from "child_process";
import type { Settings } from "./settings";
import { shellSpawn, hostDenied } from "./exec";
import { resolvePath } from "./workspace";

/**
 * Long-running processes (dev servers, watchers, builds) the agent starts, inspects and restarts.
 * One-shot commands belong in shell/host_shell; these survive across tool calls and turns.
 *
 * The suite, in agent terms:
 *   proc_start   — start in the background and return at once (detach is the default: the call never blocks on exit)
 *   proc_logs    — read output (tail/grep), optionally blocking: wait_for port/pattern/exit with a timeout
 *   proc_wait    — block until a process exits, opens a port or prints a pattern (bounded)
 *   proc_write   — write to a live process's stdin (repl input, "y\n" at a prompt, a command for a shell)
 *   proc_signal  — send an arbitrary signal (SIGHUP to reload config, SIGUSR2 to dump debug info, …)
 *   proc_stop    — SIGTERM the whole tree, escalate to SIGKILL
 *   proc_restart — stop + start with the same command
 */
type Proc = {
  name: string; command: string; cwd?: string; host: boolean;
  child: ChildProcess; log: string; dropped: number; started: number; exit: number | null; ports: Set<number>;
};
const g = globalThis as unknown as { __procs?: Map<string, Proc> };
const procs: Map<string, Proc> = (g.__procs ??= new Map());
const MAX_LOG = 200_000;

const PORT_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]|https?:\/\/[\w.-]+):(\d{2,5})\b|\bport\s+(\d{2,5})\b/gi;
function scanPorts(p: Proc, chunk: string) {
  for (const m of chunk.matchAll(PORT_RE)) { const n = Number(m[1] || m[2]); if (n > 0 && n < 65536) p.ports.add(n); }
}
const tail = (p: Proc, n: number) => p.log.split("\n").slice(-n).join("\n").trim();
const status = (p: Proc) => `${p.name}: ${p.exit === null ? "running" : `exited ${p.exit}`} · pid ${p.child.pid} · ${Math.round((Date.now() - p.started) / 1000)}s${p.ports.size ? ` · ports ${[...p.ports].join(",")}` : ""}${p.host ? " · host" : ""}`;

function killTree(p: Proc, sig: NodeJS.Signals) {
  try { if (p.child.pid) process.kill(-p.child.pid, sig); } catch { try { p.child.kill(sig); } catch {} }
}

export async function procStart(st: Settings, o: { name: string; command: string; cwd?: string; host?: boolean; wait?: number; env?: Record<string, string> }) {
  const name = (o.name || "proc").replace(/[^\w.-]/g, "-").slice(0, 40);
  const host = !!o.host;
  if (host && hostDenied(st)) return { ok: false, result: hostDenied(st)! };
  const old = procs.get(name);
  if (old && old.exit === null) return { ok: false, result: `${name} is already running (${status(old)}). Use proc_restart or another name.` };
  const cwd = o.cwd ? resolvePath(o.cwd, host ? st.access : "sandbox") : undefined;
  const sp = shellSpawn(st, o.command, host, cwd);
  if ("error" in sp) return { ok: false, result: sp.error! };
  // stdin stays open so proc_write can talk to the process later (repls, prompts, interactive CLIs)
  const child = spawn(sp.cmd, sp.args, { cwd: sp.cwd, env: { ...sp.env, ...o.env, FORCE_COLOR: "0", CI: "1", BROWSER: "none" }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const p: Proc = { name, command: o.command, cwd: o.cwd, host, child, log: "", dropped: 0, started: Date.now(), exit: null, ports: new Set() };
  const onData = (d: Buffer) => {
    // eslint-disable-next-line no-control-regex
    const s = d.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    p.log += s; scanPorts(p, s);
    if (p.log.length > MAX_LOG) { const cut = p.log.length - MAX_LOG * 0.8; p.dropped += cut; p.log = p.log.slice(cut); }
  };
  child.stdout!.on("data", onData); child.stderr!.on("data", onData);
  child.on("exit", (code, sig) => { p.exit = code ?? (sig ? 128 : 1); });
  child.on("error", (e) => { p.log += `\n${e}`; p.exit = 1; });
  procs.set(name, p);
  if (o.wait === undefined || o.wait > 0) await waitFor(p, { until: "port", timeout: Math.min(30, Math.max(1, o.wait ?? 4)) });
  let extra = "";
  const inUse = p.log.match(/EADDRINUSE[^\n]*?:(\d{2,5})|address already in use[^\n]*?:(\d{2,5})|port (\d{2,5}) is (?:already )?in use/i);
  if (inUse) { const port = Number(inUse[1] || inUse[2] || inUse[3]); const own = [...procs.values()].find((q) => q !== p && q.exit === null && q.ports.has(port)); extra = `\nport ${port} busy: ${own ? `held by your process "${own.name}" (proc_stop or proc_restart it)` : (await portOwner(port)) || "held by another program"}`; }
  return { ok: p.exit === null || p.exit === 0, result: `${status(p)}\n${tail(p, 25) || "(no output yet)"}${extra}` };
}

/** Block until the process exits, opens a port or prints something matching `pattern`. Bounded by timeout. */
async function waitFor(p: Proc, o: { until?: "exit" | "port" | "pattern"; pattern?: string; timeout: number }) {
  const t0 = Date.now(), ports0 = p.ports.size;
  let re: RegExp | null = null;
  if (o.pattern) { try { re = new RegExp(o.pattern, "i"); } catch { re = new RegExp(o.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); } }
  while (Date.now() - t0 < o.timeout * 1000) {
    if (p.exit !== null) return "exited";
    if (o.until === "port" && p.ports.size > ports0) return "port";
    // a pattern already in the backlog satisfies "wait until it prints X" — match the whole retained log
    if (re && re.test(p.log)) return "pattern";
    await new Promise((r) => setTimeout(r, 250));
  }
  return "timeout";
}

export async function procLogs(o: { name?: string; tail?: number; wait_for?: "exit" | "port" | "pattern"; pattern?: string; timeout?: number; grep?: string }) {
  if (!o.name) return { ok: true, result: procs.size ? [...procs.values()].map(status).join("\n") : "no processes" };
  const p = procs.get(o.name);
  if (!p) return { ok: false, result: `no process "${o.name}". Running: ${[...procs.keys()].join(", ") || "none"}` };
  let waited = "";
  if (o.wait_for || o.pattern) waited = await waitFor(p, { until: o.wait_for || "pattern", pattern: o.pattern, timeout: Math.min(180, Math.max(1, o.timeout ?? 60)) });
  let body = tail(p, Math.min(400, Math.max(5, o.tail ?? 60)));
  if (o.grep) { try { const r = new RegExp(o.grep, "i"); body = p.log.split("\n").filter((l) => r.test(l)).slice(-80).join("\n") || "(no matching lines)"; } catch {} }
  return { ok: true, result: `${status(p)}${waited ? ` · wait: ${waited}` : ""}\n${body}` };
}

/** Dedicated bounded wait: "pause until the process exits / listens / prints X, at most N seconds". */
export async function procWait(o: { name: string; until?: "exit" | "port" | "pattern"; pattern?: string; timeout?: number }) {
  const p = procs.get(o.name);
  if (!p) return { ok: false, result: `no process "${o.name}". Running: ${[...procs.keys()].join(", ") || "none"}` };
  const until = o.until || "exit";
  if (until === "pattern" && !o.pattern) return { ok: false, result: "until=pattern needs a pattern." };
  if (p.exit !== null) return { ok: true, result: `${status(p)} — already exited.` };
  const w = await waitFor(p, { until, pattern: o.pattern, timeout: Math.min(600, Math.max(1, o.timeout ?? 30)) });
  const outcome = w === "timeout"
    ? `still waiting after ${Math.min(600, Math.max(1, o.timeout ?? 30))}s (${until}${o.pattern && until === "pattern" ? ` "${o.pattern}"` : ""}); it may need more time — call proc_wait again or read proc_logs`
    : `${until} reached`;
  return { ok: w !== "timeout", result: `${status(p)}\n${outcome}\n${tail(p, 12) || "(no output)"}` };
}

/** Write to a live process's stdin: answer a prompt, feed a repl, run a command in an interactive shell. */
export function procWrite(o: { name: string; input: string; newline?: boolean }) {
  const p = procs.get(o.name);
  if (!p) return { ok: false, result: `no process "${o.name}". Running: ${[...procs.keys()].join(", ") || "none"}` };
  if (p.exit !== null) return { ok: false, result: `${p.name} exited ${p.exit}; stdin is closed.` };
  try { p.child.stdin!.write(o.input + (o.newline === false ? "" : "\n")); return { ok: true, result: `wrote ${JSON.stringify(o.input + (o.newline === false ? "" : "\n"))} to ${p.name}. Give it a moment, then proc_logs to see the effect.` }; }
  catch (e) { return { ok: false, result: "write failed: " + (e instanceof Error ? e.message : String(e)) }; }
}

/** Send an arbitrary signal (SIGTERM/SIGKILL belong to proc_stop): SIGHUP reloads, SIGUSR1/2 dump state, … */
const SIGNALS = new Set(["SIGHUP", "SIGINT", "SIGQUIT", "SIGUSR1", "SIGUSR2", "SIGTERM", "SIGCONT", "SIGSTOP", "SIGTSTP", "SIGTTIN", "SIGTTOU"]);
export function procSignal(o: { name: string; signal: string }) {
  const p = procs.get(o.name);
  if (!p) return { ok: false, result: `no process "${o.name}"` };
  if (p.exit !== null) return { ok: false, result: `${p.name} already exited ${p.exit}.` };
  const sig = String(o.signal || "").toUpperCase().replace(/^(?!SIG)/, "SIG");
  if (!SIGNALS.has(sig)) return { ok: false, result: `unknown signal "${o.signal}" (allowed: ${[...SIGNALS].join(", ")})` };
  try { if (p.child.pid) process.kill(-p.child.pid, sig as NodeJS.Signals); } catch { try { p.child.kill(sig as NodeJS.Signals); } catch { return { ok: false, result: `could not signal ${p.name}` }; } }
  return { ok: true, result: `sent ${sig} to ${p.name}. proc_logs to see the effect.` };
}

export async function procStop(name: string, sig: NodeJS.Signals = "SIGTERM") {
  const p = procs.get(name);
  if (!p) return { ok: false, result: `no process "${name}"` };
  if (p.exit === null) {
    killTree(p, sig);
    for (let i = 0; i < 20 && p.exit === null; i++) await new Promise((r) => setTimeout(r, 150));
    if (p.exit === null) killTree(p, "SIGKILL");
  }
  procs.delete(name);
  return { ok: true, result: `stopped ${name}\n${tail(p, 8)}` };
}

export async function procRestart(st: Settings, name: string, wait?: number) {
  const p = procs.get(name);
  if (!p) return { ok: false, result: `no process "${name}"` };
  await procStop(name);
  return procStart(st, { name, command: p.command, cwd: p.cwd, host: p.host, wait });
}

/** What the UI (input-bar process strip, terminal canvas) needs per process. */
export const procList = () => [...procs.values()].map((p) => ({
  name: p.name, running: p.exit === null, exit: p.exit, ports: [...p.ports], host: p.host,
  command: p.command, cwd: p.cwd, started: p.started, pid: p.child.pid || 0, tail: tail(p, 14),
}));

export const procLogOf = (name: string) => { const p = procs.get(name); return p ? { ok: true, log: p.log, status: status(p), running: p.exit === null } : { ok: false, log: "", status: `no process "${name}"`, running: false }; };

/** Who listens on a port (for EADDRINUSE diagnostics). */
export function portOwner(port: number): Promise<string> {
  return new Promise((res) => execFile("bash", ["-lc", `(ss -ltnpH "sport = :${port}" 2>/dev/null || lsof -iTCP:${port} -sTCP:LISTEN -n -P 2>/dev/null) | head -3`], { timeout: 4000 }, (_e, out) => res(String(out || "").trim())));
}

for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => { for (const p of procs.values()) if (p.exit === null) killTree(p, "SIGTERM"); if (sig !== "exit") process.exit(0); });
}
