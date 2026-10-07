import { NextRequest } from "next/server";
import { listWorkflows } from "@/lib/workflows";
import { activeRuns, recentRuns, startWorkflowRun, stopRun } from "@/lib/workflows/runner";

export const dynamic = "force-dynamic";

/**
 * GET  — the definitions this install offers, what is running now, and runs that finished in the last
 *        couple of minutes (the chat page polls this: it is how a delivered report gets noticed).
 * POST — start a run (`{workflow, input, conversationId?}`) or stop one (`{stop: runId}`).
 */
export async function GET() {
  return Response.json({
    workflows: listWorkflows().map((w) => ({ id: w.id, name: w.name, hint: w.hint, icon: w.icon, input: w.input, steps: w.steps.length, panes: w.panes.map((p) => p.title) })),
    active: activeRuns(),
    recent: recentRuns(),
  });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { workflow?: string; input?: string; conversationId?: string; stop?: string };
  if (b.stop) return Response.json({ stopped: stopRun(String(b.stop)) });
  const r = await startWorkflowRun({
    workflow: String(b.workflow || "deep-research"),
    question: String(b.input || ""),
    conversationId: b.conversationId ? String(b.conversationId) : undefined,
  });
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json(r);
}
