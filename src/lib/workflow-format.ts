/**
 * The workflow *format* — the file, the record, what progress means — with no database, no filesystem and no
 * settings, so it can be read, reasoned about and tested on its own (`dev/tests/workflows.test.ts`). The engine
 * that runs a workflow lives in `workflows.ts` and re-exports everything here.
 *
 * A workflow is a folder under `workflows/<name>/` with a `workflow.md` in it — front matter for the shape, the
 * body for the brief. The front matter is deliberately small and one line per thing, no nesting, so a person can
 * read it and a model cannot get it wrong:
 *
 *   ---
 *   name: deep-research
 *   title: Deep research
 *   description: Searches the web, opens the pages, writes a cited report.
 *   inputs:
 *     - question | What should it look into?          (add "| optional" to make it optional)
 *   steps:
 *     - search limit=8      | Find sources
 *     - read limit=6        | Open the pages
 *     - agent               | Plan and write the report
 *   ---
 *   # How to research        <- the brief the agent follows
 */
import path from "path";

export type WorkflowInput = { name: string; label: string; required: boolean };
export type WorkflowStep = { kind: string; title: string; opts: Record<string, string> };
export type WorkflowDef = {
  name: string; title: string; description: string;
  inputs: WorkflowInput[]; steps: WorkflowStep[]; body: string; dir: string;
};
/** What a caller (the tool, the API, the composer) hands over to save a new workflow. */
export type WorkflowSpec = {
  name: string; title?: string; description?: string;
  inputs?: { name: string; label?: string; optional?: boolean }[];
  steps: { kind: string; title?: string; opts?: Record<string, string | number> }[];
  body: string; overwrite?: boolean;
};

export const KINDS = ["search", "read", "agent"];

/**
 * The options on a step line, space-separated — except that `"a whole query in quotes"` is one option, because
 * a search for the words that matter is the normal case and nobody should have to know a query must be one word.
 */
function splitOpts(text: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; cur += ch; continue; }
    if (!quoted && /\s/.test(ch)) { if (cur) out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseWorkflow(text: string, dir: string): WorkflowDef {
  const label = `workflows/${path.basename(dir)}/workflow.md`;
  const fail = (why: string): never => { throw new Error(`${label}: ${why}`); };
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) fail("it needs front matter between --- lines (name, title, description, inputs, steps)");
  const def: WorkflowDef = { name: "", title: "", description: "", inputs: [], steps: [], body: text.slice(fm![0].length).trim(), dir };
  let list: "inputs" | "steps" | null = null;
  for (const raw of fm![1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const item = line.match(/^-\s*(.*)$/);
    if (item) {
      if (!list) fail(`"${line}" is a list item outside a list — put it under inputs: or steps:`);
      if (list === "steps") {
        const [left, right] = item[1].split("|");
        const words = splitOpts(left.trim());
        const kind = words.shift() || "";
        if (!KINDS.includes(kind)) fail(`"${kind || line}" is not a step kind (known: ${KINDS.join(", ")})`);
        const opts: Record<string, string> = {};
        for (const w of words) {
          const i = w.indexOf("=");
          if (i < 1) fail(`"${w}" is not an option — write key=value (e.g. limit=6)`);
          opts[w.slice(0, i)] = w.slice(i + 1).replace(/^"([\s\S]*)"$/, "$1");   // "a query in quotes" is one value
        }
        def.steps.push({ kind, title: (right || "").trim() || kind[0].toUpperCase() + kind.slice(1), opts });
      } else {
        const [name, label2, flag] = item[1].split("|").map((s) => s.trim());
        if (!/^[\w-]+$/.test(name || "")) fail(`an input name must be a single word (got "${name || item[1]}")`);
        // "optional" counts wherever it is written: as the third part, or in the label (which is how people write
        // it by hand). A question with an optional answer must never block the run that asks it.
        const optional = [flag, label2].some((t) => /\boptional\b/i.test(t || ""));
        def.inputs.push({ name, label: label2 || name, required: !optional });
      }
      continue;
    }
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!kv) fail(`"${line}" is not understood — use key: value or a "- " list item`);
    const [, k, v] = kv!;
    if (k === "inputs" || k === "steps") { list = k as "inputs" | "steps"; continue; }
    list = null;
    if (k === "name" || k === "title" || k === "description") def[k] = v.trim();
    else fail(`unknown key "${k}" (known: name, title, description, inputs, steps)`);
  }
  if (!def.name) def.name = path.basename(dir);
  if (!/^[\w-]+$/.test(def.name)) fail(`name "${def.name}" must be one word (letters, digits, - and _)`);
  if (!def.title) def.title = def.name;
  if (!def.steps.length) fail("it has no steps — add at least one under steps:");
  if (def.steps.filter((s) => s.kind === "agent").length > 1) fail("use one agent step: it is the one that thinks, and it runs last");
  if (def.steps.some((s, i) => s.kind === "agent" && i !== def.steps.length - 1)) fail("the agent step has to be last — the steps before it feed it");
  return def;
}

/** The file a spec turns into. Kept separate from saving so the round trip can be tested without a workspace. */
export function workflowText(spec: WorkflowSpec): string {
  const name = String(spec.name || "").trim();
  if (!/^[\w-]+$/.test(name)) throw new Error("name must be one word (letters, digits, - and _)");
  const stepLine = (st: WorkflowSpec["steps"][number]) => {
    const opts = Object.entries(st.opts || {}).filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => `${k}=${String(v).replace(/\s+/g, "")}`).join(" ");
    return `  - ${st.kind}${opts ? " " + opts : ""}${st.title ? ` | ${String(st.title).replace(/[|\n]/g, " ").trim()}` : ""}`;
  };
  return [
    "---",
    `name: ${name}`,
    `title: ${String(spec.title || name).replace(/[\n|]/g, " ").trim()}`,
    `description: ${String(spec.description || "").replace(/[\n|]/g, " ").trim()}`,
    ...((spec.inputs || []).length ? ["inputs:", ...(spec.inputs || []).map((i) => `  - ${String(i.name).trim()} | ${String(i.label || i.name).replace(/[\n|]/g, " ").trim()}${i.optional ? " | optional" : ""}`)] : []),
    "steps:",
    ...(spec.steps || []).map(stepLine),
    "---",
    String(spec.body || "").trim(),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- the run record
export type RunStep = { id: string; title: string; kind: string; status: "pending" | "active" | "done" | "failed" | "skipped" | "stopped"; note: string; detail: string; weight: number; count: number; target: number };
export type RunSource = { url: string; title: string; snippet: string; read: boolean; words?: number; file?: string };
export type RunLog = { at: number; text: string; kind: "step" | "tool" | "note" | "error" };
export type WorkflowRun = {
  id: string; name: string; title: string; description: string;
  input: Record<string, string>;
  /** the chat the report is posted to (null when a workflow is run on its own) */
  chat: string | null;
  /** the message in that chat carrying the card and, at the end, the report */
  messageId: string | null;
  /** the hidden conversation the agent works in: the window can show its transcript */
  process: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: number; endedAt: number | null;
  steps: RunStep[]; sources: RunSource[]; log: RunLog[];
  progress: number; activity: string;
  report: string; artifacts: string[]; error: string;
  /** set while the thinking step is producing its answer */
  draft?: string;
};

/** How far along a run is: finished steps over declared work, the active step counted by what it has done. */
export function progressOf(run: WorkflowRun) {
  const total = run.steps.reduce((a, s) => a + s.weight, 0) || 1;
  const part = (s: RunStep) => {
    if (s.status === "done" || s.status === "skipped") return 1;
    if (s.status === "failed") return 0.5;
    if (s.status !== "active") return 0;   // pending and stopped are honestly unfinished
    return s.target > 0 ? Math.min(0.95, s.count / s.target) : 0.1;
  };
  return Math.max(0, Math.min(1, run.steps.reduce((a, s) => a + s.weight * part(s), 0) / total));
}

export const fill = (text: string, input: Record<string, string>) =>
  String(text).replace(/\{\{(\w+)\}\}/g, (_, k: string) => input[k] ?? Object.values(input)[0] ?? "");

export const valuesFor = (def: WorkflowDef, given: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const inp of def.inputs) out[inp.name] = String(given[inp.name] ?? "").trim();
  // "just run it with this" still works for a workflow that declares inputs: the text goes to the first one
  if (def.inputs.length && !Object.values(out).some(Boolean) && given.question) out[def.inputs[0].name] = String(given.question).trim();
  if (!def.inputs.length && given.question) out.question = String(given.question).trim();
  return out;
};

/** The brief the thinking step receives: the file's body, this run's inputs, and the material gathered. */
export function agentBrief(def: WorkflowDef, run: WorkflowRun) {
  const inputs = Object.entries(run.input).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
  const done = run.steps.filter((s) => s.status === "done").map((s) => s.title);
  const read = run.sources.filter((s) => s.file);
  const material = read.length
    ? `# Pages already fetched for you\nDo not search for or fetch these again — read the ones you need with fs_read, and cite them.\n${read.map((s, i) => `${i + 1}. ${s.title} — ${s.url}\n   ${s.file}${s.words ? ` (${s.words} words)` : ""}`).join("\n")}\n\nEvery source found, including the ones that could not be opened:\n${run.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n")}`
    : "# No pages were fetched\nNothing was found or nothing could be opened. Say that plainly; do not invent sources.";
  return `# Workflow: ${def.title} (${def.name})\n${def.description}\n\n# This run\n${inputs || "(no input)"}\n\nAlready done, in this order: ${done.join(" → ") || "nothing yet"}. What is left is yours: ${def.steps.find((s) => s.kind === "agent")?.title || "finish it"}.\n\n${material}\n\n# The workflow's brief\n${fill(def.body, run.input)}`;
}

/** The record as everything outside the engine sees it: the draft in progress is the engine's own business. */
export function publicRun(run: WorkflowRun): WorkflowRun {
  const { draft: _draft, ...rest } = run;
  return rest;
}
