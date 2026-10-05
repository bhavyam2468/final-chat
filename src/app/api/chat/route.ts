import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { conversations, messages, Attachment } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAgent } from "@/lib/agent";
import { runUiTest } from "@/lib/ui-test";
import { activeIds, activeRun, anyRun, attach, startRun, stopRun, steerRun } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { conversationId?: string; parentId?: string | null; threadOf?: string | null; user?: { content: string; attachments?: Attachment[]; quote?: string | null }; stop?: boolean; steer?: string; mode?: string; uiTest?: boolean };
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
  const localTest = b.uiTest === true || (typeof b.user?.content === "string" && /^\/test(?:\s|$)/i.test(b.user.content.trim()));
  if (b.stop) return Response.json({ stopped: b.conversationId ? stopRun(b.conversationId) : false });
  if (typeof b.steer === "string") return Response.json({ accepted: b.conversationId ? steerRun(b.conversationId, b.steer) : false });
  let convId = b.conversationId;
  if (convId && activeRun(convId)) return Response.json({ error: "This chat is still responding" }, { status: 409 });
  let conv = convId ? (await db.select().from(conversations).where(eq(conversations.id, convId)))[0] : undefined;
  if (!conv) {
    convId = nanoid(10);
    const title = localTest ? "UI smoke test" : (b.user?.content || "New chat").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ").slice(0, 60) || "New chat";
    [conv] = await db.insert(conversations).values({ id: convId, title, ...((b.mode === "general" || b.mode === "search") ? { state: { mode: "general" } } : {}) }).returning();
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
  const { run, emit, finish, signal, takeSteers, setModelAbort } = startRun(c.id, assistantId);
  emit({ t: "meta", conversationId: c.id, userId, assistantId, parentId, threadOf: b.threadOf || null, title: c.title });
  // the run is not tied to this request: it survives the viewer leaving
  (async () => {
    try {
      if (localTest) await runUiTest({ conv: c, assistantId, parentId: parentId!, threadOf: b.threadOf || null, emit, signal, takeSteers, request: b.user?.content || "", followup: b.uiTest === true });
      else await runAgent({ conv: c, assistantId, parentId: parentId!, threadOf: b.threadOf || null, emit, signal, takeSteers, setModelAbort });
    } catch (e) { emit({ t: "error", text: String(e) }); }
    finally { finish(); }
  })();
  return new Response(attach(run, req.signal), { headers: NDJSON });
}
