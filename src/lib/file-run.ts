/* Run a workspace file the way the canvas Run button does: the same language table decides the
   command, the same sandbox runs it, and every run is remembered so the user's terminal and the
   model see the same thing.

   The canvas (editor footer) and the agent tool `file_run` share this module: a run started from
   the UI is visible to the model via `file_runs`, so the assistant can look at what the user built
   and ran instead of asking them to paste an error. Nothing here touches host access — a file run
   is always the app's sandbox. */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { WS, resolvePath } from "./workspace";
import { RUN_LANGS, type RunLang, runLangOf } from "./run-langs";
import { runShell, type IO } from "./exec";
import type { Settings } from "./settings";

export type Runner = RunLang & { cmd: (v: { file: string; dir: string; base: string; noext: string; out: string }) => string };

const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const out = (name: string) => `/tmp/run-${name}-${process.pid}`;

/** How each runnable language is invoked. Keys must match RUN_LANGS (checked below). */
const CMD: Record<string, Runner["cmd"]> = {
  py: ({ file }) => `python3 ${shq(file)}`,
  pyw: ({ file }) => `python3 ${shq(file)}`,
  js: ({ file }) => `node ${shq(file)}`,
  mjs: ({ file }) => `node ${shq(file)}`,
  cjs: ({ file }) => `node ${shq(file)}`,
  ts: ({ file }) => `node --experimental-strip-types ${shq(file)}`,
  mts: ({ file }) => `node --experimental-strip-types ${shq(file)}`,
  sh: ({ file }) => `bash ${shq(file)}`,
  bash: ({ file }) => `bash ${shq(file)}`,
  rb: ({ file }) => `ruby ${shq(file)}`,
  php: ({ file }) => `php ${shq(file)}`,
  lua: ({ file }) => `lua ${shq(file)}`,
  pl: ({ file }) => `perl ${shq(file)}`,
  go: ({ dir, base }) => (fs.existsSync(path.join(dir, "go.mod")) ? `go run .` : `go run ${shq(base)}`),
  c: ({ file, out: o }) => `cc -O2 -o ${shq(o)} ${shq(file)} && ${shq(o)}`,
  h: ({ file, out: o }) => `cc -O2 -o ${shq(o)} ${shq(file)} && ${shq(o)}`,
  cpp: ({ file, out: o }) => `c++ -O2 -std=c++17 -o ${shq(o)} ${shq(file)} && ${shq(o)}`,
  cc: ({ file, out: o }) => `c++ -O2 -std=c++17 -o ${shq(o)} ${shq(file)} && ${shq(o)}`,
  cxx: ({ file, out: o }) => `c++ -O2 -std=c++17 -o ${shq(o)} ${shq(file)} && ${shq(o)}`,
  rs: ({ dir, file, out: o }) => (fs.existsSync(path.join(dir, "Cargo.toml")) ? `cargo run --quiet` : `rustc -O -o ${shq(o)} ${shq(file)} && ${shq(o)}`),
  java: ({ file, noext, out: o }) => `javac -d ${shq(o)} ${shq(file)} && java -cp ${shq(o)} ${shq(noext)}`,
  kt: ({ file, noext, out: o }) => `kotlinc ${shq(file)} -include-runtime -d ${shq(o + ".jar")} && java -jar ${shq(o + ".jar")} ${shq(noext)}`,
  swift: ({ file }) => `swift ${shq(file)}`,
  cs: ({ dir }) => `dotnet run --project ${shq(dir)}`,
};

/** One table for both entry points, so the canvas and the model never disagree about how a file runs. */
export const RUNNERS: Record<string, Runner> = Object.fromEntries(
  Object.entries(RUN_LANGS).filter(([ext]) => CMD[ext]).map(([ext, meta]) => [ext, { ...meta, cmd: CMD[ext] }]),
) as Record<string, Runner>;

export const runnerFor = (p: string): Runner | null => {
  const meta = runLangOf(p);
  return meta ? RUNNERS[path.extname(p).slice(1).toLowerCase()] || { ...meta, cmd: () => "" } : null;
};
export { runnablePath } from "./run-langs";

const which = (bin: string) => {
  try { return spawnSync("bash", ["-lc", `command -v ${bin}`], { encoding: "utf8", timeout: 4000 }).status === 0; } catch { return false; }
};

export type FileRun = {
  id: number; path: string; dir: string; cmd: string; lang: string;
  code: number; ms: number; at: number; out: string; ok: boolean; error?: string;
};

const g = globalThis as unknown as { __fileRuns?: { seq: number; list: FileRun[] } };
const store = (g.__fileRuns ||= { seq: 0, list: [] });
const MAX_OUT = 24_000;

export const recordRun = (r: FileRun) => {
  store.seq += 1;
  r.id = store.seq;
  store.list.unshift(r);
  if (store.list.length > 40) store.list.length = 40;
  return r;
};
export const recentRuns = (p?: string, limit = 8) => {
  const want = p ? p.replace(/^\.?\//, "") : "";
  return store.list.filter((r) => !want || r.path === want || r.path.endsWith("/" + want)).slice(0, Math.max(1, Math.min(20, limit)));
};

export type RunOptions = {
  /** unsaved editor buffer: written first, so Run always executes what the user is looking at */
  content?: string;
  args?: string;
  timeout?: number;
} & IO;

/**
 * Run one workspace file in the sandbox. Returns the same shape the canvas drawer renders, and
 * records the run for `file_runs`.
 */
export async function runFile(settings: Settings, p: string, o: RunOptions = {}): Promise<FileRun & { out: string }> {
  const abs = resolvePath(p, "sandbox");
  const rel = abs.startsWith(WS) ? abs.slice(WS.length).replace(/^\//, "") : p;
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const noext = base.replace(/\.[^.]+$/, "");
  const started = Date.now();
  const fail = (error: string): FileRun => recordRun({ id: 0, path: rel, dir, cmd: "", lang: "", code: 1, ms: 0, at: started, out: error, ok: false, error });

  if (o.content !== undefined) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(abs, o.content, "utf8"); }
    catch (e) { return fail(`could not save ${rel}: ${e instanceof Error ? e.message : e}`); }
  }
  if (!fs.existsSync(abs)) return fail(`${rel} does not exist.`);

  const runner = runnerFor(abs);
  if (!runner) {
    const ext = path.extname(abs).slice(1) || "(no extension)";
    return fail(`no runner for .${ext}. Executable sources (python, js, ts, bash, c, c++, rust, go, java, ruby, php, lua, perl, swift, kotlin) run here; open .html/.md/.ui in a preview instead.`);
  }
  if (!which(runner.needs)) return fail(`${runner.needs} is not installed in the sandbox, so ${rel} cannot run.${runner.compile ? " Install a compiler in Settings → Access → Setup, or rewrite the check to run in Python." : ""}`);

  const command = runner.cmd({ file: base, dir, base, noext, out: out(noext || "a") });
  const full = o.args ? `${command} ${o.args}` : command;
  const res = await runShell(settings, full, Math.min(300_000, Math.max(2_000, (o.timeout || 60) * 1000)), false, dir, { onData: o.onData, signal: o.signal });
  return recordRun({
    id: 0, path: rel, dir, cmd: full, lang: runner.lang,
    code: res.code, ms: Date.now() - started, at: started, out: res.out.slice(-MAX_OUT), ok: res.code === 0,
  }) as FileRun & { out: string };
}

/** Compact text for the model: command, exit, output tail. */
export function runText(r: FileRun) {
  return `${r.path} · ${r.cmd || r.lang}\nexit ${r.code} · ${(r.ms / 1000).toFixed(1)}s\n${r.out.slice(-6000)}`;
}
