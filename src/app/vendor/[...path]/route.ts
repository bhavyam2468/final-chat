import fs from "fs/promises";
import path from "path";
import { mimeOf } from "@/lib/workspace";

/** Serves whitelisted browser libraries from node_modules so BlocksUI works offline (CDN is only a fallback). */
const ROOTS: Record<string, string> = {
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
  tesseract: "node_modules/tesseract.js/dist",
  "tesseract-core": "node_modules/tesseract.js-core",
};

const OCR_LANGS = new Set(["eng", "hin", "pan"]);
const OCR_DATA_VERSION = "4.0.0_best_int";

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [lib, ...rest] = (await params).path;
  let base: string, file: string;
  if (lib === "tessdata") {
    const [version, filename] = rest;
    const lang = filename?.match(/^([a-z]+)\.traineddata\.gz$/)?.[1];
    if (rest.length !== 2 || version !== OCR_DATA_VERSION || !filename || !lang || !OCR_LANGS.has(lang)) return new Response("Not found", { status: 404 });
    base = path.resolve(/*turbopackIgnore: true*/ process.cwd(), `node_modules/@tesseract.js-data/${lang}/${version}`);
    file = path.resolve(base, filename);
  } else {
    const root = ROOTS[lib];
    if (!root) return new Response("Not found", { status: 404 });
    base = path.resolve(/*turbopackIgnore: true*/ process.cwd(), root);
    file = path.resolve(base, rest.join("/"));
  }
  if (!file.startsWith(base + path.sep)) return new Response("Forbidden", { status: 403 });
  try {
    const buf = await fs.readFile(file);
    const type = file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".gz") ? "application/gzip" : /\.m?js$/.test(file) ? "text/javascript; charset=utf-8" : file.endsWith(".ttf") ? "font/ttf" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : mimeOf(file);
    return new Response(new Uint8Array(buf), { headers: { "content-type": type, "access-control-allow-origin": "*", "cache-control": "public, max-age=604800, immutable" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
