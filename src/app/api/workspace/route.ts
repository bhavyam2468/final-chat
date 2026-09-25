import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { ensureWorkspace, resolvePath, tree, mimeOf } from "@/lib/workspace";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
const full = async () => (await getSettings()).access === "full";

export async function GET(req: NextRequest) {
  await ensureWorkspace();
  const p = req.nextUrl.searchParams.get("path");
  if (!p) return Response.json(await tree());
  const abs = resolvePath(p, await full());
  const buf = await fs.readFile(abs);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": mimeOf(abs), "Cache-Control": "no-store" } });
}
export async function PUT(req: NextRequest) {
  const { path: p, content } = await req.json();
  const abs = resolvePath(p, await full());
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
  return Response.json({ ok: true });
}
export async function POST(req: NextRequest) {
  const { from, to } = await req.json();
  const f = await full(); const dst = resolvePath(to, f);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(resolvePath(from, f), dst);
  return Response.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path")!;
  await fs.rm(resolvePath(p, await full()), { recursive: true, force: true });
  return Response.json({ ok: true });
}
