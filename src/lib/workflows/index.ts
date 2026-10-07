import fs from "fs/promises";
import path from "path";
import { WS } from "../workspace";
import { deepResearch } from "./deep-research";
import type { Budget, PaneDef, WorkflowDef } from "./types";

/**
 * The workflow registry. Built-ins are code, because a workflow's steps are only as good as the code
 * that can run them; everything a team would want to change per install — name, budgets, prompts —
 * is data, and workspace/workflows/<id>.json overrides it. That file is also the unit the marketplace
 * direction ships: share a workflow, get its prompts and budgets, nothing to compile.
 */

const BUILTIN: WorkflowDef[] = [deepResearch];

export const listWorkflows = (): WorkflowDef[] => BUILTIN;
export const workflowOf = (id: string): WorkflowDef | undefined => BUILTIN.find((w) => w.id === id);

const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");
const VIEWS: PaneDef["view"][] = ["steps", "plan", "sources", "evidence", "report", "log"];

/** Anything malformed in an override file is ignored, field by field: a typo must not disable a workflow. */
function merge(def: WorkflowDef, raw: unknown): WorkflowDef {
  if (!raw || typeof raw !== "object") return def;
  const j = raw as Record<string, unknown>;
  const b = (j.budget && typeof j.budget === "object" ? j.budget : {}) as Record<string, unknown>;
  const db: Budget = def.budget;
  const subRaw = Array.isArray(b.sub) ? b.sub : [];
  const budget: Budget = {
    sub: [num(subRaw[0], 1, 8, db.sub[0]), num(subRaw[1], 1, 12, db.sub[1])],
    perQuery: num(b.perQuery, 1, 10, db.perQuery),
    candidates: num(b.candidates, 4, 80, db.candidates),
    reads: num(b.reads, 1, 30, db.reads),
    followups: num(b.followups, 0, 8, db.followups),
    pageChars: num(b.pageChars, 1000, 24000, db.pageChars),
    writeTokens: num(b.writeTokens, 500, 8000, db.writeTokens),
  };
  const prompts: Record<string, string> = { ...def.prompts };
  if (j.prompts && typeof j.prompts === "object") for (const [k, v] of Object.entries(j.prompts as Record<string, unknown>)) if (k in prompts) { const s = str(v, 8000); if (s) prompts[k] = s; }
  const panes: PaneDef[] = Array.isArray(j.panes)
    ? (j.panes as unknown[]).map((p, i) => {
        const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
        const view = VIEWS.includes(o.view as PaneDef["view"]) ? (o.view as PaneDef["view"]) : null;
        return view ? { id: str(o.id, 40) || `pane${i}`, title: str(o.title, 40) || view, view } : null;
      }).filter((p): p is PaneDef => !!p).slice(0, 8)
    : def.panes;
  return { ...def, name: str(j.name, 60) || def.name, hint: str(j.hint, 140) || def.hint, budget, prompts, steps: def.steps, panes: panes.length ? panes : def.panes };
}

/** Read the workspace override for a definition (if any) and apply it. */
export async function loadWorkflow(id: string): Promise<WorkflowDef | undefined> {
  const def = workflowOf(id);
  if (!def) return undefined;
  try {
    const text = await fs.readFile(path.join(WS, "workflows", `${id}.json`), "utf8");
    return merge(def, JSON.parse(text));
  } catch { return def; }
}
