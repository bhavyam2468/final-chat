import fss from "fs";
import { WS } from "@/lib/workspace";
import { chatDir } from "@/lib/shared";
import { trash } from "@/lib/tools";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { isModeId } from "@/lib/modes";

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
  if (Array.isArray(b.context)) set.context = b.context;
  // "Open in chat": a General conversation is promoted into normal chat
  if (b.mode === "chat" || b.mode === "general" || b.mode === "search" || isModeId(b.mode) || b.project === null || typeof b.project === "string") {
    const [c] = await db.select({ state: conversations.state }).from(conversations).where(eq(conversations.id, id));
    if (c) {
      const state = { ...(c.state || {}), ...(set.state as object || {}) };
      if (isModeId(b.mode)) state.mode = b.mode;  // a mode lens wins over the legacy aliases
      else if (b.mode === "chat") state.mode = "chat";
      else if (b.mode === "general" || b.mode === "search") state.mode = "general";
      if (b.project === null || b.project === "") delete state.project;
      else if (typeof b.project === "string") state.project = b.project.replace(/[^\w-]/g, "").slice(0, 40);
      set.state = state;
    }
  }
  if (Object.keys(set).length) await db.update(conversations).set(set).where(eq(conversations.id, id));
  return Response.json({ ok: true });
}
export async function DELETE(_: NextRequest, { params }: P) {
  const { id } = await params;
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
  // the chat's folder (artifacts, uploads) goes to the workspace trash: recoverable
  const dir = [WS, chatDir(id.replace(/[^\w-]/g, ""))].join("/");
  if (fss.existsSync(dir)) await trash(dir).catch(() => {});
  return Response.json({ ok: true });
}
