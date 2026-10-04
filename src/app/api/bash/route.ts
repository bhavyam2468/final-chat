import { NextRequest } from "next/server";
import { runShell } from "@/lib/exec";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { command } = await req.json();
    if (!command || typeof command !== "string") {
      return Response.json({ error: "command required" }, { status: 400 });
    }
    const st = await getSettings();
    // Sandboxed shell execution with tight timeout for live UI blocks
    const r = await runShell(st, command, 8000, false);
    return Response.json({ out: r.out.trim(), ok: r.code === 0 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
