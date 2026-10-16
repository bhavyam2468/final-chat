#!/usr/bin/env node
/**
 * Copy the browser libraries Blocks documents may load into `vendor/<lib>/…`.
 *
 * Why: the app serves these from disk so Blocks render offline ("the CDN is only a fallback",
 * see public/blocks/runtime.js). Historically the server read them straight out of
 * `node_modules/`, which cannot survive a bundled desktop build: `node_modules` is not part of
 * the standalone server output, and the file tracer refuses to follow dynamic reads. Copying the
 * exact files the runtime asks for into `public/` makes the whole set a normal static asset that
 * `next build` ships and the desktop bundle carries verbatim.
 *
 * Order of truth: this list mirrors the `loadLib/libImport/libFetch` calls in
 * public/blocks/{runtime.js,elements.js}. A library missing here is not fatal — the runtime
 * falls back to its CDN URL for that one file — but offline rendering of that component breaks.
 *
 *   node scripts/desktop/vendor-assets.mjs [--check]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NM = path.join(ROOT, "node_modules");
/** Served by src/app/vendor/[...path]/route.ts as `/vendor/<lib>/<file>`. Generated, not committed. */
const OUT = path.join(ROOT, "vendor");
const check = process.argv.includes("--check");

/** lib → list of `from` (under node_modules) → `to` (under vendor/<lib>) entries. */
const LIBS = {
  katex: [
    ["katex/dist/katex.min.css", "katex.min.css"],
    ["katex/dist/katex.min.js", "katex.min.js"],
    ["katex/dist/contrib/auto-render.min.js", "contrib/auto-render.min.js"],
    ["katex/dist/fonts", "fonts"],
  ],
  mermaid: [
    ["mermaid/dist/mermaid.esm.min.mjs", "mermaid.esm.min.mjs"],
    // ESM entry imports its chunks relatively; without them the dynamic import 404s.
    ["mermaid/dist/chunks/mermaid.esm.min", "chunks/mermaid.esm.min"],
  ],
  smiles: [["smiles-drawer/dist/smiles-drawer.min.js", "smiles-drawer.min.js"]],
  "3dmol": [["3dmol/build/3Dmol-min.js", "3Dmol-min.js"]],
  leaflet: [
    ["leaflet/dist/leaflet.css", "leaflet.css"],
    ["leaflet/dist/leaflet.js", "leaflet.js"],
    ["leaflet/dist/images", "images"],
  ],
  lucide: [["lucide-static/icons", "icons"]],
  marked: [["marked/lib/marked.umd.js", "marked.umd.js"]],
  hljs: [["@highlightjs/cdn-assets/highlight.min.js", "highlight.min.js"]],
  tikzjax: [
    ["node-tikzjax/css/fonts.css", "fonts.css"],
    ["node-tikzjax/css/bakoma", "bakoma"],
  ],
  geist: [
    ["geist/dist/fonts/geist-sans/Geist-Variable.woff2", "geist-sans/Geist-Variable.woff2"],
    ["geist/dist/fonts/geist-mono/GeistMono-Variable.woff2", "geist-mono/GeistMono-Variable.woff2"],
  ],
};

const SKIP = /\.(map|d\.ts|ts|md|txt|json)$/i;
let files = 0;
let bytes = 0;
const missing = [];

/** Copy a file or a directory tree (skipping source maps, typings and docs — they are dead weight). */
function copyInto(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (SKIP.test(entry.name)) continue;
      copyInto(path.join(from, entry.name), path.join(to, entry.name));
    }
    return;
  }
  if (SKIP.test(path.basename(from))) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files++;
  bytes += st.size;
}

for (const [lib, entries] of Object.entries(LIBS)) {
  for (const [from, to] of entries) {
    const src = path.join(NM, from);
    const dst = path.join(OUT, lib, to);
    if (!fs.existsSync(src)) {
      missing.push(`${lib}: node_modules/${from}`);
      continue;
    }
    if (check) {
      if (!fs.existsSync(dst)) missing.push(`${lib}: vendor/${to} (not staged)`);
      continue;
    }
    fs.rmSync(dst, { recursive: true, force: true });
    copyInto(src, dst);
  }
}

const mb = (bytes / 1024 / 1024).toFixed(1);
if (check) {
  if (missing.length) {
    console.error("vendor assets are incomplete — run `npm run desktop:vendor`\n  " + missing.join("\n  "));
    process.exit(1);
  }
  console.log("vendor assets: ok");
} else {
  console.log(`vendor assets: ${files} files · ${mb} MB → vendor/`);
  if (missing.length) console.warn("  skipped (not installed):\n  " + missing.join("\n  "));
}
