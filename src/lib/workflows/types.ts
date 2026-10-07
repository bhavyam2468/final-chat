/**
 * Workflows are windows, not blocks.
 *
 * A block is one rendered idea; a workflow is a reusable pipeline that runs several model and tool
 * steps in a defined order and keeps everything it produces *outside* the conversation. The window is
 * where the work is visible (plan, searches, what each page actually said, the draft, the check); the
 * chat only receives what the workflow decides to deliver — for deep research that is the report, so
 * a run that read thirty pages still costs one message of context.
 *
 * The shape below is the contract the runner, the window and the authoring skill share. A definition
 * is data (steps, budgets, prompts, panes) so a workflow can be overridden from the workspace and, in
 * the marketplace direction, shipped as a file; the step *kinds* are the engine's vocabulary and new
 * ones are added in `runner.ts` next to the code that can actually run them.
 */

export type StepKind = "plan" | "search" | "select" | "read" | "gaps" | "write" | "check" | "deliver";

export type StepSpec = {
  id: string;
  /** one line in the step rail */
  title: string;
  /** what this step is doing, in the workflow's own words */
  note: string;
  kind: StepKind;
};

/** Pane ids are the window's views: native ones live in components/Workflow.tsx, block-backed ones
    (sources, evidence) render real BlocksUI inside the window. */
export type PaneView = "steps" | "plan" | "sources" | "evidence" | "report" | "log";
export type PaneDef = { id: string; title: string; view: PaneView };

export type Budget = {
  /** how many sub-questions the planner may ask (min, max) */
  sub: [number, number];
  /** search results requested per query */
  perQuery: number;
  /** candidate sources offered to the selector */
  candidates: number;
  /** pages actually opened and distilled */
  reads: number;
  /** follow-up queries the gap pass may add (0 disables the second round) */
  followups: number;
  /** max characters of a page handed to the extractor */
  pageChars: number;
  /** completion budget for the long steps */
  writeTokens: number;
};

export type WorkflowDef = {
  id: string;
  name: string;
  /** one line, shown in the palette and on the window */
  hint: string;
  /** lucide icon key, mapped in the UI */
  icon: string;
  input: { label: string; placeholder: string };
  budget: Budget;
  steps: StepSpec[];
  panes: PaneDef[];
  /** what leaves the window when the run finishes */
  deliver: "report";
  /** step prompts, overridable from workspace/workflows/<id>.json */
  prompts: Record<string, string>;
};

// ------------------------------------------------------------------ run state

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type StepState = {
  id: string;
  title: string;
  status: StepStatus;
  /** the live/done summary line, e.g. "11 pages read · 43 claims" */
  note?: string;
  startedAt?: number;
  ms?: number;
  items?: number;
};

export type Source = {
  id: number;
  url: string;
  title: string;
  host: string;
  snippet: string;
  /** which sub-question found it */
  sq?: string;
  /** selector: why this page is worth reading */
  why?: string;
  /** read pass */
  read?: boolean;
  chars?: number;
  /** sub-question ids the extractor says this page speaks to */
  answers?: string[];
  claims?: { text: string; quote: string }[];
  points?: string[];
  /** distillation failed (paywall, 404, anti-bot) — kept visible, never silently dropped */
  failed?: string;
};

export type RunState = {
  id: string;
  workflow: string;
  workflowName: string;
  question: string;
  conversationId?: string;
  status: "running" | "done" | "failed" | "stopped";
  createdAt: number;
  endedAt?: number;
  steps: StepState[];
  /** the def's panes travel with the run: the window renders itself from the snapshot, like the step rail */
  panes: PaneDef[];
  plan?: { sub: { id: string; q: string; queries: string[] }[] };
  sources: Source[];
  followups: { q: string; query: string; sq?: string }[];
  report?: string;
  reportPath?: string;
  check?: { ok: boolean; issues: { kind: string; detail: string }[]; revised?: boolean };
  log: { at: number; step: string; text: string }[];
  /** the chat message the report was delivered as */
  messageId?: string;
  error?: string;
  stats: { queries: number; fetched: number; read: number; claims: number; calls: number };
};

/** Live events: the client replaces state on `state` and patches on the rest. */
export type RunEvent =
  | { t: "state"; state: RunState }
  | { t: "step"; id: string; patch: Partial<StepState> }
  | { t: "log"; line: RunState["log"][number] }
  | { t: "plan"; plan: NonNullable<RunState["plan"]> }
  | { t: "sources"; sources: Source[] }
  | { t: "report"; report: string }
  | { t: "check"; check: NonNullable<RunState["check"]> }
  | { t: "done"; status: RunState["status"]; messageId?: string; error?: string };
