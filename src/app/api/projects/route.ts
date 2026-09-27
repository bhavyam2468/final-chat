import { NextRequest } from "next/server";
import { ensureProject, listProjects } from "@/lib/projects";
import { ensureWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureWorkspace();
  return Response.json({ projects: await listProjects() });
}

export async function POST(req: NextRequest) {
  await ensureWorkspace();
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return Response.json({ error: "name required" }, { status: 400 });
  const p = await ensureProject(name);
  return Response.json(p);
}
