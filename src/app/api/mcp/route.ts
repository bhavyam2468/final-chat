import { NextRequest } from "next/server";
import { readServers, writeServers } from "@/lib/mcp";
import { ensureWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export async function GET() { await ensureWorkspace(); return Response.json(await readServers()); }
export async function PUT(req: NextRequest) { await writeServers(await req.json()); return Response.json({ ok: true }); }
