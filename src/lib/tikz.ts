/* TikZ → SVG, offline (node-tikzjax: TeX compiled to WebAssembly). Used by the x-tikz block and the tikz viewer.
   Models have seen enormous amounts of TikZ (textbooks, TeX.SE), so physics/geometry diagrams come out far better
   than with an invented drawing language: anchors (above/below/right) place labels without overlaps.
   Bundled packages: circuitikz, pgfplots, chemfig, tikz-cd, tikz-3dplot, tikz-feynhand, amsmath/amssymb. */
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

const CACHE = path.join(os.tmpdir(), "final-chat-tikz");
const mem = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve(); // the engine is single-instance: renders run one at a time

const BASE_LIBS = ["arrows.meta", "calc", "positioning", "decorations.pathmorphing", "decorations.markings", "patterns", "angles", "quotes", "shapes.geometric", "backgrounds", "fit"];
const KNOWN = new Set(["circuitikz", "pgfplots", "chemfig", "tikz-cd", "tikz-3dplot", "tikz-feynhand", "amsmath", "amssymb", "amsfonts", "array", "ifthen"]);

/** Accepts a bare picture body, a tikzpicture/circuitikz environment, or a whole document. */
export function prepare(src: string) {
  let s = src.replace(/\r/g, "").trim();
  const pk: Record<string, string> = { amsmath: "", amssymb: "" };
  const libs = new Set(BASE_LIBS);
  s = s.replace(/\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g, (_, opt, names) => { for (const n of String(names).split(",").map((x) => x.trim())) if (KNOWN.has(n)) pk[n] = opt || ""; return ""; });
  s = s.replace(/\\usetikzlibrary\{([^}]+)\}/g, (_, l) => { String(l).split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => libs.add(x)); return ""; });
  s = s.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/, "").replace(/\\pgfplotsset\{compat=[^}]*\}/g, "");
  const body = s.match(/\\begin\{document\}([\s\S]*?)(?:\\end\{document\}|$)/);
  if (body) s = body[1];
  s = s.trim();
  if (/\\begin\{circuitikz\}|\\draw[^;]*\bto\[/.test(s)) pk.circuitikz ??= "";
  if (/\\begin\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis|polaraxis)\}/.test(s)) pk.pgfplots ??= "";
  if (/\\chemfig/.test(s)) pk.chemfig ??= "";
  if (/\\begin\{tikzcd\}/.test(s)) pk["tikz-cd"] ??= "";
  if (/\\tdplotsetmaincoords/.test(s)) pk["tikz-3dplot"] ??= "";
  if (/\\begin\{feynhand\}/.test(s)) pk["tikz-feynhand"] ??= "";
  if (!/\\begin\{(tikzpicture|circuitikz|tikzcd)\}/.test(s) && !/\\chemfig/.test(s)) s = `\\begin{tikzpicture}\n${s}\n\\end{tikzpicture}`;
  return { source: `\\begin{document}\n${s}\n\\end{document}`, texPackages: pk, tikzLibraries: [...libs].join(",") };
}

/** Pure black/white → theme colours, so diagrams read in dark and light mode. Other colours are kept. */
/** TikZ draws in black on white. Make it follow the theme: black = text colour, white = background, grey tints =
    the same share of ink over the background, light colours = tinted background (so labels on filled shapes stay readable). */
function tone(hex: string, attr: "fill" | "stroke") {
  const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const grey = Math.max(r, g, b) - Math.min(r, g, b) < 12;
  if (grey) {
    const ink = Math.round((1 - lum) * 100);
    const v = ink >= 97 ? "currentColor" : ink <= 3 ? "var(--bg,#fff)" : `color-mix(in srgb, currentColor ${ink}%, var(--bg,#fff))`;
    return `style="${attr}:${v}"`;
  }
  if (lum > 0.6 && attr === "fill") return `style="fill:color-mix(in srgb, #${h} 45%, var(--bg,#fff))"`;
  return `${attr}="#${h}"`;
}
function themable(svg: string) {
  return svg
    .replace(/(stroke|fill)="(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)"/g, (_, a, c) => tone(c, a))
    // node-tikzjax drops pattern definitions (fill=url(#…) points at nothing): substitute a plain hatch
    .replace(/<pattern xlink:href="#([\w-]+)" id="([\w-]+)">[\s\S]*?<\/pattern>/g, (m, base, id) => svg.includes(`id="${base}"`) ? m
      : `<pattern id="${id}" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)"><path d="M0 0V3" stroke="currentColor" stroke-width=".4"/></pattern>`)
    // unfilled text, dots and pattern strokes default to black: inherit the text colour instead
    .replace(/<svg /, '<svg class="tikz" fill="currentColor" ');
}

export async function renderTikz(src: string): Promise<{ svg?: string; error?: string }> {
  const key = crypto.createHash("sha1").update("v3\n" + src).digest("hex"); // bump when themable() changes
  if (mem.has(key)) return { svg: mem.get(key)! };
  const file = path.join(CACHE, key + ".svg");
  try { const svg = await fs.readFile(file, "utf8"); mem.set(key, svg); return { svg }; } catch {}
  const job = queue.then(async () => {
    const mod = await import("node-tikzjax");
    const tex2svg = (mod as unknown as { default: (s: string, o: object) => Promise<string> }).default;
    const p = prepare(src);
    let log = "";
    const orig = console.log;
    console.log = (...a: unknown[]) => { log += a.join(" ") + "\n"; };
    try {
      const svg = await tex2svg(p.source, { texPackages: p.texPackages, tikzLibraries: p.tikzLibraries, showConsole: true });
      return { svg: themable(svg) };
    } catch (e) {
      const err = (log.match(/^! .*(?:\n.*){0,3}/m)?.[0] || String((e as Error)?.message || e)).slice(0, 600);
      return { error: err };
    } finally { console.log = orig; }
  });
  queue = job.catch(() => {});
  const r = await job;
  if (r.svg) {
    if (!/<(path|text|use|line|rect|circle|polygon)\b/.test(r.svg)) return { error: "TikZ compiled to an empty picture (check the source)" };
    mem.set(key, r.svg);
    fs.mkdir(CACHE, { recursive: true }).then(() => fs.writeFile(file, r.svg!)).catch(() => {});
  }
  return r;
}
