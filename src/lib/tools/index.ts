import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { spawn } from "child_process";
import { WS, resolvePath, rel, tree, Node, mimeOf, isImage, readText } from "../workspace";
import type { Settings } from "../settings";
import { searchCatalog } from "../blocks/catalog";
import { callMcp } from "../mcp";
import { runShell, runPython as execPython, pipInstall, hostDenied, usesSudo, sudoNeedsPassword, sudoPassword, sudoWait } from "../exec";
import { youtubeId } from "../shared";
import { firecrawlScrape, firecrawlSearch, firecrawlExtract } from "../web";
import { applyEdits, insertLines, snippet, hasPlaceholder, Edit } from "./edit";
import { syntaxError } from "./syntax";
import { procStart, procLogs, procStop, procRestart } from "../procs";
import { browse, Step } from "../browser";
import { runChecks, lintFiles } from "../harness/check";
import { findSkill, skillMeta, skillFiles } from "../skills";
import { destructive, checkInstalls } from "../harness/guard";
import { createHash } from "crypto";
import os from "os";

export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
const T = (name: string, description: string, props: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
  type: "function", function: { name, description, parameters: { type: "object", properties: props, required } },
});
const s = (d?: string) => ({ type: "string", ...(d ? { description: d } : {}) });
const n = (d?: string) => ({ type: "number", ...(d ? { description: d } : {}) });
const b = (d?: string) => ({ type: "boolean", ...(d ? { description: d } : {}) });
const arr = (items: Record<string, unknown>, d?: string) => ({ type: "array", items, ...(d ? { description: d } : {}) });

export type Pack = "dev";
export type TodoItem = { text: string; status: "todo" | "doing" | "done" };
export type ConvState = { packs?: Pack[]; todo?: TodoItem[]; approved?: string[] };

/**
 * Tool sets. Descriptions are terse because schemas ride along on every request; behaviour details live in
 * SYSTEM.md and skills. Core is always on; `host_shell` only exists while the user enables Host terminal;
 * the dev pack (processes, browser, checks) loads when a skill that declares `tools: dev` is opened, or always
 * when the context window is large (Settings → Tools → Tool loading).
 */
export function toolDefs(st: Settings, packs: Pack[]): ToolDef[] {
  const host = st.terminal === "host";
  const hostArg = host ? { host: b("run on the user's machine (host terminal) instead of your sandbox") } : {};
  const core: ToolDef[] = [
    T("skill_open", "Load a skill's instructions, or one of its reference files", { name: s(), file: s("reference file inside the skill, e.g. reference/android.md") }, ["name"]),
    T("context_add", "Pin a file into context", { path: s() }, ["path"]),
    T("context_remove", "Unpin a file from context", { path: s() }, ["path"]),
    T("compact_context", "Free context. tools=fold old tool outputs; web=old web results to key facts; history=summarise all but last keep_last messages", { scope: { type: "string", enum: ["tools", "web", "history"] }, keep_last: n() }),
    T("fs_list", "List a directory", { path: s(), depth: n("1-3, default 1") }),
    T("fs_read", "Read a file with line numbers (250 lines per call; pdf/docx/xlsx/pptx as text)", { path: s(), start: n(), end: n() }, ["path"]),
    T("fs_search", "Search file contents (regex; ripgrep). Returns path:line: text", { pattern: s(), path: s("dir or file, default workspace"), glob: s("e.g. *.ts"), literal: b() }, ["pattern"]),
    T("fs_write", "Create a file or replace it entirely. Existing files: fs_read first; prefer fs_edit for changes", { path: s(), content: s(), mode: { type: "string", enum: ["overwrite", "append"] } }, ["path", "content"]),
    T("fs_edit", "Replace exact text. find must match the file (copy from fs_read without line numbers) and be unique unless all=true. Several edits apply atomically", { path: s(), find: s(), replace: s(), all: b(), edits: arr({ type: "object", properties: { find: s(), replace: s(), all: b() }, required: ["find", "replace"] }, "multiple edits in one call") }, ["path"]),
    T("fs_insert", "Insert lines after line N (0 = top, -1 = end) without matching text", { path: s(), line: n(), text: s() }, ["path", "line", "text"]),
    T("fs_move", "Move/rename. Into a folder: end `to` with /. Refuses to replace an existing file unless overwrite=true", { from: s(), to: s(), overwrite: b() }, ["from", "to"]),
    T("fs_delete", "Delete file or dir (goes to trash; recoverable)", { path: s() }, ["path"]),
    T("run_python", "Run python3 in your sandbox, cwd=workspace", { code: s(), timeout: n("seconds, default 120, max 600") }, ["code"]),
    T("pip_install", "Install python packages for run_python", { packages: arr({ type: "string" }) }, ["packages"]),
    T("shell", "Run bash in YOUR sandbox (cwd=workspace). Not the user's machine", { command: s(), timeout: n("seconds, default 120, max 600"), cwd: s() }, ["command"]),
    ...(host ? [T("host_shell", "Run bash on the USER'S machine as the user (their tools, logins, files). State what you run", { command: s(), timeout: n("seconds, default 120, max 1800"), cwd: s() }, ["command"])] : []),
    T("web_search", "Search the web", { query: s(), limit: n() }, ["query"]),
    T("web_fetch", "Fetch a URL as markdown", { url: s() }, ["url"]),
    ...(st.firecrawlKey ? [T("web_extract", "Extract structured data from a page (Firecrawl AI)", { url: s(), prompt: s("what to extract") }, ["url", "prompt"])] : []),
    T("view_image", "Look at an image (workspace path or URL)", { path: s() }, ["path"]),
    T("todo", "Set the task checklist shown to the user (full list each call). Use for tasks with 3+ steps", { items: arr({ type: "object", properties: { text: s(), status: { type: "string", enum: ["todo", "doing", "done"] } }, required: ["text", "status"] }) }, ["items"]),
    T("ask_user", "Ask the user to choose; ends your turn", { question: s(), options: arr({ type: "string" }), multi: b() }, ["question", "options"]),
    T("canvas_open", "Show a workspace file, web page or YouTube URL in a canvas window", { target: s("path or URL"), title: s(), dock: b("dock beside chat") }, ["target"]),
    T("ui_search", "Find BlocksUI components", { query: s() }, ["query"]),
  ];
  const dev: ToolDef[] = [
    T("proc_start", "Start a long-running process (dev server, watcher) in the background", { name: s(), command: s(), cwd: s(), wait: n("seconds to wait for a port, default 4"), ...hostArg }, ["name", "command"]),
    T("proc_logs", "Process output/status. No name = list. wait_for blocks until port/pattern/exit", { name: s(), tail: n(), grep: s(), wait_for: { type: "string", enum: ["port", "pattern", "exit"] }, pattern: s(), timeout: n() }),
    T("proc_restart", "Restart a process with the same command", { name: s(), wait: n() }, ["name"]),
    T("proc_stop", "Stop a process", { name: s() }, ["name"]),
    T("browser", "Open URL or workspace page (.html/.ui/dir) headless; returns screenshot + console errors + text", { target: s(), steps: arr({ type: "object", properties: { click: s(), type: s(), text: s(), press: s(), wait: { type: ["number", "string"] }, eval: s(), scroll: n(), hover: s(), select: s(), value: s() } }, "actions in order"), width: n(), height: n(), full: b("full page"), theme: { type: "string", enum: ["light", "dark"] } }, ["target"]),
    T("check", "Verify work: project dir → types/lint/tests/build; UI file or dir → design lint + screenshot", { path: s(), run: { type: "string", enum: ["all", "types", "lint", "test", "build", "ui"] }, ...hostArg }, ["path"]),
  ];
  return [...core, ...(packs.includes("dev") ? dev : [])];
}

export type ToolCtx = {
  settings: Settings; conversationId: string; pinned: string[]; emit: (e: Record<string, unknown>) => void;
  setPinned: (p: string[]) => Promise<void>; compact: (scope?: string, keepLast?: number) => Promise<string>;
  state: ConvState; setState: (s: ConvState) => Promise<void>;
  /** id of the tool call currently running — long tools stream their raw output with it. */
  toolId?: string;
};
/** Live output for the running tool call: raw text the user can watch while the command works. */
const liveOut = (ctx: ToolCtx) => (d: string) => { if (ctx.toolId) ctx.emit({ t: "toolOut", id: ctx.toolId, d }); };
export type ToolOut = { result: string; ok: boolean; meta?: unknown; images?: string[]; stop?: boolean };

export const approvalHash = (cmd: string, host: boolean) => createHash("sha1").update(`${host ? "host" : "sandbox"}\0${cmd.trim()}`).digest("hex").slice(0, 16);
/**
 * Destructive or risky actions need one click from the user. Returns null when this exact command was approved
 * (the approval is consumed), otherwise a stop result the UI renders with Approve / Deny. Enforced here, not in the prompt.
 */
async function approvalGate(ctx: ToolCtx, cmd: string, reason: string, host: boolean): Promise<ToolOut | null> {
  const hash = approvalHash(cmd, host);
  const ok = ctx.state.approved || [];
  if (ok.includes(hash)) { await ctx.setState({ ...ctx.state, approved: ok.filter((h) => h !== hash) }); return null; }
  return { ok: false, stop: true, result: `Not run: needs the user's approval (${reason}). The user sees Approve / Deny. Stop here and wait; if approved, run exactly the same command again.`, meta: { approval: { cmd, hash, reason, host } } };
}

/** Recoverable delete: workspace files → workspace/.trash, others → the desktop trash (freedesktop / macOS). */
// paths built with Array.join: path.join here makes the bundler trace the project folder (see workspace.ts)
async function trash(abs: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let dir: string, label: string;
  if (abs.startsWith(WS + path.sep)) { dir = [WS, ".trash"].join("/"); label = ".trash/"; }
  else if (process.platform === "darwin") { dir = [os.homedir(), ".Trash"].join("/"); label = "the Trash"; }
  else { dir = [process.env.XDG_DATA_HOME || [os.homedir(), ".local/share"].join("/"), "Trash/files"].join("/"); label = "the Trash"; }
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(abs);
  const dest = [dir, `${base}.${stamp}`].join("/");
  await fs.rename(abs, dest).catch(async (e) => { if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e; await fs.cp(abs, dest, { recursive: true }); await fs.rm(abs, { recursive: true, force: true }); });
  if (label === "the Trash" && process.platform !== "darwin") {
    const info = dir.replace(/files$/, "info"); // not path.dirname: the bundler would trace it to the project root
    await fs.mkdir(info, { recursive: true });
    await fs.writeFile([info, `${base}.${stamp}.trashinfo`].join("/"), `[Trash Info]\nPath=${encodeURI(abs)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`).catch(() => {});
  }
  return label === ".trash/" ? `.trash/${path.basename(dest)}` : label;
}

const cut = (x: string, max = 8000) => (x.length > max ? x.slice(0, max) + `\n… (${x.length - max} more chars)` : x);

/** Server-side python for Blocks `py()` helper (always sandboxed). */
export const runPython = (code: string, st: Settings | null = null) => execPython(st, code);

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "target", ".venv", "__pycache__", ".cache", ".gradle"]);
async function listText(abs: string, depth: number, ind = ""): Promise<string> {
  const nodes: Node[] = await tree(abs, 1);
  let out = "";
  for (const x of nodes.slice(0, 300)) {
    out += `${ind}${x.name}${x.dir ? "/" : ` (${x.size ?? 0}b)`}\n`;
    if (x.dir && depth > 1 && !SKIP.has(x.name)) out += await listText(path.join(abs, x.name), depth - 1, ind + "  ");
  }
  return out;
}

/** Per-conversation read ledger: fs_write refuses to clobber a file the model never looked at. */
const g = globalThis as unknown as { __reads?: Map<string, Map<string, number>> };
const reads = (g.__reads ??= new Map());
const ledger = (conv: string) => { let m = reads.get(conv); if (!m) reads.set(conv, (m = new Map())); return m; };
const mtime = (abs: string) => { try { return fss.statSync(abs).mtimeMs; } catch { return 0; } };

function rg(args: string[], cwd: string): Promise<string> {
  return new Promise((res) => {
    const bin = fss.existsSync("/usr/bin/rg") || fss.existsSync("/opt/homebrew/bin/rg") || fss.existsSync("/usr/local/bin/rg") ? "rg" : null;
    const p = bin ? spawn("rg", args, { cwd }) : spawn("grep", ["-rnI", "--exclude-dir=node_modules", "--exclude-dir=.git", ...args.filter((a) => !a.startsWith("--") && a !== "-n")], { cwd });
    let out = ""; const t = setTimeout(() => p.kill("SIGKILL"), 20000);
    p.stdout.on("data", (d) => { if (out.length < 200000) out += d; });
    p.on("close", () => { clearTimeout(t); res(out); });
    p.on("error", () => { clearTimeout(t); res(""); });
  });
}

const renderTodo = (items: TodoItem[]) => items.map((i) => `${i.status === "done" ? "[x]" : i.status === "doing" ? "[>]" : "[ ]"} ${i.text}`).join("\n");
export const todoReminder = (items?: TodoItem[]) => {
  if (!items?.length) return "";
  const done = items.filter((i) => i.status === "done").length;
  if (done === items.length) return "";
  const next = items.find((i) => i.status === "doing") || items.find((i) => i.status === "todo");
  return `\n[todo ${done}/${items.length}${next ? ` · now: ${next.text}` : ""}]`;
};

async function guardAndWrite(f: string, before: string, after: string, spans: [number, number][], notes: string[] = []) {
  const was = syntaxError(f, before), now = syntaxError(f, after);
  if (now && !was) return { ok: false, result: `Rejected: the edit would break syntax (${now}). File unchanged. Result would have been:\n${snippet(after, spans, 2, 30)}` };
  await fs.writeFile(f, after);
  const warn = now ? `\nwarning: file still has a syntax error (${now})` : "";
  return { ok: true, result: `${notes.length ? notes.join("; ") + "\n" : ""}${snippet(after, spans)}${warn}` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function execTool(name: string, a: Record<string, any>, ctx: ToolCtx): Promise<ToolOut> {
  const st = ctx.settings;
  const P = (p: string) => resolvePath(String(p ?? "."), st.access);
  try {
    switch (name) {
      case "skill_open": {
        const sk = await findSkill(String(a.name || ""));
        if (!sk) return { ok: false, result: `No skill "${a.name}". See the Skills list.` };
        const meta = skillMeta(sk.text);
        if (meta.requires === "host-terminal" && st.terminal !== "host") return { ok: false, result: "This skill needs Host terminal (Settings → Access)." };
        if (meta.requires === "host-files" && st.access === "sandbox") return { ok: false, result: "This skill needs Home folder access (Settings → Access)." };
        if (a.file) {
          const f = path.resolve(sk.dir, String(a.file));
          if (!f.startsWith(sk.dir + path.sep)) return { ok: false, result: "file must be inside the skill" };
          return { ok: true, result: cut(await fs.readFile(f, "utf8"), 24000) };
        }
        let extra = "";
        const packs = (meta.tools || "").split(/[\s,]+/).filter((p): p is Pack => p === "dev");
        const add = packs.filter((p) => !(ctx.state.packs || []).includes(p));
        if (add.length) { await ctx.setState({ ...ctx.state, packs: [...(ctx.state.packs || []), ...add] }); extra += `\n\n(Enabled tools: proc_start proc_logs proc_restart proc_stop browser check)`; }
        const files = await skillFiles(sk.dir);
        if (files.length) extra += `\n\nReference files (skill_open name="${sk.name}" file=…): ${files.join(", ")}`;
        return { ok: true, result: sk.text.replace(/^---[\s\S]*?---\n/, "") + extra };
      }
      case "context_add": {
        const p = rel(P(a.path)); await fs.access(P(a.path));
        if (!ctx.pinned.includes(p)) await ctx.setPinned([...ctx.pinned, p]);
        return { ok: true, result: `Added ${p}; content visible from next step.` };
      }
      case "context_remove": { await ctx.setPinned(ctx.pinned.filter((x) => x !== a.path)); return { ok: true, result: "Removed " + a.path }; }
      case "compact_context": return { ok: true, result: await ctx.compact(a.scope || "history", Number(a.keep_last) || undefined) };
      case "fs_list": return { ok: true, result: cut((await listText(P(a.path || "."), Math.min(3, Math.max(1, Number(a.depth) || 1)))) || "(empty)") };
      case "fs_read": {
        const f = P(a.path);
        if (isImage(f)) return { ok: true, result: "Image file. Use view_image to look at it." };
        const ext = path.extname(f).slice(1).toLowerCase();
        const raw = ["pdf", "docx", "pptx", "xlsx", "xls"].includes(ext) ? await readText(f, 400000) : await fs.readFile(f, "utf8");
        if (raw.startsWith("(binary file)")) return { ok: false, result: "Binary file; not readable as text." };
        const lines = raw.split("\n");
        const s0 = Math.max(1, Number(a.start) || 1), e0 = Math.min(lines.length, Number(a.end) || s0 + 249);
        ledger(ctx.conversationId).set(f, mtime(f));
        const head = `${a.path} · ${lines.length} lines${s0 > 1 || e0 < lines.length ? ` · showing ${s0}-${e0}` : ""}\n`;
        const more = e0 < lines.length ? `\n… more: start=${e0 + 1}` : "";
        return { ok: true, result: cut(head + lines.slice(s0 - 1, e0).map((l, i) => `${s0 + i}\t${l.length > 400 ? l.slice(0, 400) + "…" : l}`).join("\n") + more, 20000) };
      }
      case "fs_search": {
        const root = P(a.path || ".");
        const isFile = fss.existsSync(root) && fss.statSync(root).isFile();
        const args = ["-n", "--no-heading", "--color=never", "-M", "240", "--max-columns-preview", "-m", "20", ...(a.literal ? ["-F"] : []), ...(a.glob ? ["-g", String(a.glob)] : []), "-g", "!node_modules", "-g", "!.git", "-g", "!.next", "-g", "!dist", "-g", "!*.lock", "-g", "!package-lock.json", "--", String(a.pattern), isFile ? path.basename(root) : "."];
        const out = await rg(args, isFile ? path.dirname(root) : root);
        const lines = out.split("\n").filter(Boolean);
        if (!lines.length) return { ok: true, result: "no matches" };
        const shown = lines.slice(0, 60).map((l) => l.replace(/^\.\//, ""));
        const files = new Set(lines.map((l) => l.split(":")[0]));
        return { ok: true, result: shown.join("\n") + (lines.length > 60 ? `\n… ${lines.length} matches in ${files.size} files; narrow with path/glob` : "") };
      }
      case "fs_write": {
        const f = P(a.path), content = String(a.content ?? "");
        await fs.mkdir(path.dirname(f), { recursive: true });
        let before = "", exists = false;
        try { before = await fs.readFile(f, "utf8"); exists = true; } catch {}
        const L = ledger(ctx.conversationId);
        if (a.mode === "append") { await fs.appendFile(f, (before && !before.endsWith("\n") ? "\n" : "") + content); L.set(f, mtime(f)); return { ok: true, result: `Appended to ${a.path}`, meta: { path: a.path, before: "", after: content.slice(0, 20000) } }; }
        if (exists && before.trim() && !L.has(f) && before !== content) return { ok: false, result: `${a.path} exists (${before.split("\n").length} lines) and you have not read it in this chat. fs_read it first, then fs_edit (or fs_write again to replace it).` , meta: { path: a.path } };
        if (exists && hasPlaceholder(content, before)) return { ok: false, result: "content contains an elision placeholder (\"... rest of code\"); writing it would delete code. Write the full file or use fs_edit." };
        await fs.writeFile(f, content); L.set(f, mtime(f));
        const syn = syntaxError(f, content);
        return { ok: true, result: `Wrote ${a.path} (${content.split("\n").length} lines)${syn ? `\nwarning: syntax error ${syn}` : ""}`, meta: { path: a.path, before: before.slice(0, 20000), after: content.slice(0, 20000) } };
      }
      case "fs_edit": {
        const f = P(a.path);
        const src = await fs.readFile(f, "utf8");
        const one = (x: Record<string, unknown>): Edit => ({ find: String(x.find ?? x.old_string ?? x.search ?? x.old ?? ""), replace: String(x.replace ?? x.new_string ?? x.new ?? ""), all: !!(x.all ?? x.replace_all) });
        const edits: Edit[] = Array.isArray(a.edits) && a.edits.length ? a.edits.map(one) : [one(a)];
        const r = applyEdits(src, edits);
        if (!r.ok) return { ok: false, result: r.error };
        const L = ledger(ctx.conversationId);
        const stale = L.has(f) && L.get(f) !== mtime(f) ? ["note: file changed on disk since you read it"] : [];
        const out = await guardAndWrite(f, src, r.text, r.changed, [...stale, ...r.notes]);
        if (out.ok) L.set(f, mtime(f));
        return { ...out, result: out.ok ? `Edited ${a.path}\n${out.result}` : out.result, meta: { path: a.path, before: edits.map((e) => e.find).join("\n…\n"), after: edits.map((e) => e.replace).join("\n…\n") } };
      }
      case "fs_insert": {
        const f = P(a.path);
        let src = ""; try { src = await fs.readFile(f, "utf8"); } catch { await fs.mkdir(path.dirname(f), { recursive: true }); }
        const r = insertLines(src, Number(a.line ?? -1), String(a.text ?? ""));
        const out = await guardAndWrite(f, src, r.text, [r.span]);
        if (out.ok) ledger(ctx.conversationId).set(f, mtime(f));
        return { ...out, result: out.ok ? `Inserted ${r.span[1] - r.span[0] + 1} lines into ${a.path}\n${out.result}` : out.result, meta: { path: a.path, before: "", after: String(a.text ?? "") } };
      }
      case "fs_delete": {
        const f = P(a.path);
        if (f === WS || f === os.homedir() || f === "/") return { ok: false, result: `Refusing to delete ${a.path}.` };
        await fs.lstat(f).catch(() => { throw new Error(`${a.path} does not exist`); });
        const where = await trash(f);
        return { ok: true, result: `Deleted ${a.path} (moved to ${where}; recoverable)` };
      }
      case "fs_move": {
        const from = P(a.from);
        await fs.lstat(from).catch(() => { throw new Error(`${a.from} does not exist`); });
        let to = P(a.to);
        const toStat = await fs.stat(to).catch(() => null);
        if (String(a.to).endsWith("/") || toStat?.isDirectory()) { await fs.mkdir(to, { recursive: true }); to = path.join(to, path.basename(from)); }
        if (to === from) return { ok: true, result: "Source and destination are the same" };
        const clash = await fs.lstat(to).catch(() => null);
        if (clash && !a.overwrite) return { ok: false, result: `${rel(to)} already exists; nothing moved. Pick another name, or pass overwrite=true to replace it.` };
        await fs.mkdir(path.dirname(to), { recursive: true });
        if (clash) await trash(to);
        await fs.rename(from, to).catch(async (e) => { if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e; await fs.cp(from, to, { recursive: true }); await fs.rm(from, { recursive: true, force: true }); });
        return { ok: true, result: `Moved ${rel(from)} → ${rel(to)}${clash ? " (replaced file moved to trash)" : ""}` };
      }
      case "run_python": {
        const r = await execPython(st, a.code, Math.min(600, Math.max(5, Number(a.timeout) || 120)) * 1000, liveOut(ctx));
        const plot = /matplotlib|pyplot|\bplt\./.test(String(a.code || ""));
        const hint = plot && !/savefig|\.png|\.svg|\.pdf|to_file|write_image/.test(String(a.code || ""))
          ? "\n(matplotlib was used for a chart the user only looks at. x-chart / x-graph / x-physics render natively in chat and stay interactive — use those unless a raster file is actually needed.)" : "";
        return { ok: r.code === 0, result: cut(r.out || "(no output)") + hint };
      }
      case "pip_install": {
        const pk = ([] as string[]).concat(a.packages).map(String);
        const chk = await checkInstalls(pk, "pypi");
        if (chk?.block) return { ok: false, result: chk.block };
        if (chk?.approve) { const gate = await approvalGate(ctx, `pip install ${pk.join(" ")}`, chk.approve, false); if (gate) return gate; }
        const r = await pipInstall(pk); return { ok: r.code === 0, result: cut(r.out || "installed", 3000) };
      }
      case "shell":
      case "host_shell": {
        const host = name === "host_shell";
        if (host && hostDenied(st)) return { ok: false, result: hostDenied(st)! };
        const cmd = String(a.command);
        const danger = destructive(cmd, host ? "host" : "sandbox");
        if (danger) { const gate = await approvalGate(ctx, cmd, danger.reason, host); if (gate) return gate; }
        const chk = await checkInstalls(cmd);
        if (chk?.block) return { ok: false, result: chk.block };
        if (chk?.approve) { const gate = await approvalGate(ctx, cmd, chk.approve, host); if (gate) return gate; }
        // sudo: the password is the user's. If we do not have one, ask in the tool row and wait.
        let pw = sudoPassword(st, ctx.conversationId);
        if (usesSudo(cmd) && !pw) {
          const why = sudoNeedsPassword(st, cmd, !host, ctx.conversationId);
          if (why === "sandbox") return { ok: false, result: "sudo is unavailable in the sandbox shell. Use host_shell (Settings → Access → Host terminal) for anything needing sudo." };
          ctx.emit({ t: "toolMeta", id: ctx.toolId || "", meta: { sudo: { cmd, reason: danger?.reason || "runs as root on your machine" } } });
          const typed = await sudoWait(ctx.toolId || "");
          if (!typed) return { ok: false, result: "Not run: no password was given. Ask the user to run it themselves, or to store SUDO_PASSWORD in Settings → Secrets.", meta: { sudo: { cancelled: true } } };
          pw = typed;
        }
        const cwd = a.cwd ? resolvePath(String(a.cwd), host ? st.access : "sandbox") : undefined;
        const r = await runShell(st, cmd, Math.min(host ? 1800 : 600, Math.max(5, Number(a.timeout) || 120)) * 1000, host, cwd, liveOut(ctx), pw);
        // a wrong password shows up as "Sorry, try again" — say so plainly instead of letting the model retry blindly
        const wrong = /Sorry, try again|incorrect password|not in the sudoers file|sudo: a password is required/.test(r.out);
        return { ok: r.code === 0 && !wrong, result: cut(`exit ${r.code}\n${r.out.trim() || "(no output)"}`) + (wrong ? "\n(The password was rejected — ask the user to check it.)" : ""), meta: { sudo: pw ? { used: true } : undefined } };
      }
      case "canvas_open": {
        const t = String(a.target || "").trim();
        const title = a.title ? String(a.title) : undefined;
        const yt = youtubeId(t);
        let spec: Record<string, unknown>;
        if (yt) spec = { kind: "youtube", id: yt, title: title || "YouTube" };
        else if (/\.(mp4|webm|mov|m4v|ogv)(\?\S*)?$/i.test(t)) spec = { kind: "media", url: t, video: true, title: title || "Video" };
        else if (/\.(mp3|wav|ogg|m4a|flac|aac|opus)(\?\S*)?$/i.test(t)) spec = { kind: "media", url: t, video: false, title: title || "Audio" };
        else if (/^https?:\/\//.test(t)) spec = { kind: "web", url: t, title: title || new URL(t).hostname };
        else { const abs = P(t); await fs.access(abs); spec = { kind: "file", path: rel(abs), title: title || path.basename(abs) }; }
        ctx.emit({ t: "canvas", spec, dock: !!a.dock });
        return { ok: true, result: `Opened ${spec.kind === "file" ? spec.path : t} in canvas` + (spec.kind === "file" ? ` (${mimeOf(t)})` : "") + (spec.kind === "media" ? " (plays in the canvas player)" : "") };
      }
      case "web_search": {
        const j = await firecrawlSearch(st, a.query, Math.min(Number(a.limit) || 5, 8));
        const items = ((j.data as { url: string; title?: string; description?: string }[]) || []).map((d) => ({ url: d.url, title: d.title || d.url, snippet: (d.description || "").slice(0, 240) }));
        return { ok: true, result: items.map((d, i) => `[${i + 1}] ${d.title}\n${d.url}\n${d.snippet}`).join("\n\n") || "no results", meta: { sources: items, source: j._source } };
      }
      case "web_fetch": {
        const j = await firecrawlScrape(st, a.url);
        const md = (j.data?.markdown as string) || "";
        return { ok: true, result: cut(md, 12000), meta: { sources: [{ url: a.url, title: j.data?.metadata?.title || a.url, snippet: md.slice(0, 200) }], source: j._source } };
      }
      case "web_extract": {
        const x = await firecrawlExtract(st, a.url, String(a.prompt));
        return { ok: true, result: cut(typeof x === "string" ? x : JSON.stringify(x, null, 2), 12000), meta: { sources: [{ url: a.url, title: a.url, snippet: "Structured extraction" }], source: "cloud" } };
      }
      case "view_image": {
        if (st.vision === false) return { ok: false, result: "The current model is set as text-only (Settings → Model → Vision)." };
        let p = String(a.path || "").trim();
        if (/^https?:\/\//.test(p)) {
          const r = await fetch(p, { signal: AbortSignal.timeout(20000) });
          const type = r.headers.get("content-type") || "";
          if (!r.ok || !type.startsWith("image/")) return { ok: false, result: `not an image (${r.status} ${type})` };
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 8e6) return { ok: false, result: "image larger than 8 MB" };
          const f = path.join(WS, ".cache/img", `web-${Date.now()}.${(type.split("/")[1] || "png").replace(/[^a-z]/g, "")}`);
          await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, buf); p = rel(f);
        } else {
          const f = P(p);
          if (!isImage(f)) return { ok: false, result: "not a raster image (png/jpg/gif/webp). For SVG, fs_read it or open it with browser." };
          await fs.access(f); p = rel(f);
        }
        return { ok: true, result: `Image attached below: ${p}`, images: [p], meta: { image: p } };
      }
      case "todo": {
        const items: TodoItem[] = (Array.isArray(a.items) ? a.items : String(a.items || "").split("\n").filter((l: string) => l.trim()).map((l: string) => ({ text: l.replace(/^\s*[-*]?\s*\[[ x>]\]\s*/i, ""), status: /\[x\]/i.test(l) ? "done" : /\[>\]/.test(l) ? "doing" : "todo" })))
          .map((i: Record<string, unknown>) => ({ text: String(i.text ?? i.content ?? "").slice(0, 200), status: (["todo", "doing", "done"].includes(String(i.status)) ? i.status : i.done ? "done" : "todo") as TodoItem["status"] }))
          .filter((i: TodoItem) => i.text).slice(0, 30);
        await ctx.setState({ ...ctx.state, todo: items });
        ctx.emit({ t: "todo", items });
        return { ok: true, result: renderTodo(items) || "(cleared)", meta: { todo: items } };
      }
      case "ask_user": {
        const options = (Array.isArray(a.options) ? a.options : []).map(String).filter(Boolean).slice(0, 8);
        return { ok: true, stop: true, result: "Shown to the user. Stop here; the answer arrives as the next message.", meta: { question: String(a.question || ""), options, multi: !!a.multi } };
      }
      case "ui_search": return { ok: true, result: searchCatalog(a.query) };
      case "proc_start": return await procStart(st, { name: String(a.name || "app"), command: String(a.command || ""), cwd: a.cwd, host: !!a.host, wait: Number(a.wait) || undefined });
      case "proc_logs": return await procLogs({ name: a.name, tail: Number(a.tail) || undefined, grep: a.grep, wait_for: a.wait_for, pattern: a.pattern, timeout: Number(a.timeout) || undefined });
      case "proc_stop": return await procStop(String(a.name));
      case "proc_restart": return await procRestart(st, String(a.name), Number(a.wait) || undefined);
      case "browser": {
        if (st.vision === false) a.full = false;
        const r = await browse(String(a.target || ""), { steps: Array.isArray(a.steps) ? (a.steps as Step[]) : [], width: Number(a.width) || undefined, height: Number(a.height) || undefined, full: !!a.full, theme: a.theme, resolve: P });
        const body = [`${r.title || "(untitled)"} · ${r.url}`, r.errors.length ? `errors:\n${r.errors.map((e) => "- " + e).join("\n")}` : "no console errors", ...r.evals.map((e, i) => `eval ${i + 1}: ${e}`), `text:\n${r.text || "(empty page)"}`].join("\n");
        return { ok: true, result: cut(body, 6000) + (st.vision === false ? "" : "\nScreenshot attached below."), images: st.vision === false ? [] : [r.shot], meta: { image: r.shot } };
      }
      case "check": {
        const abs = P(a.path || ".");
        const host = !!a.host && st.terminal === "host";
        const isDir = fss.statSync(abs).isDirectory();
        const parts: string[] = [];
        const images: string[] = [];
        let ok = true;
        if (isDir && a.run !== "ui") { const r = await runChecks(st, abs, a.run || "all", host); ok = r.ok; parts.push(r.report); }
        // UI: lint visible files + screenshot of the entry page
        const uiFiles = isDir ? await collectUi(abs) : [abs];
        const lint = await lintFiles(uiFiles.map((f) => ({ path: rel(f), abs: f })));
        if (uiFiles.length) parts.push(lint ? `design lint:\n${lint}` : `design lint: clean (${uiFiles.length} files)`);
        const entry = isDir ? ["index.html", "dist/index.html", "public/index.html"].map((x) => path.join(abs, x)).find((x) => fss.existsSync(x) && !/\bsrc=["']\/src\//.test(fss.readFileSync(x, "utf8"))) : /\.(html?|ui)$/.test(abs) ? abs : undefined;
        if (entry && (a.run === "ui" || a.run === "all" || !a.run)) {
          try {
            const r = await browse(entry, { resolve: P, width: 1280, height: 800 });
            parts.push(r.errors.length ? `page errors:\n${r.errors.map((e) => "- " + e).join("\n")}` : "page: no console errors");
            if (st.vision !== false) { images.push(r.shot); parts.push("Screenshot attached below: check layout, spacing, contrast, overflow."); }
          } catch (e) { parts.push("screenshot skipped: " + (e instanceof Error ? e.message : String(e))); }
        }
        return { ok: ok && !/✗ \[/.test(lint), result: cut(parts.join("\n\n") || "nothing to check", 8000), images, meta: images[0] ? { image: images[0] } : undefined };
      }
      default: {
        const m = name.match(/^mcp__(.+?)__(.+)$/);
        if (m) return { ok: true, result: cut(await callMcp(m[1], m[2], a), 12000) };
        return { ok: false, result: "Unknown tool " + name };
      }
    }
  } catch (e) {
    return { ok: false, result: "Error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

async function collectUi(dir: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 4 || out.length > 40) return out;
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await collectUi(f, out, depth + 1);
    else if (/\.(html?|css|jsx|tsx|vue|svelte|ui)$/.test(e.name)) out.push(f);
  }
  return out;
}
