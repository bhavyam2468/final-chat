import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { conversations, messages, Attachment } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAgent } from "@/lib/agent";
import { activeIds, activeRun, anyRun, attach, startRun, stopRun, reserveRun } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { conversationId?: string; parentId: string | null; threadOf?: string | null; user?: { content: string; attachments?: Attachment[]; quote?: string | null }; stop?: boolean; mode?: string };
const NDJSON = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" };

/** GET ?conversationId= re-attaches to a running (or just finished) run; without it, lists running conversation ids. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("conversationId");
  if (!id) return Response.json({ running: activeIds() });
  const run = anyRun(id);
  if (!run) return new Response(null, { status: 204 });
  return new Response(attach(run, req.signal), { headers: NDJSON });
}

export async function POST(req: NextRequest) {
  let b: Body;
  try { b = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b || typeof b !== "object" || (b.conversationId !== undefined && (typeof b.conversationId !== "string" || !/^[\w-]+$/.test(b.conversationId)))) return Response.json({ error: "Invalid conversation" }, { status: 400 });
  if (b.stop) return Response.json({ stopped: b.conversationId ? stopRun(b.conversationId) : false });
  if (b.user && (typeof b.user.content !== "string" || (b.user.attachments !== undefined && !Array.isArray(b.user.attachments)))) return Response.json({ error: "Invalid message" }, { status: 400 });
  const release = reserveRun(b.conversationId || nanoid());
  if (!release) return Response.json({ error: "This chat is still responding" }, { status: 409 });
  try { return await begin(b, req); } finally { release(); }
}

async function begin(b: Body, req: NextRequest) {
  let convId = b.conversationId;
  if (convId && activeRun(convId)) return Response.json({ error: "This chat is still responding" }, { status: 409 });
  let conv = convId ? (await db.select().from(conversations).where(eq(conversations.id, convId)))[0] : undefined;
  if (convId && !conv) return Response.json({ error: "Conversation not found" }, { status: 404 });
  if (!conv) {
    convId = nanoid(10);
    const title = (b.user?.content || "New chat").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ").slice(0, 60) || "New chat";
    [conv] = await db.insert(conversations).values({ id: convId, title, ...(b.mode === "search" ? { state: { mode: "search" } } : {}) }).returning();
  }
  for (const id of [b.parentId, b.threadOf].filter(Boolean)) {
    const [parent] = await db.select().from(messages).where(eq(messages.id, id!));
    if (!parent || parent.conversationId !== conv.id) return Response.json({ error: "Parent/thread must belong to this conversation" }, { status: 400 });
  }
  let parentId = b.parentId || null;
  let userId: string | null = null;
  if (b.user) {
    userId = nanoid(12);
    await db.insert(messages).values({ id: userId, conversationId: conv.id, parentId: b.parentId, threadOf: b.threadOf || null, role: "user", content: b.user.content, attachments: b.user.attachments || [], quote: b.user.quote || null });
    parentId = userId;
  }
  const assistantId = nanoid(12);
  const c = conv;
  const { run, emit, finish, signal } = startRun(c.id, assistantId);
  emit({ t: "meta", conversationId: c.id, userId, assistantId, parentId, threadOf: b.threadOf || null, title: c.title, mode: c.state?.mode || "chat" });
  // the run is not tied to this request: it survives the viewer leaving
  (async () => {
    try { await runAgent({ conv: c, assistantId, parentId: parentId!, threadOf: b.threadOf || null, emit, signal }); }
    catch (e) { emit({ t: "error", text: String(e) }); }
    finally { finish(); }
  })();
  return new Response(attach(run, req.signal), { headers: NDJSON });
}
