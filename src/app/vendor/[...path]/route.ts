import fs from "fs/promises";
import path from "path";
import { mimeOf } from "@/lib/workspace";

/** Serves whitelisted browser libraries from node_modules so BlocksUI works offline (CDN is only a fallback). */
const ROOTS: Record<string, string> = { katex: "node_modules/katex/dist" };

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [lib, ...rest] = (await params).path;
  const root = ROOTS[lib];
  if (!root) return new Response("Not found", { status: 404 });
  const base = path.resolve(/*turbopackIgnore: true*/ process.cwd(), root);
  const file = path.resolve(base, rest.join("/"));
  if (!file.startsWith(base + path.sep)) return new Response("Forbidden", { status: 403 });
  try {
    const buf = await fs.readFile(file);
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : mimeOf(file);
    return new Response(new Uint8Array(buf), { headers: { "content-type": type, "cache-control": "public, max-age=604800, immutable" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
