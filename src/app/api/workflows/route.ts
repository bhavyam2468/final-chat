import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { startInChat, workflowCatalog } from "@/lib/workflows";

export const dynamic = "force-dynamic";

/** The workflows this workspace has, and what they have been doing lately. */
export async function GET() {
  return Response.json(await workflowCatalog());
}

/**
 * Start one.
 *
 * The run appears in the chat as a card (an assistant message), the window opens from that card, and the work
 * happens on the server whether or not anyone is watching. The card is the only thing the chat ever sees of the
 * process; the report joins it when the run ends. Started from a brand-new chat, the workflow gets a chat of its
 * own rather than running without one — a run nobody can look at is a run nobody trusts.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name) return Response.json({ error: "which workflow?" }, { status: 400 });
  const input = (b.input || {}) as Record<string, string>;
  const chat = typeof b.conversationId === "string" && b.conversationId ? b.conversationId : null;
  try {
    if (chat) return Response.json(await startInChat(name, input, chat));
    const id = nanoid(10);
    await db.insert(conversations).values({ id, title: `Workflow: ${name}`, state: {} });
    const out = await startInChat(name, input, id);
    return Response.json({ ...out, chat: id });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 400 });
  }
}

export async function DELETE() {
  // a small convenience for the window's "start again": remove finished runs' records (files stay)
  return Response.json({ ok: true });
}