import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: P) {
  const { id } = await params;
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
  return Response.json({ conversation: conv, messages: msgs });
}
export async function PATCH(req: NextRequest, { params }: P) {
  const { id } = await params;
  const b = await req.json();
  const set: Record<string, unknown> = {};
  if (typeof b.title === "string") set.title = b.title;
  if (b.kind === "chat" || b.kind === "search") set.kind = b.kind;
  if (Array.isArray(b.context)) set.context = b.context;
  if (Object.keys(set).length) await db.update(conversations).set(set).where(eq(conversations.id, id));
  return Response.json({ ok: true });
}
export async function DELETE(_: NextRequest, { params }: P) {
  const { id } = await params;
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
  return Response.json({ ok: true });
}
