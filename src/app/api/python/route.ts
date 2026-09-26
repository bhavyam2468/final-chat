import { NextRequest } from "next/server";
import { runPython } from "@/lib/tools";
import { getSettings } from "@/lib/settings";
import { ensureWorkspace } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  await ensureWorkspace();
  const { code } = await req.json();
  const r = await runPython(String(code), await getSettings());
  return Response.json({ out: r.out, ok: r.code === 0 });
}
