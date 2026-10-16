import fs from "fs/promises";
import path from "path";
import { mimeOf } from "@/lib/workspace";

/** Serves whitelisted browser libraries from node_modules so BlocksUI works offline (CDN is only a fallback). */
const ROOTS: Record<string, string> = {
  elk: "node_modules/elkjs/lib",
  katex: "node_modules/katex/dist",
  tikzjax: "node_modules/node-tikzjax/css",
  mermaid: "node_modules/mermaid/dist",
  smiles: "node_modules/smiles-drawer/dist",
  "3dmol": "node_modules/3dmol/build",
  leaflet: "node_modules/leaflet/dist",
  lucide: "node_modules/lucide-static/icons",
  marked: "node_modules/marked/lib",
  hljs: "node_modules/@highlightjs/cdn-assets",
  geist: "node_modules/geist/dist/fonts",
};

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [lib, ...rest] = (await params).path;
  const root = ROOTS[lib];
  if (!root) return new Response("Not found", { status: 404 });
  const base = path.resolve(/*turbopackIgnore: true*/ process.cwd(), root);
  const file = path.resolve(base, rest.join("/"));
  if (!file.startsWith(base + path.sep)) return new Response("Forbidden", { status: 403 });
  try {
    const buf = await fs.readFile(file);
    const type = /\.m?js$/.test(file) ? "text/javascript; charset=utf-8" : file.endsWith(".ttf") ? "font/ttf" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : mimeOf(file);
    return new Response(new Uint8Array(buf), { headers: { "content-type": type, "access-control-allow-origin": "*", "cache-control": "public, max-age=604800, immutable" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
