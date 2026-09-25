import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
  const body = JSON.stringify({ format: "workspace-chat/1", conversation: conv, messages: msgs }, null, 2);
  return new Response(body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="chat-${id}.json"` } });
}
