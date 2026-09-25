import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { conversations, messages, Attachment } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAgent } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { conversationId?: string; parentId: string | null; threadOf?: string | null; user?: { content: string; attachments?: Attachment[]; quote?: string | null } };

export async function POST(req: NextRequest) {
  const b = (await req.json()) as Body;
  let convId = b.conversationId;
  let conv = convId ? (await db.select().from(conversations).where(eq(conversations.id, convId)))[0] : undefined;
  if (!conv) {
    convId = nanoid(10);
    const title = (b.user?.content || "New chat").replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ").slice(0, 60);
    [conv] = await db.insert(conversations).values({ id: convId, title }).returning();
  }
  let parentId = b.parentId;
  let userId: string | null = null;
  if (b.user) {
    userId = nanoid(12);
    await db.insert(messages).values({ id: userId, conversationId: conv.id, parentId: b.parentId, threadOf: b.threadOf || null, role: "user", content: b.user.content, attachments: b.user.attachments || [], quote: b.user.quote || null });
    parentId = userId;
  }
  const assistantId = nanoid(12);
  const enc = new TextEncoder();
  const c = conv;
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: Record<string, unknown>) => { try { ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch {} };
      emit({ t: "meta", conversationId: c.id, userId, assistantId, parentId, title: c.title });
      try { await runAgent({ conv: c, assistantId, parentId: parentId!, threadOf: b.threadOf || null, emit, signal: req.signal }); }
      catch (e) { emit({ t: "error", text: String(e) }); }
      emit({ t: "done" });
      try { ctrl.close(); } catch {}
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
