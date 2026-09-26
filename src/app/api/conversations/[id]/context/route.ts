import { NextRequest } from "next/server";
import { contextReport } from "@/lib/agent";

export const dynamic = "force-dynamic";

/** GET ?leaf=<messageId>&thread=<anchorId> -> token breakdown of the next request */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  try { return Response.json(await contextReport(id, sp.get("leaf"), sp.get("thread"))); }
  catch (e) { return Response.json({ error: String(e) }, { status: 404 }); }
}
