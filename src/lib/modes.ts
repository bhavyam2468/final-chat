/**
 * Modes: the posture a conversation runs in. A mode is three things and nothing more —
 *   1. a skill that is injected automatically (system/skills/mode-<name>/SKILL.md, editable like any skill),
 *   2. a tool restriction (deny list: the definitions disappear and the dispatcher refuses the call),
 *   3. a UI affordance (the composer shows the mode, /mode <tab> switches it).
 * Same idea as Cursor's Agent/Ask/Plan and Claude's plan mode: not a second engine, just a narrower
 * system prompt plus fewer tools. `chat` is the default and changes nothing.
 *
 * Restrictions are enforced in two places so a weak model cannot drift:
 *   agent.ts  → toolDefs() drops the denied definitions (it never sees the schema)
 *   tools/index.ts → the dispatcher refuses a denied name anyway (queued/steered messages, stale prompts)
 */
export type ModeId = "chat" | "search" | "plan" | "debug" | "build" | "learn" | "write";

export type ModeDef = {
  id: ModeId;
  /** shown in the picker and on the composer chip */
  label: string;
  /** one line for the picker */
  hint: string;
  /** skill folder under system/skills that is auto-invoked while this mode is on */
  skill: string;
  /** used when that skill file is missing (never let a mode silently become plain chat) */
  fallback: string;
  /** tools the mode refuses; empty = everything the packs allow */
  deny: string[];
};

const MUTATORS = ["fs_write", "fs_edit", "fs_insert", "fs_move", "fs_delete"];
const SHELLS = ["shell", "host_shell"];
const INSTALLS = ["pip_install", "skill_create", "mcp_add"];
const PROCS = ["proc_start", "proc_write", "proc_signal", "proc_restart", "proc_stop"];

export const MODES: ModeDef[] = [
  { id: "chat", label: "chat", hint: "Normal conversation", skill: "", fallback: "", deny: [] },
  {
    id: "search", label: "search", hint: "Web first, sourced, read-only", skill: "mode-search",
    fallback: "Answer only from pages you actually opened with web_search/web_fetch, cite them inline, and never touch files.",
    deny: [...MUTATORS, ...SHELLS, ...INSTALLS, ...PROCS, "run_python", "file_run", "check", "browser", "mcp_add", "skill_create"],
  },
  {
    id: "plan", label: "plan", hint: "Read-only reconnaissance, then a plan", skill: "mode-plan",
    fallback: "Do not change anything. Read, measure and run evidence only, then present a plan and ask before building.",
    deny: [...MUTATORS, ...SHELLS, ...INSTALLS, ...PROCS, "check", "browser", "workflow_start"],
  },
  {
    id: "debug", label: "debug", hint: "Reproduce, read the real error, minimal fix", skill: "mode-debug",
    fallback: "Reproduce before theorising, read the actual error, fix the smallest cause, then re-run to prove it.",
    deny: [],
  },
  {
    id: "build", label: "build", hint: "Implement, run it, report what changed", skill: "mode-build",
    fallback: "Implement completely, verify by running the thing, and report the files and commands that matter.",
    deny: [],
  },
  {
    id: "learn", label: "learn", hint: "Teach in small steps, check understanding", skill: "mode-learn",
    fallback: "Teach: one idea at a time, a tiny example, then a question that checks understanding. Do not do their work for them.",
    deny: [...MUTATORS, ...SHELLS, ...INSTALLS, ...PROCS, "check"],
  },
  {
    id: "write", label: "write", hint: "Documents and prose: structure first", skill: "mode-write",
    fallback: "Outline first, then write the document in a canvas; prose over bullet walls. Do not run commands.",
    deny: [...SHELLS, ...INSTALLS, ...PROCS, "check", "file_run", "run_python", "browser"],
  },
];

export const DEFAULT_MODE: ModeId = "chat";
export const modeOf = (id?: string): ModeDef => MODES.find((m) => m.id === id) || MODES[0];
export const isMode = (id?: string): id is ModeId => MODES.some((m) => m.id === id);
export const modeIds = MODES.map((m) => m.id);

/** Modes that are postures inside a chat. `general` is a separate surface (quiet, no auto-search). */
export const GENERAL_SURFACE = "general";
