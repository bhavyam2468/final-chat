import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, ilike, or, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const mode = req.nextUrl.searchParams.get("mode") === "general" ? "general" : "chat";
  if (!q) return Response.json([]);
  const rows = await db.select({ convId: conversations.id, title: conversations.title, messageId: messages.id, content: messages.content, state: conversations.state })
    .from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(or(ilike(messages.content, `%${q}%`), ilike(conversations.title, `%${q}%`))).orderBy(desc(messages.createdAt)).limit(200);
  const scoped = rows.filter((r) => (r.state?.mode === "general" || r.state?.mode === "search" ? "general" : "chat") === mode).slice(0, 40);
  return Response.json(scoped.map((r) => {
    const i = r.content.toLowerCase().indexOf(q.toLowerCase());
    return { convId: r.convId, title: r.title, messageId: r.messageId, snippet: i < 0 ? r.content.slice(0, 80) : (i > 30 ? "…" : "") + r.content.slice(Math.max(0, i - 30), i + 60) };
  }));
}
