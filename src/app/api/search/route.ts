import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, ilike, or, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return Response.json([]);
  const rows = await db.select({ convId: conversations.id, title: conversations.title, messageId: messages.id, content: messages.content })
    .from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(or(ilike(messages.content, `%${q}%`), ilike(conversations.title, `%${q}%`))).orderBy(desc(messages.createdAt)).limit(40);
  return Response.json(rows.map((r) => {
    const i = r.content.toLowerCase().indexOf(q.toLowerCase());
    return { ...r, content: undefined, snippet: i < 0 ? r.content.slice(0, 80) : (i > 30 ? "…" : "") + r.content.slice(Math.max(0, i - 30), i + 60) };
  }));
}
