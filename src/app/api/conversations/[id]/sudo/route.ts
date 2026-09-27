import { NextRequest } from "next/server";
import { sudoAnswer, sudoRemember } from "@/lib/exec";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/**
 * body: { partId, password, remember }. Answers the sudo prompt the shell tool is parked on.
 * The password lives only in this process: in the waiting call, or (with remember) in memory for this chat.
 */
export async function POST(req: NextRequest, { params }: P) {
  const { id } = await params;
  const { partId, password, remember } = await req.json();
  if (typeof partId !== "string" || typeof password !== "string" || !password) return Response.json({ error: "bad body" }, { status: 400 });
  if (remember) sudoRemember(id, password);
  if (!sudoAnswer(partId, password)) return Response.json({ error: "no pending sudo prompt" }, { status: 404 });
  return Response.json({ ok: true });
}
