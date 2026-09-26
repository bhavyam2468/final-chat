import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSettings } from "@/lib/settings";
import { chain, compactTools, compactWeb, compactMessages, compactHistory, restoreAll } from "@/lib/context";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** body: { leafId, scope: "tools"|"web"|"messages"|"history", ids?: string[], keepLast?: number } */
export async function POST(req: NextRequest, { params }: P) {
  const { id } = await params;
  const { leafId, scope = "history", ids = [], keepLast } = await req.json();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  const all = await db.select().from(messages).where(eq(messages.conversationId, id));
  const path = chain(all, leafId);
  const st = await getSettings();
  try {
    if (scope === "tools") return Response.json({ n: await compactTools(path, { keepLast: keepLast ?? 2 }) });
    if (scope === "web") return Response.json({ n: await compactWeb(path, st, keepLast ?? 2) });
    if (scope === "messages") return Response.json({ n: await compactMessages(path, ids, st) });
    return Response.json({ summary: await compactHistory(conv, path, st, keepLast ?? 2) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Undo every compaction in this conversation (originals are never deleted). */
export async function DELETE(_: NextRequest, { params }: P) {
  const { id } = await params;
  await restoreAll(id);
  return Response.json({ ok: true });
}
