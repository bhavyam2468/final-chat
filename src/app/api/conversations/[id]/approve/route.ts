import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages, Part } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
type Approval = { cmd: string; hash: string; reason: string; host: boolean; decision?: "approve" | "deny" };

/**
 * body: { messageId, partId, decision: "approve" | "deny" }. The hash comes from the stored tool result, never
 * from the client, so an approval can only ever unlock exactly the command the user saw. One use per approval.
 */
export async function POST(req: NextRequest, { params }: P) {
  const { id } = await params;
  const { messageId, partId, decision } = await req.json();
  if (decision !== "approve" && decision !== "deny") return Response.json({ error: "bad decision" }, { status: 400 });
  const [m] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.conversationId, id)));
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!m || !conv) return Response.json({ error: "not found" }, { status: 404 });
  const part = (m.parts as Part[]).find((p) => p.type === "tool" && p.id === partId) as Extract<Part, { type: "tool" }> | undefined;
  const ap = (part?.meta as { approval?: Approval } | undefined)?.approval;
  if (!part || !ap) return Response.json({ error: "no pending approval" }, { status: 404 });
  if (ap.decision) return Response.json({ error: "already decided", decision: ap.decision }, { status: 409 });
  ap.decision = decision;
  await db.update(messages).set({ parts: m.parts }).where(eq(messages.id, m.id));
  if (decision === "approve") {
    const state = conv.state || {};
    await db.update(conversations).set({ state: { ...state, approved: [...new Set([...(state.approved || []), ap.hash])].slice(-20) } }).where(eq(conversations.id, id));
  }
  return Response.json({ ok: true, cmd: ap.cmd });
}
