import { NextRequest } from "next/server";
import { forget } from "@/lib/memory";

export const dynamic = "force-dynamic";

/** Undo a remembered note. The id is the one shown on the memory card, not a free-form path. */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return Response.json({ error: "id required" }, { status: 400 });
  return Response.json({ ok: await forget(id) });
}
