import fs from "fs/promises";
import path from "path";
import { mimeOf } from "@/lib/workspace";

/**
 * Serves the browser libraries Blocks documents load, so BlocksUI works offline — the CDN
 * fallback built into public/blocks/runtime.js is only for installs that ship nothing here.
 *
 * The files are staged into `./vendor/<lib>/` by `scripts/desktop/vendor-assets.mjs`
 * (`npm run desktop:vendor`; every desktop build runs it) and travel with the app.
 *
 * Two reasons this is a route and not Next's static `public/` handler:
 *  1. Block iframes are sandboxed WITHOUT `allow-same-origin`, so their origin is opaque and each
 *     fetch/ESM import is cross-origin — the `access-control-allow-origin` below is what makes
 *     mermaid's ESM chunks and the lucide icon fetches work offline at all.
 *  2. `public/` cannot be written by a bundled app, while `vendor/` sits next to the server and
 *     is staged at build time.
 *
 * NOTE: this route answers `/vendor/<lib>/<file>`, which is what public/blocks/runtime.js asks
 * for (`B.vendor = (lib, file) => \`${ORIGIN}/vendor/${lib}/${file}\``). The pre-desktop build
 * had the same handler under /api/vendor, so every bundled library silently 404'd and Blocks
 * quietly fell back to the CDN; tested by dev/tests/desktop-vendor.test.ts.
 */
const LIBRARIES = new Set(["katex", "mermaid", "smiles", "3dmol", "leaflet", "lucide", "marked", "hljs", "tikzjax", "geist"]);

export const dynamic = "force-dynamic";

const VENDOR_ROOT = path.join(process.cwd(), "vendor");

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [lib, ...rest] = (await params).path;
  if (!LIBRARIES.has(lib) || !rest.length) return new Response("Not found", { status: 404 });
  const base = path.join(VENDOR_ROOT, lib);
  const file = path.resolve(base, rest.join("/"));
  if (file !== base && !file.startsWith(base + path.sep)) return new Response("Forbidden", { status: 403 });
  try {
    const buf = await fs.readFile(file);
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": contentType(file), "access-control-allow-origin": "*", "cache-control": "public, max-age=604800, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function contentType(file: string): string {
  if (/\.m?js$/.test(file)) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".ttf")) return "font/ttf";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return mimeOf(file);
}
