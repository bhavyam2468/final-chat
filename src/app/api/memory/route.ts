import { NextRequest } from "next/server";
import { forget, revise, restoreForgotten } from "@/lib/memory";

export const dynamic = "force-dynamic";

/** Undo a remembered note. The id is the one shown on the memory card, not a free-form path. */
export async function PATCH(req: NextRequest) {
  const { id, text } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || typeof text !== "string") return Response.json({ error: "id and text required" }, { status: 400 });
  return Response.json({ ok: await revise(id, text) });
}

export async function POST(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return Response.json({ error: "id required" }, { status: 400 });
  return Response.json({ ok: await restoreForgotten(id) });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return Response.json({ error: "id required" }, { status: 400 });
  return Response.json({ ok: await forget(id) });
}
