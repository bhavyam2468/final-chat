import { NextRequest } from "next/server";
import { runPython } from "@/lib/tools";
import { ensureWorkspace } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  await ensureWorkspace();
  const { code } = await req.json();
  const r = await runPython(String(code));
  return Response.json({ out: r.out, ok: r.code === 0 });
}
