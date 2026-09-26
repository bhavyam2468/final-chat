import { NextRequest } from "next/server";
import fs from "fs/promises";
import { resolvePath, mimeOf, ensureWorkspace } from "@/lib/workspace";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export async function GET(_: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  await ensureWorkspace();
  const { path } = await params;
  const p = path.map(decodeURIComponent).join("/");
  try {
    const abs = resolvePath(p, (await getSettings()).access);
    const buf = await fs.readFile(abs);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": mimeOf(abs), "Cache-Control": "no-store" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
