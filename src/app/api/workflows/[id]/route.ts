import { NextRequest } from "next/server";
import { readRun, stopWorkflow, workflowUi, findWorkflow } from "@/lib/workflows";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** The run record the workflow window (and the card in the chat) polls. */
export async function GET(_req: NextRequest, { params }: P) {
  const { id } = await params;
  const run = await readRun(id);
  if (!run) return Response.json({ error: "no such run" }, { status: 404 });
  return Response.json(run);
}

/** Stop a run that is still going. */
export async function POST(_req: NextRequest, { params }: P) {
  const { id } = await params;
  return Response.json({ stopped: await stopWorkflow(id) });
}
