import { NextRequest } from "next/server";
import { readRun, workflowUi, findWorkflow, listWorkflows } from "@/lib/workflows";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** A workflow may ship its own Blocks window (workflows/<name>/ui.html). Empty means "use the default". */
export async function GET(_req: NextRequest, { params }: P) {
  const { id } = await params;
  const run = await readRun(id);
  if (!run) return Response.json({ error: "no such run" }, { status: 404 });
  const def = (await findWorkflow(run.name)) || (await listWorkflows()).find((w) => w.name === run.name);
  if (!def) return Response.json({ ui: "" });
  return Response.json({ ui: await workflowUi(def) });
}
