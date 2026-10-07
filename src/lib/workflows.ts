import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, type Part } from "@/db/schema";
import { WS, ensureWorkspace } from "./workspace";
import { chatDir, canvasSlug } from "./shared";
import { getSettings, type Settings } from "./settings";
import { firecrawlScrape, firecrawlSearch } from "./web";
import { runAgent, type Emit } from "./agent";
import { startRun } from "./runs";
import {
  agentBrief, fill, parseWorkflow, progressOf, publicRun, valuesFor, workflowText,
  type RunLog, type RunStep, type WorkflowDef, type WorkflowRun, type WorkflowSpec, type WorkflowStep,
} from "./workflow-format";

// The file format, the run record and what progress means live in ./workflow-format (no fs, no db, no settings,
// so they can be tested and read on their own). Everything here is the engine that performs a workflow.
export { agentBrief, parseWorkflow, progressOf, publicRun, workflowText } from "./workflow-format";
export type { RunLog, RunSource, RunStep, WorkflowDef, WorkflowInput, WorkflowRun, WorkflowSpec, WorkflowStep } from "./workflow-format";

/**
 * Workflows: a named, repeatable procedure the app performs for you.
 *
 * A workflow is a folder under `workflows/<name>/` with a `workflow.md` in it — front matter for the shape,
 * the body for the brief. It is not a block and not a chat: running one opens a *window* (which can hold
 * blocks) and does the work in the background, in the order the file declares.
 *
 * A workflow is not just a long prompt, and that is the whole point:
 *   1. the deterministic steps are performed by the app, not asked of the model. "Search for X, open the top
 *      six pages" is a fact rather than a hope, and one step instead of six round trips;
 *   2. progress is real. A step is done when its work is done — sources found, pages read, the report written
 *      — so the window can show a bar that means something;
 *   3. the process stays out of the chat. Searches, extracts and dead ends live in the run record and in
 *      `.workflows/<id>/`; the chat receives the report and nothing else.
 *
 * Extensibility works the way skills do: a workflow is files, so a community workflow is a folder you copy in
 * (or the agent writes for you). `RUNNERS` maps a step kind to the function that performs it, so a new kind of
 * step is one entry, and `workflow.md` stays readable.
 */

// ---------------------------------------------------------------- where workflows and their runs live
export const WORKFLOWS_DIR = () => path.join(WS, "workflows");
export const RUNS_DIR = () => path.join(WS, ".workflows");

export async function listWorkflows(): Promise<WorkflowDef[]> {
  await ensureWorkspace();
  const out: WorkflowDef[] = [];
  for (const d of (await fs.readdir(WORKFLOWS_DIR()).catch(() => [] as string[])).sort()) {
    if (d.startsWith(".")) continue;
    const dir = path.join(WORKFLOWS_DIR(), d);
    const text = await fs.readFile(path.join(dir, "workflow.md"), "utf8").catch(() => "");
    if (!text) continue;
    try { out.push(parseWorkflow(text, dir)); }
    catch (e) { out.push({ name: d, title: d, description: String((e as Error).message), inputs: [], steps: [], body: "", dir }); }
  }
  return out;
}

export async function findWorkflow(name: string) {
  const clean = String(name || "").trim().replace(/[^\w-]/g, "");
  return (await listWorkflows()).find((w) => w.name === clean) || null;
}

/** The Blocks UI a workflow ships (ui.html), if it has one: the window renders it with the run as data. */
export const workflowUi = async (def: WorkflowDef) => fs.readFile(path.join(def.dir, "ui.html"), "utf8").catch(() => "");

const runFile = (id: string) => path.join(RUNS_DIR(), `${id.replace(/[^\w-]/g, "")}.json`);
/** Never throws: a reader can catch the file mid-write (the window polls while a step saves), so a broken
 *  read is "not yet" rather than an error — the next poll gets the whole record. */
export async function readRun(id: string): Promise<WorkflowRun | null> {
  const text = await fs.readFile(runFile(id), "utf8").catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text) as WorkflowRun; } catch { return null; }
}
export async function listRuns(limit = 40): Promise<WorkflowRun[]> {
  const files = (await fs.readdir(RUNS_DIR()).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const runs = (await Promise.all(files.map((f) => readRun(f.slice(0, -5))))).filter(Boolean) as WorkflowRun[];
  return runs.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}
/**
 * Written through a uniquely-named temporary file and renamed into place, so a reader never sees half a
 * record — and so two steps finishing at the same moment (the read step runs pages in parallel) cannot
 * clobber each other's rename.
 */
const writeRun = async (run: WorkflowRun) => {
  await fs.mkdir(RUNS_DIR(), { recursive: true });
  const tmp = `${runFile(run.id)}.${process.pid}.${writeSeq++}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(run));
  await fs.rename(tmp, runFile(run.id));
};
let writeSeq = 0;

// ---------------------------------------------------------------- steps the app performs itself
/**
 * Runs the user has stopped. In-memory on purpose: a stop only matters while the work is still in this
 * process, so the steps check it between units of work (a page in a batch, a step boundary) and give up
 * quickly without leaving half a file behind.
 */
const cancelled = new Set<string>();
const assertRunning = (id: string) => { if (cancelled.has(id)) throw new Error("stopped by the user"); };

type Ctx = {
  run: WorkflowRun; def: WorkflowDef; st: Settings; emit: Emit;
  index: number;
  save: () => Promise<void>;
  log: (text: string, kind?: RunLog["kind"]) => void;
};

/**
 * The work the app does itself, in the order the file declares it.
 * A new step kind is one entry here plus the name in `KINDS` — that is the extension seam.
 */
const RUNNERS: Record<string, (step: WorkflowStep, ctx: Ctx) => Promise<void>> = {
  /** Find sources, through the same path as the web_search tool so the user's settings are honoured. */
  async search(step, ctx) {
    const input = Object.values(ctx.run.input)[0] || "";
    const queries = String(step.opts.query ? fill(step.opts.query, ctx.run.input) : input).split(";").map((q) => q.trim()).filter(Boolean);
    const limit = Math.min(10, Math.max(1, Number(step.opts.limit) || 6));
    const seen = new Set(ctx.run.sources.map((s) => s.url));
    for (const q of queries) {
      ctx.run.activity = `Searching: ${q}`;
      ctx.log(`search: ${q}`, "step");
      await ctx.save();
      const j = await firecrawlSearch(ctx.st, q, limit).catch(() => ({ data: [] as { url: string; title?: string; description?: string }[], _source: "none" }));
      let added = 0;
      for (const d of j.data || []) {
        const url = String(d.url || "");
        if (!url || seen.has(url)) continue;
        seen.add(url); added++;
        ctx.run.sources.push({ url, title: String(d.title || url), snippet: String(d.description || "").slice(0, 300), read: false });
      }
      ctx.log(added ? `${added} new sources (${ctx.run.sources.length} so far)` : "no results for that query", added ? "note" : "error");
      await ctx.save();
    }
    if (!ctx.run.sources.length) ctx.log("nothing was found — the report will have to say so", "error");
  },

  /** Open the pages: fetch and extract each one, in small parallel batches, saving what was read. */
  async read(step, ctx) {
    const limit = Math.min(20, Math.max(1, Number(step.opts.limit) || 5));
    const batch = Math.max(1, Math.min(6, Number(step.opts.parallel) || 4));
    const todo = ctx.run.sources.filter((s) => !s.read).slice(0, limit);
    const rs = ctx.run.steps[ctx.index];
    if (!todo.length) { ctx.log("there is nothing to open (the search step found no sources)", "error"); return; }
    rs.target = todo.length;
    const dir = path.join(RUNS_DIR(), ctx.run.id, "pages");
    await fs.mkdir(dir, { recursive: true });
    let done = 0;
    for (let i = 0; i < todo.length; i += batch) {
      assertRunning(ctx.run.id);
      await Promise.all(todo.slice(i, i + batch).map(async (s, k) => {
        const n = i + k + 1;
        try {
          const j = await firecrawlScrape(ctx.st, s.url);
          const md = String(j.data?.markdown || "");
          if (md.trim().length < 80) throw new Error("too little text to be the article");
          s.title = String(j.data?.metadata?.title || s.title);
          s.read = true;
          s.words = md.split(/\s+/).length;
          s.file = `.workflows/${ctx.run.id}/pages/${String(n).padStart(2, "0")}.md`;
          await fs.writeFile(path.join(dir, `${String(n).padStart(2, "0")}.md`), `# ${s.title}\n<${s.url}>\n\n${md}`);
          ctx.log(`read: ${s.title.slice(0, 70)} (${s.words} words)`, "note");
        } catch (e) {
          s.read = false;
          s.snippet = `${s.snippet} — could not be opened (${String((e as Error).message).slice(0, 70)})`;
          ctx.log(`could not open ${s.url.slice(0, 60)}`, "error");
        }
        done++;
        rs.count = done;
        rs.detail = `${done}/${todo.length} pages`;
        ctx.run.activity = `Opening pages: ${done}/${todo.length}`;
        await ctx.save();
      }));
    }
    if (!ctx.run.sources.some((s) => s.read)) throw new Error("none of the pages could be opened");
    // an index the window shows and the agent can read
    const good = ctx.run.sources.filter((s) => s.file);
    await fs.writeFile(path.join(RUNS_DIR(), ctx.run.id, "sources.md"),
      `# Sources for ${ctx.run.title}\n\n${ctx.run.input.question ? `Question: ${ctx.run.input.question}\n\n` : ""}${ctx.run.sources.map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}\n   ${s.file ? s.file : "(not opened)"}${s.snippet ? `\n   ${s.snippet.slice(0, 200)}` : ""}`).join("\n\n")}\n`);
    void good;
  },
};

export const stepKinds = () => Object.keys(RUNNERS);

// ---------------------------------------------------------------- running one
export type StartOpts = {
  name: string;
  input?: Record<string, string>;
  /** the chat this run belongs to: the report is posted there and the window opens there */
  chat?: string | null;
  /** the message that will carry the card and the report (created by the caller when it owns the chat) */
  messageId?: string | null;
  /** where the report is saved, relative to the workspace (default: the chat's artifacts folder) */
  output?: string;
  emit?: Emit;
};

/**
 * Start a workflow: the record exists and the first step is underway when this returns. The work continues on
 * the server no matter who is looking (stopWorkflow ends it).
 */
export async function startWorkflow(opts: StartOpts): Promise<WorkflowRun> {
  await ensureWorkspace();
  const def = await findWorkflow(opts.name);
  if (!def) throw new Error(`there is no workflow called "${opts.name}" — look in workflows/`);
  if (!def.steps.length) throw new Error(`${def.name} does not parse: ${def.description}`);
  const st = await getSettings();
  const input = valuesFor(def, opts.input || {});
  for (const inp of def.inputs) if (inp.required && !input[inp.name]) throw new Error(`${def.title} needs "${inp.label}"`);
  const run: WorkflowRun = {
    id: nanoid(10), name: def.name, title: def.title, description: def.description, input,
    chat: opts.chat || null, messageId: opts.messageId || null, process: "",
    status: "running", startedAt: Date.now(), endedAt: null,
    steps: def.steps.map((s, i) => ({ id: `${i}-${s.kind}`, title: s.title, kind: s.kind, status: "pending" as const, note: "", detail: "", weight: Number(s.opts.weight) || (s.kind === "agent" ? 3 : 1), count: 0, target: 0 })),
    sources: [], log: [], progress: 0, activity: "Starting", report: "", artifacts: [], error: "",
  };
  await writeRun(run);

  const emit = opts.emit || (() => {});
  const ctx: Ctx = {
    run, def, st, emit, index: 0,
    save: async () => {
      // once a run has an end, nothing may move it again: a straggler's late save would revive it
      if (run.status !== "running") return;
      run.progress = progressOf(run);
      try { await writeRun(run); } catch { /* a failed write is not a failed run */ }
      emit({ t: "workflow", run: publicRun(run) });
    },
    log: (text, kind = "note") => { run.log.push({ at: Date.now(), text: text.slice(0, 300), kind }); if (run.log.length > 400) run.log.splice(0, run.log.length - 400); },
  };

  void (async () => {
    try {
      for (let i = 0; i < def.steps.length; i++) {
        assertRunning(run.id);
        const step = def.steps[i];
        ctx.index = i;
        const rs = run.steps[i];
        rs.status = "active";
        ctx.run.activity = step.title;
        await ctx.save();
        if (step.kind === "agent") await agentStep(step, ctx);
        else {
          const runner = RUNNERS[step.kind];
          if (!runner) throw new Error(`step "${step.kind}" has no runner`);
          await runner(step, ctx);
        }
        rs.status = "done";
        ctx.log(`${step.title} — done${rs.detail ? ` (${rs.detail})` : ""}`, "step");
        await ctx.save();
      }
      await finish(run, def, opts, "done");
    } catch (e) {
      const message = String((e as Error).message);
      if (cancelled.has(run.id)) {
        // the work was stopped, not broken: the record keeps whatever was really achieved
        const rs = run.steps[ctx.index];
        if (rs && rs.status === "active") { rs.status = "stopped"; rs.note = "stopped"; }
        ctx.log("stopped by the user", "note");
        await finish(run, def, opts, "stopped");
      } else {
        const rs = run.steps[ctx.index];
        if (rs && rs.status === "active") { rs.status = "failed"; rs.note = message.slice(0, 200); }
        run.error = message.slice(0, 500);
        ctx.log(`failed: ${run.error}`, "error");
        await finish(run, def, opts, "failed");
      }
    }
  })();

  return publicRun(run) as WorkflowRun;
}

/**
 * The one step that thinks. It runs against its own conversation (`wf-<runId>`), so the searches and the
 * framing stay out of the chat: the chat only ever receives the report.
 */
async function agentStep(step: WorkflowStep, ctx: Ctx) {
  const { run, def } = ctx;
  const rs = run.steps[ctx.index];
  rs.target = Math.max(4, Number(step.opts.expect) || 8);
  const procId = `wf-${run.id}`;
  run.process = procId;
  const [proc] = await db.insert(conversations).values({
    id: procId,
    title: `${def.title}: ${run.input.question || Object.values(run.input)[0] || ""}`.slice(0, 60),
    state: { workflow: def.name, run: run.id },
  }).returning();
  const userId = nanoid(12);
  await db.insert(messages).values({ id: userId, conversationId: procId, parentId: null, threadOf: null, role: "user", content: agentBrief(def, run), attachments: [], quote: null });
  ctx.log(`${step.title} — the agent starts`, "step");
  await ctx.save();

  const assistantId = nanoid(12);
  const { emit, finish: endProc } = startRun(procId, assistantId, userId);
  let calls = 0;
  const seen = new Set(run.sources.map((s) => s.url));
  const relay: Emit = (e) => {
    if (e.t === "toolStart" || e.t === "tool") {
      const name = String(e.name || "tool");
      const args = (e.args || {}) as Record<string, unknown>;
      const what = String(args.query ?? args.url ?? args.path ?? args.command ?? args.target ?? "");
      if (name === "web_search" || name === "web_fetch") calls++;   // the agent looking things up itself
      if (name !== "web_search" && name !== "web_fetch" && name !== "view_image") {
        run.activity = what ? `${name}: ${what.slice(0, 70)}` : name;
        ctx.log(`${name}${what ? ` — ${what.replace(/\s+/g, " ").slice(0, 70)}` : ""}`, "tool");
      }
      rs.count = Math.min(rs.target, calls + run.log.filter((l) => l.kind === "tool").length);
      rs.detail = `${rs.count} tool calls`;
      void ctx.save();
    } else if (e.t === "toolResult" && e.ok !== false) {
      const meta = e.meta as { sources?: { url: string; title?: string }[] } | undefined;
      for (const s of meta?.sources || []) if (s.url && !seen.has(s.url)) { seen.add(s.url); run.sources.push({ url: s.url, title: String(s.title || s.url), snippet: "", read: true }); }
      void ctx.save();
    } else if (e.t === "text") {
      run.draft = (run.draft || "") + String(e.d ?? "");
    }
  };
  try {
    await runAgent({ conv: proc, assistantId, parentId: userId, threadOf: null, emit: relay, signal: new AbortController().signal });
  } finally {
    endProc();
  }
  // prefer the saved message (it is the answer, complete), fall back to what streamed past us
  const rows = await db.select().from(messages).where(eq(messages.conversationId, procId));
  // the report is the prose the agent wrote — never the tool gist, never the reasoning
  const saved = rows.filter((m) => m.role === "assistant")
    .map((m) => m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n"))
    .join("\n").trim();
  const answer = saved || (run.draft || "").trim();
  if (answer) { run.report = answer; run.draft = undefined; }
  const wrote = rows.some((m) => m.parts.some((p) => p.type === "tool" && (p.name === "fs_write" || p.name === "fs_edit")));
  ctx.log(wrote ? "the report was also written to a file" : "the answer is in the window", "note");
  rs.count = rs.target;
  rs.detail = wrote ? "report written" : "answered";
}

/** Save the report as a file, put it in the chat, close the record and tell everyone. */
async function finish(run: WorkflowRun, def: WorkflowDef, opts: StartOpts, status: WorkflowRun["status"]) {
  run.status = status;
  run.endedAt = Date.now();
  const report = (run.report || run.draft || "").trim();
  run.report = report;
  delete run.draft;
  const slug = canvasSlug(`${def.title} ${run.input.question || Object.values(run.input)[0] || ""}`) || "report";
  const rel = opts.output || (run.chat ? `${chatDir(run.chat)}/artifacts/${slug}.md` : `artifacts/${slug}.md`);
  if (report && rel && !rel.includes("..")) {
    try {
      const abs = path.join(WS, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, `${report}\n`);
      if (!run.artifacts.includes(rel)) run.artifacts.push(rel);
    } catch { /* the report is still in the chat and in the window */ }
  }
  run.progress = status === "done" ? 1 : progressOf(run);
  run.activity = status === "done" ? "Done" : status === "failed" ? "Failed" : "Stopped";
  await writeRun(run);
  if (run.chat && run.messageId) {
    const parts: Part[] = [{ type: "workflow", run: run.id, name: run.name, title: run.title, input: Object.values(run.input)[0] || "" }];
    parts.push({ type: "text", text: report || (status === "done" ? "The workflow finished without a report." : `The workflow ${status}: ${run.error || "stopped"}`) });
    await db.update(messages).set({ parts }).where(eq(messages.id, run.messageId)).catch(() => {});
  }
  opts.emit?.({ t: "workflow", run: publicRun(run) });
  opts.emit?.({ t: "workflow-done", run: run.id, status: run.status, chat: run.chat });
  return run;
}

export async function stopWorkflow(id: string) {
  const run = await readRun(id);
  if (!run || run.status !== "running") return false;
  cancelled.add(run.id);
  run.status = "stopped";
  run.progress = progressOf(run);   // what was really done, not a rounded-up 100%
  await writeRun(run);
  // whoever is still in the loop will not write again: the record already has its ending
  return true;
}

/** What the client sees: `draft` is internal, and the report replaces it when the run ends. */
/**
 * Save a workflow: structured parts in, `workflows/<name>/workflow.md` out. The text goes back through the
 * parser before it is written, so a definition that could not run is refused here — with the parser's own
 * sentence as the error — instead of failing at the start of a run hours later.
 */
export async function saveWorkflow(spec: WorkflowSpec): Promise<WorkflowDef> {
  await ensureWorkspace();
  const name = String(spec.name || "").trim();
  if (!/^[\w-]+$/.test(name)) throw new Error("name must be one word (letters, digits, - and _)");
  const dir = path.join(WORKFLOWS_DIR(), name);
  const file = path.join(dir, "workflow.md");
  if (fss.existsSync(file) && !spec.overwrite) throw new Error(`${name} already exists — pass overwrite=true to replace it`);
  const text = workflowText(spec);
  const def = parseWorkflow(text, dir); // throws with the reason if this could not run
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, text);
  return def;
}

/**
 * Start a run that reports into a chat: the card joins the conversation now, the report replaces it when the
 * work is done. Used by the composer, by `/api/workflows` and by the `start_workflow` tool, so all three behave
 * the same way — the caller gets the run back immediately and never waits for it.
 */
export async function startInChat(name: string, input: Record<string, string>, chat: string, emit?: Emit) {
  const rows = await db.select({ id: messages.id, parentId: messages.parentId }).from(messages).where(eq(messages.conversationId, chat));
  const withChild = new Set(rows.map((m) => m.parentId).filter(Boolean));
  const leaves = rows.filter((m) => !withChild.has(m.id));
  const parentId = (leaves[leaves.length - 1]?.id || rows[rows.length - 1]?.id || "") as string;
  const messageId = nanoid(12);
  const title = `Workflow: ${name}`;
  await db.insert(messages).values({ id: messageId, conversationId: chat, parentId: parentId || null, threadOf: null, role: "assistant", content: title, parts: [{ type: "workflow", run: "", name, title, input: Object.values(input)[0] || "" }] });
  try {
    const run = await startWorkflow({ name, input, chat, messageId, emit });
    await db.update(messages).set({ parts: [{ type: "workflow", run: run.id, name: run.name, title: run.title, input: Object.values(run.input)[0] || "" }] }).where(eq(messages.id, messageId));
    return { run, messageId };
  } catch (e) {
    const text = String((e as Error).message);
    await db.update(messages).set({ parts: [{ type: "text", text: `The workflow did not start: ${text}` }] }).where(eq(messages.id, messageId)).catch(() => {});
    throw e;
  }
}

/** Every run this workspace knows about, newest first, plus the definitions to start new ones. */
export async function workflowCatalog() {
  const [defs, runs] = await Promise.all([listWorkflows(), listRuns()]);
  return {
    workflows: defs.map((d) => ({ name: d.name, title: d.title, description: d.description, inputs: d.inputs, steps: d.steps.map((s) => ({ kind: s.kind, title: s.title })), ok: d.steps.length > 0 })),
    runs: runs.map((r) => publicRun(r)),
  };
}
