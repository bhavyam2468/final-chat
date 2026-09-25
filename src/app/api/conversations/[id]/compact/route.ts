import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compactConversation } from "@/lib/agent";
import { getSettings } from "@/lib/settings";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { leafId } = await req.json();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  const all = await db.select().from(messages).where(eq(messages.conversationId, id));
  const summary = await compactConversation(conv, all, leafId, await getSettings());
  return Response.json({ summary, summaryUpTo: leafId });
}
