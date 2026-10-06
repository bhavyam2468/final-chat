import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { spawn } from "child_process";
import { WS, resolvePath, rel, tree, Node, mimeOf, isImage, readText } from "../workspace";
import type { Settings } from "../settings";
import { searchCatalog } from "../blocks/catalog";
import { callMcp, readServers, writeServers, dropMcpPool, expandCfg, ServerCfg } from "../mcp";
import { MCP_CATALOG, registrySearch } from "../market";
import { startOAuth } from "../mcp-auth";
import { varsFor, varsIn, credStatus } from "../credentials";
import { runShell, runPython as execPython, pipInstall, hostDenied, usesSudo, sudoReady } from "../exec";
import { youtubeId, chatDir } from "../shared";
import { firecrawlScrape, firecrawlSearch, firecrawlExtract } from "../web";
import { applyEdits, insertLines, snippet, hasPlaceholder, Edit } from "./edit";
import { syntaxError } from "./syntax";
import { procStart, procLogs, procStop, procRestart } from "../procs";
import { browse, Step } from "../browser";
import { runChecks, lintFiles } from "../harness/check";
import { findSkill, skillMeta, skillFiles, installFromGitHub } from "../skills";
import { destructive, checkInstalls } from "../harness/guard";
import { forget, remember } from "../memory";
import { banPackages, installNames, noteMissing, shellPreflight } from "../harness/shell-preflight";
import { ensureProject, projectSlug } from "../projects";
import { adb, adbShot, phoneOff } from "../phone";
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
export type ConvState = { packs?: Pack[]; todo?: TodoItem[]; approved?: string[]; mode?: "chat" | "search"; project?: string };

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
    T("skill_create", "Write a new skill for the user (a folder with SKILL.md). Use when they ask for one, or when a workflow will repeat. Body: when to use it, the steps, the rules; references go in files", { name: s("lowercase-with-dashes"), description: s("one line, shown in the skills list"), body: s("markdown instructions"), files: arr({ type: "object", properties: { path: s("reference/x.md"), content: s() }, required: ["path", "content"] }, "optional reference files"), requires: s("host-terminal | host-files"), tools: s("dev"), overwrite: b() }, ["name", "description", "body"]),
    T("skill_install", "Install skills from GitHub (owner/repo, owner/repo/path, or a tree URL). With several skills in a repo and no pick, it returns the list: ask the user which, then call again with pick", { source: s(), pick: arr({ type: "string" }, "skill names to install") }, ["source"]),
    T("mcp_search", "Search the official MCP registry for a server that does something the built-ins cannot", { query: s() }, ["query"]),
    T("mcp_add", "Add and enable an MCP server: a catalog id (see Settings → MCP), or a url, or a command. A url server signs in by itself — return the sign-in link to the user", { name: s("server name, e.g. notion"), catalog_id: s(), url: s("remote MCP endpoint"), command: s("stdio server command"), args: arr({ type: "string" }) }, ["name"]),
    T("mcp_remove", "Remove an MCP server", { name: s() }, ["name"]),
    T("context_add", "Pin a file into context", { path: s() }, ["path"]),
    T("context_remove", "Unpin a file from context", { path: s() }, ["path"]),
    T("compact_context", "Free context. tools=fold old tool outputs; web=old web results to key facts; history=summarise all but last keep_last messages", { scope: { type: "string", enum: ["tools", "web", "history"] }, keep_last: n() }),
    T("fs_list", "List a directory", { path: s(), depth: n("1-3, default 1") }),
    T("fs_read", "Read a file with line numbers (250 lines per call). Do not cat or head it in the shell. Long file: outline=true, or around=\"text\". Do not re-read a file already in context", { path: s(), start: n(), end: n(), around: s(), nth: n(), outline: b() }, ["path"]),
    T("fs_search", "Search file contents. Use this instead of grep, rg, or find in the shell. Returns path:line: text", { pattern: s(), path: s("dir or file, default workspace"), glob: s("e.g. *.ts"), literal: b() }, ["pattern"]),
    T("fs_write", "New file or full rewrite only. Refuses a directory. Prefer fs_edit. Do not create a README or docs unless asked", { path: s(), content: s(), mode: { type: "string", enum: ["overwrite", "append"] } }, ["path", "content"]),
    T("fs_edit", "Replace exact text. find must match the file (copy from fs_read without line numbers) and be unique unless all=true. Several edits apply atomically", { path: s(), find: s(), replace: s(), all: b(), edits: arr({ type: "object", properties: { find: s(), replace: s(), all: b() }, required: ["find", "replace"] }, "multiple edits in one call") }, ["path"]),
    T("fs_insert", "Insert lines after line N (0 = top, -1 = end) without matching text", { path: s(), line: n(), text: s() }, ["path", "line", "text"]),
    T("fs_move", "Move/rename. Into a folder: end `to` with /. Refuses to replace an existing file unless overwrite=true", { from: s(), to: s(), overwrite: b() }, ["from", "to"]),
    T("fs_delete", "Delete file or dir (goes to trash; recoverable)", { path: s() }, ["path"]),
    T("run_python", "Run Python in the app venv (created on first use; same interpreter as pip_install). Charts the user should see are <x-chart> or <x-graph>, not matplotlib", { code: s() }, ["code"]),
    T("pip_install", "Install packages into the same venv run_python uses. Not system pip", { packages: arr({ type: "string" }) }, ["packages"]),
    T("shell", "Run bash in YOUR sandbox. Not for reading or searching files (fs_read, fs_search, fs_list). Quote paths that contain spaces. A missing binary is not retried", { command: s(), timeout: n("seconds, default 120, max 600"), cwd: s() }, ["command"]),
    ...(host ? [T("host_shell", "Run bash on the USER'S machine. Quote paths with spaces. If it fails, read the error; do not guess another binary. sudo prompts the user — never pipe a password. Not for adb (use the phone tools)", { command: s(), timeout: n("seconds, default 120, max 1800"), cwd: s() }, ["command"])] : []),
    T("web_search", "Current or niche facts only. Do not search for stable knowledge you already have. Open a page with web_fetch before citing it", { query: s(), limit: n() }, ["query"]),
    T("web_fetch", "Fetch a URL as markdown", { url: s() }, ["url"]),
    ...(st.firecrawlKey ? [T("web_extract", "Extract structured data from a page (Firecrawl AI)", { url: s(), prompt: s("what to extract") }, ["url", "prompt"])] : []),
    T("view_image", "Look at an image (workspace path or URL)", { path: s() }, ["path"]),
    T("todo", "Set the task checklist shown to the user (full list each call). Use for tasks with 3+ steps", { items: arr({ type: "object", properties: { text: s(), status: { type: "string", enum: ["todo", "doing", "done"] } }, required: ["text", "status"] }) }, ["items"]),
    T("ask_user", "Ask the user to choose (2-5 short options; they can also type their own answer or skip). Only when a real decision blocks you. Ends your turn", { question: s(), options: arr({ type: "string" }), multi: b() }, ["question", "options"]),
    T("remember", "Save a fact the user asked to remember. profile = always loaded. episode = retrieved when relevant. project = notes on the linked project. They can edit or undo it", { text: s(), scope: { type: "string", enum: ["profile", "episode", "project"] } }, ["text"]),
    T("forget", "Delete a remembered note by the id shown in Memory", { id: s() }, ["id"]),
    T("project_open", "Create or link a project. Its PROJECT.md is loaded in every later turn of this chat. Pass the project name", { name: s() }, ["name"]),
    T("diff_since", "Files changed in this chat's folder (and the linked project) in the last N hours", { hours: n("default 24") }),
    T("canvas_open", "Show a workspace file, web page or YouTube URL in a canvas window", { target: s("path or URL"), title: s(), dock: b("dock beside chat") }, ["target"]),
    T("ui_search", "Find BlocksUI components. Do not invent a tag; if it is not in the system prompt, search here", { query: s() }, ["query"]),
  ];
  const phone: ToolDef[] = st.phone ? [
    T("adb_devices", "List Android devices. Phone testing must already be on", {}, []),
    T("adb_install", "Install an apk from the workspace onto the connected device", { path: s("apk path") }, ["path"]),
    T("adb_launch", "Start an activity. package and activity come from the manifest, not a guess", { package: s(), activity: s("activity class, or .MainActivity") }, ["package"]),
    T("adb_shot", "Screenshot the device into this chat's artifacts and show it", {}, []),
    T("adb_tap", "Tap the screen at pixel x, y. Read a screenshot first", { x: n(), y: n() }, ["x", "y"]),
    T("adb_logcat", "Recent device logs", { lines: n("default 120") }),
    T("adb_shell", "One command on the device shell, not the computer. No installers, no rm -rf", { command: s() }, ["command"]),
  ] : [];
  const dev: ToolDef[] = [
    T("proc_start", "Start a long-running process (dev server, watcher) in the background", { name: s(), command: s(), cwd: s(), wait: n("seconds to wait for a port, default 4"), ...hostArg }, ["name", "command"]),
    T("proc_logs", "Process output/status. No name = list. wait_for blocks until port/pattern/exit", { name: s(), tail: n(), grep: s(), wait_for: { type: "string", enum: ["port", "pattern", "exit"] }, pattern: s(), timeout: n() }),
    T("proc_restart", "Restart a process with the same command", { name: s(), wait: n() }, ["name"]),
    T("proc_stop", "Stop a process", { name: s() }, ["name"]),
    T("browser", "Open URL or workspace page (.html/.ui/dir) headless; returns screenshot + console errors + text", { target: s(), steps: arr({ type: "object", properties: { click: s(), type: s(), text: s(), press: s(), wait: { type: ["number", "string"] }, eval: s(), scroll: n(), hover: s(), select: s(), value: s() } }, "actions in order"), width: n(), height: n(), full: b("full page"), theme: { type: "string", enum: ["light", "dark"] } }, ["target"]),
    T("check", "Verify work: project dir → types/lint/tests/build; UI file or dir → design lint + screenshot", { path: s(), run: { type: "string", enum: ["all", "types", "lint", "test", "build", "ui"] }, ...hostArg }, ["path"]),
  ];
  return [...core, ...phone, ...(packs.includes("dev") ? dev : [])];
}

export type ToolCtx = {
  settings: Settings; conversationId: string; pinned: string[]; emit: (e: Record<string, unknown>) => void;
  setPinned: (p: string[]) => Promise<void>; compact: (scope?: string, keepLast?: number) => Promise<string>;
  state: ConvState; setState: (s: ConvState) => Promise<void>;
  /** live stdout/stderr of the running call (shown in the tool row while it runs) */
  output?: (chunk: string) => void;
  /** Human-readable progress for file, web, integration and other tools without streaming stdout. */
  progress?: (status: string) => void;
  signal?: AbortSignal;
};
export type ToolOut = { result: string; ok: boolean; meta?: unknown; images?: string[]; stop?: boolean };

export const approvalHash = (cmd: string, host: boolean) => createHash("sha1").update(`${host ? "host" : "sandbox"}\0${cmd.trim()}`).digest("hex").slice(0, 16);
/**
 * Destructive or risky actions need one click from the user. Returns null when this exact command was approved
 * (the approval is consumed), otherwise a stop result the UI renders with Approve / Deny. Enforced here, not in the prompt.
 */
async function approvalGate(ctx: ToolCtx, cmd: string, reason: string, host: boolean, sudo = false): Promise<ToolOut | null> {
  const hash = approvalHash(cmd, host);
  const ok = ctx.state.approved || [];
  if (ok.includes(hash)) { await ctx.setState({ ...ctx.state, approved: ok.filter((h) => h !== hash) }); return null; }
  const ask = sudo ? "The user sees a password prompt" : "The user sees Approve / Deny";
  return { ok: false, stop: true, result: `Not run: ${sudo ? "sudo needs the user's password" : `needs the user's approval (${reason})`}. ${ask}. Stop here and wait; if approved, run exactly the same command again (plain sudo, never echo/pipe a password).`, meta: { approval: { cmd, hash, reason, host, sudo } } };
}

/** Recoverable delete: workspace files → workspace/.trash, others → the desktop trash (freedesktop / macOS). */
// paths built with Array.join: path.join here makes the bundler trace the project folder (see workspace.ts)
export async function trash(abs: string): Promise<string> {
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

const cut = (x: string, max = 8000) => (x.length > max ? x.slice(0, max) + `\n… omitted ${x.length - max} chars. Incomplete, not an error. Recover with a narrower call (fs_read start/end or around, web_fetch a section). Do not repeat this same call.` : x);
/** A failed command is an observation. Say so, so the model doesn't invent a binary or sudo a guess. */
function shellNote(out: string): string {
  if (/command not found/.test(out)) return "\n\n[harness] That binary is not on PATH. Do not guess another name and do not sudo it. Find the real command (command -v, the package file list, or the project's docs) and retry once.";
  if (/externally-managed-environment/.test(out)) return "\n\n[harness] System Python refuses pip. Use pip_install / run_python (the app venv), not sudo pip.";
  if (/a password is required|sorry, try again/.test(out)) return "\n\n[harness] Do not pipe a password. Run the sudo command again; the app prompts the user.";
  return "";
}

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
    const activity: Record<string, string> = {
      skill_open: "Loading skill instructions", skill_create: "Writing skill", skill_install: "Installing skills",
      mcp_search: "Searching the MCP registry", mcp_add: "Adding MCP server", mcp_remove: "Removing MCP server",
      context_add: "Checking workspace file", context_remove: "Updating context",
      compact_context: "Summarising conversation", fs_list: "Reading folder contents", fs_read: "Opening file",
      fs_search: "Searching workspace files", fs_write: "Preparing file write", fs_edit: "Reading current file",
      fs_insert: "Reading current file", fs_delete: "Moving item to trash", fs_move: "Checking destination",
      run_python: "Starting Python", pip_install: "Checking packages", shell: "Preparing sandbox command",
      host_shell: "Preparing machine command", web_search: "Searching the web", web_fetch: "Opening webpage",
      web_extract: "Extracting page details", view_image: "Loading image", todo: "Updating task list",
      remember: "Saving memory", forget: "Removing memory", project_open: "Opening project", diff_since: "Checking recent changes",
      canvas_open: "Opening preview", ui_search: "Searching UI components", browser: "Opening browser",
      check: "Running checks", quality_check: "Reviewing design", adb_devices: "Checking connected devices",
      adb_install: "Installing app on device", adb_launch: "Opening app on device", adb_shot: "Capturing device screen",
      adb_tap: "Sending touch input", adb_logcat: "Reading device logs", adb_shell: "Running device command",
      proc_start: "Starting process", proc_logs: "Reading process output", proc_restart: "Restarting process", proc_stop: "Stopping process",
    };
    ctx.progress?.(activity[name] || "Working on integration");
    switch (name) {
      case "skill_open": {
        const sk = await findSkill(String(a.name || ""));
        if (!sk) return { ok: false, result: `No skill "${a.name}". See the Skills list.` };
        const meta = skillMeta(sk.text);
        if (meta.requires === "host-terminal" && st.terminal !== "host") return { ok: false, result: "This skill needs Host terminal (Settings → Access)." };
        if (meta.requires === "host-files" && st.access === "sandbox") return { ok: false, result: "This skill needs Home folder access (Settings → Access)." };
        if (a.file && !/^SKILL\.md$/i.test(String(a.file))) {
          const f = path.resolve(sk.dir, String(a.file));
          if (!f.startsWith(sk.dir + path.sep)) return { ok: false, result: "file must be inside the skill" };
          const txt = await fs.readFile(f, "utf8").catch(() => null);
          if (txt === null) { const fl = await skillFiles(sk.dir); return { ok: false, result: `No file "${a.file}" in skill ${sk.name}. ${fl.length ? "Files: " + fl.join(", ") : "It has only SKILL.md: call skill_open without file."}` }; }
          return { ok: true, result: cut(txt, 24000) };
        }
        let extra = "";
        const packs = (meta.tools || "").split(/[\s,]+/).filter((p): p is Pack => p === "dev");
        const add = packs.filter((p) => !(ctx.state.packs || []).includes(p));
        if (add.length) { await ctx.setState({ ...ctx.state, packs: [...(ctx.state.packs || []), ...add] }); extra += `\n\n(Enabled tools: proc_start proc_logs proc_restart proc_stop browser check)`; }
        const files = await skillFiles(sk.dir);
        if (files.length) extra += `\n\nReference files (skill_open name="${sk.name}" file=…): ${files.join(", ")}`;
        return { ok: true, result: sk.text.replace(/^---[\s\S]*?---\n/, "") + extra };
      }
      case "skill_create": {
        const name = String(a.name || "").trim().toLowerCase().replace(/[^\w.-]/g, "-");
        const desc = String(a.description || "").replace(/\s+/g, " ").trim();
        if (!name || !desc) return { ok: false, result: "name and description are required." };
        if (fss.existsSync(path.join(path.resolve("./workspace-template/system/skills"), name)))
          return { ok: false, result: `"${name}" is a built-in skill. Pick another name — a skill that shadows a built-in will not be loaded.` };
        const dir = path.join(WS, "system/skills", name);
        if (fss.existsSync(path.join(dir, "SKILL.md")) && !a.overwrite) return { ok: false, result: `Skill "${name}" already exists. Pass overwrite=true to replace it, or edit it with fs_edit.` };
        const fm = ["---", `name: ${name}`, `description: ${desc}`, a.requires ? `requires: ${String(a.requires)}` : "", a.tools ? `tools: ${String(a.tools)}` : "", "---", ""].filter((l) => l !== "").join("\n");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "SKILL.md"), fm + "\n" + String(a.body || "").trim() + "\n");
        const files = Array.isArray(a.files) ? (a.files as { path: string; content: string }[]) : [];
        for (const f of files) {
          const target = path.resolve(dir, String(f.path || ""));
          if (!target.startsWith(dir + path.sep)) return { ok: false, result: "Reference files must stay inside the skill folder." };
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, String(f.content ?? ""));
        }
        return { ok: true, result: `Skill "${name}" created at system/skills/${name}/SKILL.md${files.length ? ` with ${files.length} reference file(s)` : ""}. It appears in the skills list from the next message. Show the user its path.` };
      }
      case "skill_install": {
        const r = await installFromGitHub(String(a.source || ""), Array.isArray(a.pick) ? (a.pick as string[]) : undefined);
        if (!r.installed.length && r.available.length > 1 && !a.pick)
          return { ok: true, result: `This source holds several skills: ${r.available.join(", ")}. Ask the user which to install, then call skill_install again with pick.` };
        const parts = [r.installed.length ? `Installed: ${r.installed.join(", ")}` : "", r.skipped.length ? `Already built in, skipped: ${r.skipped.join(", ")}` : ""].filter(Boolean);
        return { ok: parts.length > 0, result: parts.join(". ") || "Nothing installed." };
      }
      case "mcp_search": {
        const items = await registrySearch(String(a.query || ""));
        if (!items.length) return { ok: false, result: "No server found. Try another word, or give the user the URL of a server they already know." };
        return { ok: true, result: cut(items.slice(0, 12).map((x) => `- ${x.name}${x.url ? ` · ${x.url}` : ""}${x.overlap ? ` (built in: ${x.overlap})` : ""}\n  ${(x.description || "").slice(0, 160)}`).join("\n"), 6000) };
      }
      case "mcp_add": {
        const name = String(a.name || "").trim().toLowerCase().replace(/[^\w.-]/g, "-");
        if (!name) return { ok: false, result: "A name is required." };
        const cat = a.catalog_id ? MCP_CATALOG.find((e) => e.id === String(a.catalog_id)) : undefined;
        if (a.catalog_id && !cat) return { ok: false, result: `Unknown catalog id "${a.catalog_id}".` };
        const cfg: ServerCfg | null = cat ? { ...cat.config, enabled: true } : a.url ? { url: String(a.url), enabled: true } : a.command ? { command: String(a.command), args: (a.args as string[]) || [], enabled: true } : null;
        if (!cfg) return { ok: false, result: "Give a catalog_id, a url, or a command." };
        const servers = await readServers();
        await writeServers({ ...servers, [name]: cfg });
        dropMcpPool();
        let note = "";
        if (cfg.url && !Object.keys(cfg.headers || {}).length) {
          const origin = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
          try {
            const r = await startOAuth(name, expandCfg(cfg, varsFor(st, varsIn(cfg))), origin);
            note = r.connected ? " It is already signed in." : r.url ? `
Sign-in link (works once, ask the user to open it): ${r.url}
They can also press Connect in Settings → MCP.` : "";
          } catch (e) { note = `\nSign-in could not start automatically (${String((e as Error).message || e).slice(0, 200)}); the user can connect it from Settings → MCP.`; }
        } else if (Object.keys(cfg.headers || {}).length || cfg.env) {
          const vars = varsIn(cfg);
          const missing = vars.filter((v) => !credStatus(st, [v])[v]);
          note = missing.length ? `\nIt needs ${missing.join(", ")}: tell the user exactly where to create that (Settings → Tools → Secrets).` : "\nIts credentials are already available.";
        }
        return { ok: true, result: `${name} added and enabled${cat ? ` (${cat.title})` : ""}. Tools appear as mcp__${name}__… from the next message.${note}` };
      }
      case "mcp_remove": {
        const name = String(a.name || "");
        const servers = await readServers();
        if (!servers[name]) return { ok: false, result: `No server named "${name}".` };
        const next = { ...servers };
        delete next[name];
        await writeServers(next);
        dropMcpPool();
        return { ok: true, result: `${name} removed.` };
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
        ctx.progress?.("Reading file contents");
        const raw = ["pdf", "docx", "pptx", "xlsx", "xls"].includes(ext) ? await readText(f, 400000) : await fs.readFile(f, "utf8");
        ctx.progress?.("Preparing readable preview");
        if (raw.startsWith("(binary file)")) return { ok: false, result: "Binary file; not readable as text." };
        const lines = raw.split("\n");
        if (a.outline) {
          // a map of the file: markdown headings, code definitions, section-like lines; with line numbers
          const re = /^(#{1,6}\s|\s{0,4}(export\s+)?(default\s+)?(async\s+)?(function|class|def|interface|type|enum|struct|impl|fn|const\s+\w+\s*=\s*(async\s*)?\(|let\s+\w+\s*=\s*\()|\s*(public|private|protected)\s+[\w<>\[\]]+\s+\w+\s*\(|\[[\w.-]+\]\s*$|<(h[1-3]|section|x-slide)\b)/;
          const hits = lines.map((l, i) => [i + 1, l] as const).filter(([, l]) => re.test(l)).slice(0, 200);
          ledger(ctx.conversationId).set(f, mtime(f));
          return { ok: true, result: `${a.path} · ${lines.length} lines · outline (${hits.length})\n` + (hits.map(([n, l]) => `${n}\t${l.trim().slice(0, 140)}`).join("\n") || "(no headings or definitions found; read with start/end)") };
        }
        let aroundAt = 0;
        if (a.around) {
          const q = String(a.around).toLowerCase(); let k = Math.max(1, Number(a.nth) || 1);
          const idx = lines.findIndex((l) => l.toLowerCase().includes(q) && --k === 0);
          if (idx < 0) return { ok: false, result: `"${a.around}" not found${Number(a.nth) > 1 ? ` ${a.nth} times` : ""} in ${a.path} (${lines.length} lines). Try fs_search or outline=true.` };
          aroundAt = idx + 1;
        }
        const s0 = aroundAt ? Math.max(1, aroundAt - 30) : Math.max(1, Number(a.start) || 1);
        const e0 = aroundAt ? Math.min(lines.length, aroundAt + 60) : Math.min(lines.length, Number(a.end) || s0 + 249);
        ledger(ctx.conversationId).set(f, mtime(f));
        const head = `${a.path} · ${lines.length} lines${s0 > 1 || e0 < lines.length ? ` · showing ${s0}-${e0}` : ""}${aroundAt ? ` · match at ${aroundAt}` : ""}\n`;
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
        const stt = await fs.stat(f).catch(() => null);
        if (stt?.isDirectory() || String(a.path).endsWith("/")) return { ok: false, result: `${a.path} is a directory. Write a file inside it, for example ${String(a.path).replace(/\/$/, "")}/index.html.` };
        await fs.mkdir(path.dirname(f), { recursive: true });
        let before = "", exists = false;
        try { before = await fs.readFile(f, "utf8"); exists = true; } catch {}
        const L = ledger(ctx.conversationId);
        if (a.mode === "append") { ctx.progress?.("Appending to file"); await fs.appendFile(f, (before && !before.endsWith("\n") ? "\n" : "") + content); L.set(f, mtime(f)); return { ok: true, result: `Appended to ${a.path}`, meta: { path: a.path, before: "", after: content.slice(0, 20000) } }; }
        if (exists && before.trim() && !L.has(f) && before !== content) return { ok: false, result: `${a.path} exists (${before.split("\n").length} lines) and you have not read it in this chat. fs_read it first, then fs_edit (or fs_write again to replace it).` , meta: { path: a.path } };
        if (exists && hasPlaceholder(content, before)) return { ok: false, result: "content contains an elision placeholder (\"... rest of code\"); writing it would delete code. Write the full file or use fs_edit." };
        ctx.progress?.("Writing file to workspace");
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
        ctx.progress?.("Validating patch and writing file");
        const out = await guardAndWrite(f, src, r.text, r.changed, [...stale, ...r.notes]);
        if (out.ok) L.set(f, mtime(f));
        return { ...out, result: out.ok ? `Edited ${a.path}\n${out.result}` : out.result, meta: { path: a.path, before: edits.map((e) => e.find).join("\n…\n"), after: edits.map((e) => e.replace).join("\n…\n") } };
      }
      case "fs_insert": {
        const f = P(a.path);
        let src = ""; try { src = await fs.readFile(f, "utf8"); } catch { await fs.mkdir(path.dirname(f), { recursive: true }); }
        const r = insertLines(src, Number(a.line ?? -1), String(a.text ?? ""));
        ctx.progress?.("Validating insertion and writing file");
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
        ctx.progress?.("Running Python code");
        const r = await execPython(st, a.code, 120000, { onData: ctx.output, signal: ctx.signal });
        const chart = /\b(matplotlib|pyplot|plt\.show|plt\.savefig)\b/.test(String(a.code)) ? "\n\n[harness] A matplotlib figure is not visible in chat. If the user should see a chart, emit <ui><x-chart> or <x-graph>. Keep a file only if they asked for one." : "";
        return { ok: r.code === 0, result: cut((r.out || "(no output)") + chart) };
      }
      case "pip_install": {
        const pk = ([] as string[]).concat(a.packages).map(String);
        const chk = await checkInstalls(pk, "pypi");
        if (chk?.block) { banPackages(ctx.conversationId, pk); return { ok: false, result: chk.block + "\n\n[harness] Do not retry this name." }; }
        if (chk?.approve) { const gate = await approvalGate(ctx, `pip install ${pk.join(" ")}`, chk.approve, false); if (gate) return gate; }
        ctx.progress?.("Installing Python packages");
        const r = await pipInstall(pk, { onData: ctx.output, signal: ctx.signal }); return { ok: r.code === 0, result: cut(r.out || "installed", 3000) };
      }
      case "shell":
      case "host_shell": {
        const host = name === "host_shell";
        if (host && hostDenied(st)) return { ok: false, result: hostDenied(st)! };
        const cmd = String(a.command);
        const pre = shellPreflight(cmd, ctx.conversationId);
        if (pre) return { ok: false, result: pre };
        const danger = destructive(cmd, host ? "host" : "sandbox");
        // sudo with no known password: one in-app prompt (masked field) that also covers any risk approval
        if (host && st.sudo && usesSudo(cmd) && !sudoReady(st)) { const gate = await approvalGate(ctx, cmd, danger?.reason || "Needs your sudo password", true, true); if (gate) return gate; }
        else if (danger) { const gate = await approvalGate(ctx, cmd, danger.reason, host); if (gate) return gate; }
        const chk = await checkInstalls(cmd);
        if (chk?.block) { banPackages(ctx.conversationId, installNames(cmd)); return { ok: false, result: chk.block + "\n\n[harness] Do not retry this name. Search for the real package, or stop." }; }
        if (chk?.approve) { const gate = await approvalGate(ctx, cmd, chk.approve, host); if (gate) return gate; }
        const cwd = a.cwd ? resolvePath(String(a.cwd), host ? st.access : "sandbox") : undefined;
        ctx.progress?.(host ? "Running command on your machine" : "Running command in sandbox");
        const r = await runShell(st, String(a.command), Math.min(host ? 1800 : 600, Math.max(5, Number(a.timeout) || 120)) * 1000, host, cwd, { onData: ctx.output, signal: ctx.signal });
        noteMissing(ctx.conversationId, r.out);
        return { ok: r.code === 0, result: cut(`exit ${r.code}\n${r.out.trim() || "(no output)"}` + shellNote(r.out)) };
      }
      case "adb_devices":
      case "adb_install":
      case "adb_launch":
      case "adb_shot":
      case "adb_tap":
      case "adb_logcat":
      case "adb_shell": {
        const off = phoneOff(st);
        if (off) return { ok: false, result: off };
        if (name === "adb_devices") { const r = await adb(st, ["devices", "-l"], { onData: ctx.output, signal: ctx.signal }); return { ok: r.code === 0, result: cut(r.out || "no devices") }; }
        if (name === "adb_install") {
          const apk = P(String(a.path || ""));
          if (!apk.endsWith(".apk")) return { ok: false, result: "path must be an .apk in the workspace" };
          const r = await adb(st, ["install", "-r", apk], { onData: ctx.output, signal: ctx.signal }, 180000);
          return { ok: r.code === 0, result: cut(r.out || "installed") };
        }
        if (name === "adb_launch") {
          const pkg = String(a.package || "");
          const act = String(a.activity || "");
          if (!/^[\w.]+$/.test(pkg)) return { ok: false, result: "package must come from the manifest" };
          const comp = act ? (act.startsWith(".") ? pkg + act : act.includes("/") ? act : `${pkg}/${act}`) : pkg;
          const r = await adb(st, ["shell", "am", "start", "-n", comp], { onData: ctx.output, signal: ctx.signal });
          return { ok: r.code === 0, result: cut(r.out || "launched") };
        }
        if (name === "adb_shot") {
          const relp = `${chatDir(ctx.conversationId)}/artifacts/device-${Date.now()}.png`;
          const dest = path.join(WS, relp);
          const r = await adbShot(st, dest);
          return { ok: r.code === 0, result: r.code === 0 ? `Screenshot ${relp}` : r.out, images: r.code === 0 ? [relp] : undefined, meta: r.code === 0 ? { image: relp } : undefined };
        }
        if (name === "adb_tap") {
          const x = Math.round(Number(a.x)), y = Math.round(Number(a.y));
          if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, result: "x and y must be pixels from a screenshot" };
          const r = await adb(st, ["shell", "input", "tap", String(x), String(y)], { onData: ctx.output, signal: ctx.signal });
          return { ok: r.code === 0, result: r.code === 0 ? `tapped ${x},${y}` : r.out };
        }
        if (name === "adb_logcat") {
          const n = Math.min(400, Math.max(20, Number(a.lines) || 120));
          const r = await adb(st, ["logcat", "-d", "-t", String(n)], { onData: ctx.output, signal: ctx.signal });
          return { ok: r.code === 0, result: cut(r.out || "(no logs)") };
        }
        const shcmd = String(a.command || "");
        if (/\brm\s+-rf\b|\bpm\s+uninstall\b|\bsettings\s+put\b/i.test(shcmd)) return { ok: false, result: "Refusing that device command. Ask the user." };
        const r = await adb(st, ["shell", shcmd], { onData: ctx.output, signal: ctx.signal });
        return { ok: r.code === 0, result: cut(r.out || "(no output)") };
      }
      case "canvas_open": {
        const t = String(a.target || "").trim();
        const title = a.title ? String(a.title) : undefined;
        const yt = youtubeId(t);
        let spec: Record<string, unknown>;
        if (yt) spec = { kind: "youtube", id: yt, title: title || "YouTube" };
        else if (/^https?:\/\//.test(t)) spec = { kind: "web", url: t, title: title || new URL(t).hostname };
        else { const abs = P(t); await fs.access(abs); spec = { kind: "file", path: rel(abs), title: title || path.basename(abs) }; }
        ctx.emit({ t: "canvas", spec, dock: !!a.dock });
        return { ok: true, result: `Opened ${spec.kind === "file" ? spec.path : t} in canvas` + (spec.kind === "file" ? ` (${mimeOf(t)})` : "") };
      }
      case "web_search": {
        ctx.progress?.("Waiting for web results");
        const j = await firecrawlSearch(st, a.query, Math.min(Number(a.limit) || 5, 8));
        const items = ((j.data as { url: string; title?: string; description?: string }[]) || []).map((d) => ({ url: d.url, title: d.title || d.url, snippet: (d.description || "").slice(0, 240) }));
        const empty = !items.length ? (j._source === "none" ? "no results. Search is not configured (no keyless hits, local Firecrawl not up, no cloud key). Say so; do not invent sources." : "no results") : "";
        return { ok: items.length > 0, result: items.map((d, i) => `[${i + 1}] ${d.title}\n${d.url}\n${d.snippet}`).join("\n\n") || empty, meta: { sources: items, source: j._source } };
      }
      case "remember": {
        const scope = a.scope === "profile" ? "profile" : a.scope === "project" ? "project" : "episode";
        const row = await remember(String(a.text || ""), scope, ctx.state.project);
        return { ok: true, result: `Remembered [${row.id}] ${row.text}. The user can edit or undo this.`, meta: { memory: row } };
      }
      case "project_open": {
        const p = await ensureProject(String(a.name || ""));
        await ctx.setState({ ...ctx.state, project: p.id });
        return { ok: true, result: `Linked this chat to project ${p.id} (${p.path}).\n${p.text}`, meta: { project: p.id } };
      }
      case "diff_since": {
        const hours = Math.min(168, Math.max(1, Number(a.hours) || 24));
        const since = Date.now() - hours * 3600e3;
        const roots = [path.join(WS, chatDir(ctx.conversationId)), ctx.state.project ? path.join(WS, "projects", projectSlug(ctx.state.project)) : ""].filter(Boolean);
        const found: string[] = [];
        const walk = async (dir: string, depth: number) => {
          if (depth > 4 || found.length > 40) return;
          for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
            if (name === "node_modules" || name === ".git" || name === ".venv") continue;
            const abs = path.join(dir, name);
            const stt = await fs.stat(abs).catch(() => null);
            if (!stt) continue;
            if (stt.isDirectory()) await walk(abs, depth + 1);
            else if (stt.mtimeMs >= since) found.push(`${rel(abs)} · ${new Date(stt.mtimeMs).toISOString().slice(0, 16)}`);
          }
        };
        for (const r of roots) await walk(r, 0);
        return { ok: true, result: found.length ? `Changed in the last ${hours}h:\n` + found.join("\n") : `No files changed in the last ${hours}h.` };
      }
      case "forget": {
        const ok = await forget(String(a.id || ""));
        return { ok, result: ok ? `Forgot ${a.id}` : `No memory with id ${a.id}` };
      }
      case "web_fetch": {
        ctx.progress?.("Fetching page content");
        const j = await firecrawlScrape(st, a.url);
        const md = (j.data?.markdown as string) || "";
        return { ok: true, result: cut(md, 12000), meta: { sources: [{ url: a.url, title: j.data?.metadata?.title || a.url, snippet: md.slice(0, 200) }], source: j._source } };
      }
      case "web_extract": {
        ctx.progress?.("Extracting requested details");
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
        if (m) { ctx.progress?.(`Contacting ${m[1]} · ${m[2]}`); return { ok: true, result: cut(await callMcp(m[1], m[2], a), 12000) }; }
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
