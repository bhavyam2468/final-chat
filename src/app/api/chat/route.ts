import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { conversations, messages, Attachment } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAgent } from "@/lib/agent";
import { activeIds, activeRun, anyRun, attach, injectSteer, startRun, stopRun } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  conversationId?: string; parentId: string | null; threadOf?: string | null;
  user?: { content: string; attachments?: Attachment[]; quote?: string | null };
  /** mid-run steering: a user message pushed into the running turn */
  steer?: { content: string; attachments?: Attachment[] };
  stop?: boolean; mode?: string;
};
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
  const b = (await req.json()) as Body;
  if (b.stop) return Response.json({ stopped: b.conversationId ? stopRun(b.conversationId) : false });
  // --- steering an active run: save the message now, hand it to the agent loop
  if (b.steer) {
    const convId = b.conversationId;
    const run = convId ? activeRun(convId) : undefined;
    if (!run) return Response.json({ error: "not_running" }, { status: 409 });
    const content = String(b.steer.content || "").trim();
    if (!content) return Response.json({ error: "Empty message" }, { status: 400 });
    const id = nanoid(12);
    await db.insert(messages).values({ id, conversationId: convId!, parentId: run.tailId, threadOf: null, role: "user", content, attachments: b.steer.attachments || [], quote: null });
    injectSteer(convId!, id, { content, attachments: b.steer.attachments || [] });
    return Response.json({ ok: true, id, parentId: run.tailId, conversationId: convId });
  }
  let convId = b.conversationId;
  if (convId && activeRun(convId)) return Response.json({ error: "This chat is still responding" }, { status: 409 });
  let conv = convId ? (await db.select().from(conversations).where(eq(conversations.id, convId)))[0] : undefined;
  if (!conv) {
    convId = nanoid(10);
    const title = (b.user?.content || "New chat").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ").slice(0, 60) || "New chat";
    [conv] = await db.insert(conversations).values({ id: convId, title, ...(b.mode === "general" || b.mode === "search" ? { state: { mode: "general" } } : {}) }).returning();
  }
  let parentId = b.parentId;
  let userId: string | null = null;
  if (b.user) {
    userId = nanoid(12);
    await db.insert(messages).values({ id: userId, conversationId: conv.id, parentId: b.parentId, threadOf: b.threadOf || null, role: "user", content: b.user.content, attachments: b.user.attachments || [], quote: b.user.quote || null });
    parentId = userId;
  }
  const assistantId = nanoid(12);
  const c = conv;
  const { run, emit, finish, signal } = startRun(c.id, assistantId, parentId || "");
  emit({ t: "meta", conversationId: c.id, userId, assistantId, parentId, threadOf: b.threadOf || null, title: c.title, startedAt: run.startedAt });
  // the run is not tied to this request: it survives the viewer leaving
  (async () => {
    try { await runAgent({ conv: c, assistantId, parentId: parentId!, threadOf: b.threadOf || null, emit, signal }); }
    catch (e) { emit({ t: "error", text: String(e) }); }
    finally { finish(); }
  })();
  return new Response(attach(run, req.signal), { headers: NDJSON });
}
