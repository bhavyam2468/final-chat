import type { ToolDef } from "./tools";

/**
 * Modes: one lens on the agent for a whole chat.
 *
 * A mode is three things that always move together, and that is the point — a mode the model could ignore
 * would just be a prompt suggestion:
 *   1. a hard tool policy, applied to the request itself (the tool is not even in the list), so "search mode
 *      cannot write files" is a fact about the API call and not a hope about the model's behaviour;
 *   2. a short constraint block appended to the system prompt, so the style of the mode holds even on the
 *      first token;
 *   3. a skill file (`system/skills/mode-<id>/SKILL.md`) with the long-form guidance, auto-loaded while the
 *      mode is active — the file is the documentation, so a mode can be read, edited or replaced without
 *      touching code, and it doubles as the thing a person opens to learn what the mode does.
 *
 * The registry is the source of truth for the first two; the third lives on disk and can be edited by hand.
 * `general` (the separate, quiet history) predates modes and stays as it was: it is a place, not a lens.
 */
export type ModeId = "research" | "plan" | "code" | "learn" | "write" | "data";

export type Mode = {
  id: ModeId;
  label: string;
  /** one line for the picker: what this chat becomes */
  hint: string;
  /** the hard constraints, appended to the system prompt while the mode is active */
  prompt: string;
  /** tools this mode refuses, by name (a prefix ending in `*` matches a family, e.g. `adb_*`) */
  deny: string[];
  /** when set, only these are available (a prefix ending in `*` matches a family) */
  allow?: string[];
  /** steps the agent may take in one turn */
  steps: number;
};

const ALL_RESEARCH = ["web_search", "web_fetch", "web_extract"];
const WRITES = ["fs_write", "fs_edit", "fs_insert", "fs_move", "fs_delete"];
const RUNS = ["run_python", "pip_install", "shell", "host_shell", "proc_*", "browser", "adb_*"];

export const MODES: Mode[] = [
  {
    // not "search": that id already means the quiet general history here, and one word cannot mean two things
    id: "research",
    label: "Search",
    hint: "Answers from the web, cited — nothing gets written",
    steps: 14,
    deny: [...WRITES, ...RUNS, "canvas_open", "skill_create", "skill_install", "workflow_save", "mcp_add", "mcp_remove", "remember", "forget"],
    prompt: `Every factual claim in this chat comes from a page opened in this turn. Search first, open the pages, cite them inline as [n](url) with the source date for anything that changes. If a search contradicts what you thought you knew, the page wins and the difference is worth one line.
This chat writes nothing: no files, no canvases, no memory. A table of what the sources say belongs in the reply as a block; code the user might run belongs in the reply as a code fence. If the user wants something saved or run, say they can switch to Code (or run /mode code) and do it there.\nFor a question that deserves several sources, start the deep-research workflow (start_workflow) instead of searching step by step: the app does the searching and the reading in the run window, and the cited report comes back into this chat.`,
  },
  {
    id: "plan",
    label: "Plan",
    hint: "Think and structure it — nothing is executed",
    steps: 10,
    deny: [...WRITES, ...RUNS, "canvas_open", "workflow_save", "remember", "forget"],
    prompt: `This chat plans; it does not do. Read what you need (files, web, the workspace tree) and produce the plan: ordered steps, what each one touches, the decisions that are actually open, the risks and how you would notice them, and what "done" looks like.
Never edit a file, never run a shell command, never open a canvas. When a decision is the user's, ask it as one question with real options (ask_user) instead of assuming. End by naming the smallest first step, so a yes can turn this plan into work in a Code chat.`,
  },
  {
    id: "code",
    label: "Code",
    hint: "Implement, run and verify — files and shells allowed",
    steps: 40,
    deny: [],
    prompt: `This chat builds. Read the surrounding code before changing it, make the smallest diff that is correct, run the tests (or the thing itself) and say what you verified and what you could not. Fix causes rather than symptoms; never silence an error to make output green.
Say which files changed and why in one line each. Prefer the project's existing tools and patterns over new dependencies. A plan first only when the change is genuinely architectural.`,
  },
  {
    id: "learn",
    label: "Learn",
    hint: "Teach it, don't do it — questions, decks, figures",
    steps: 16,
    deny: [...WRITES, ...RUNS],
    prompt: `This chat teaches. Build understanding instead of finishing the task: a short idea, one concrete example, then something the user does themselves (x-choice, x-deck, a worked problem with the last step missing, x-timer for practice). Use figures and blocks the way a good textbook does — x-graph for the shape of a function, x-tikz for a setup, x-draw for a quick sketch — and keep prose tight.
Ask what they already know when the level is unclear (ask_user with real options). When they get something wrong, find the specific step that broke and fix that step; no praise, no filler. Do not write their answers into files, and do not answer a question they asked themselves.`,
  },
  {
    id: "write",
    label: "Write",
    hint: "Documents and prose — drafting into files",
    steps: 20,
    deny: [...RUNS, "browser", "adb_*"],
    prompt: `This chat writes prose, essays and documents. The deliverable is a file in the chat's folder (or the artifacts folder for something the user keeps): write it, then show what changed or what is there.
Voice: plain, specific, no marketing rhythm, no triads, no filler transitions. Argue with evidence rather than adjectives. Keep the user's own phrasing where it is already good.
Blocks are for data inside the document (a table, a timeline, a chart), never for decoration; the prose is markdown. Do not run shells or code.`,
  },
  {
    id: "data",
    label: "Data",
    hint: "Numbers first — compute, then show it",
    steps: 20,
    deny: [],
    prompt: `This chat works with numbers. Compute before you answer: use run_python (or the shell) for any arithmetic past one step, any aggregation, any statistics, and show the computation's inputs when the result is surprising. Never estimate a number you could calculate.
Present results as blocks: x-table for a dataset (it totals and sorts by itself), x-chart for comparison over time or categories, x-stat for one figure that matters, x-heatmap for a pattern over a grid. State the unit and the source of every number, and say plainly when the data does not support a conclusion.`,
  },
];

export const modeOf = (id?: string | null): Mode | null => (id ? MODES.find((m) => m.id === id) || null : null);
export const isModeId = (id: unknown): id is ModeId => typeof id === "string" && MODES.some((m) => m.id === id);

const hit = (names: string[], tool: string) => names.some((n) => (n.endsWith("*") ? tool.startsWith(n.slice(0, -1)) : n === tool));

/** The tools a mode leaves on the table. Applied to the request, so a denied tool is not merely discouraged. */
export function toolsForMode(mode: Mode | null, tools: ToolDef[]): ToolDef[] {
  if (!mode) return tools;
  return tools.filter((t) => {
    const name = t.function.name.replace(/^mcp__.*__/, (m) => m); // MCP tools keep their qualified name
    if (mode.allow) return hit(mode.allow, name);
    return !hit(mode.deny, name);
  });
}

/** Is this tool name available under the mode? (Used to gate a call that was already produced.) */
export const modeAllows = (mode: Mode, tool: string): boolean => (mode.allow ? hit(mode.allow, tool) : !hit(mode.deny, tool));

/** Refusal message for a tool that is not available in this mode (the model may still try: MCP tools change). */
export function modeRefusal(mode: Mode, tool: string): string {
  return `${tool} is not available in ${mode.label} mode (${mode.hint}). Say what you would do with it and ask the user to leave the mode (or run /mode code) if they want it done.`;
}

/** Everything the model is told about the mode: the hard rules plus the skill file, when one exists. */
export function modeBlock(mode: Mode, skillBody?: string): string {
  const denied = mode.allow ? `only: ${mode.allow.join(", ")}` : mode.deny.length ? mode.deny.join(", ") : "nothing";
  const body = (skillBody || "").replace(/^---[\s\S]*?---\n/, "").trim();
  return `# Mode: ${mode.label} (active — the user chose it with /mode ${mode.id})\n${mode.prompt}\n\nTools: ${denied === "nothing" ? "all" : `blocked here — ${denied}`}. Asking to leave the mode is the only way around that; do not try to work around it.\n${body ? `\n${body.slice(0, 4000)}` : ""}`;
}

/** The skill file that belongs to a mode: `system/skills/mode-<id>/SKILL.md` (read through findSkill). */
export const modeSkillName = (mode: Mode) => `mode-${mode.id}`;

/** The modes' own index line for the skill list (kept short: the picker is what people read). */
export const MODE_SKILL_PREFIX = "mode-";
export const isModeSkill = (name: string) => name.startsWith(MODE_SKILL_PREFIX) && isModeId(name.slice(MODE_SKILL_PREFIX.length));
