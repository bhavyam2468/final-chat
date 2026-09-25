import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { desc, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const convs = await db.select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt }).from(conversations).orderBy(desc(conversations.updatedAt)).limit(200);
  const msgs = await db.select({ id: messages.id, c: messages.conversationId, p: messages.parentId, role: messages.role, content: messages.content }).from(messages).where(isNull(messages.threadOf));
  const byConv = new Map<string, typeof msgs>();
  for (const m of msgs) { if (!byConv.has(m.c)) byConv.set(m.c, []); byConv.get(m.c)!.push(m); }
  return Response.json(convs.map((c) => {
    const ms = byConv.get(c.id) || [];
    const hasChild = new Set(ms.map((m) => m.p));
    const by = new Map(ms.map((m) => [m.id, m]));
    const leaves = ms.filter((m) => !hasChild.has(m.id));
    const branches = leaves.length > 1 ? leaves.map((l) => {
      let cur: typeof l | undefined = l; let label = "";
      while (cur && !label) { if (cur.role === "user") label = cur.content; cur = cur.p ? by.get(cur.p) : undefined; }
      return { leafId: l.id, label: label.slice(0, 60) || "Branch" };
    }) : [];
    return { ...c, branches };
  }));
}
