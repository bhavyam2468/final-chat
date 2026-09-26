/**
 * Deterministic "slop" lint for things the agent builds (HTML/CSS/JSX/BlocksUI/markdown UI copy).
 * Targets the recurring failure modes of small and distilled models: novelty fonts, neon/cyberpunk styling,
 * purple gradients, glassmorphism, emoji headings, marketing copy, self-promotion inside the app,
 * obvious helper text and filler. Each finding carries a fix hint the model can act on directly.
 */
export type Issue = { rule: string; msg: string; line?: number; severity: "error" | "warn" };

const FONTS = ["orbitron", "audiowide", "exo 2", "exo", "rajdhani", "oxanium", "press start 2p", "michroma", "russo one", "syncopate", "monoton", "bungee", "righteous", "black ops one", "share tech mono", "vt323", "comic sans", "papyrus", "lobster", "pacifico", "creepster", "orbitron", "space mono", "major mono display", "zen dots", "tektur", "chakra petch", "electrolize", "aldrich", "quantico", "iceland", "wallpoet", "faster one", "nosifer", "bangers"];
const HYPE = ["seamless", "seamlessly", "unleash", "elevate", "elevated", "cutting-edge", "cutting edge", "state-of-the-art", "stunning", "supercharge", "supercharged", "next-gen", "next generation", "immersive", "blazing", "blazingly", "lightning-fast", "effortless", "effortlessly", "revolutionary", "revolutionize", "game-changing", "game changer", "unlock", "unlocks", "harness the power", "empower", "empowering", "delightful", "sleek", "robust solution", "world-class", "ultimate", "magical", "cosmic", "futuristic", "breathtaking", "unparalleled", "transformative", "synergy", "leverage", "turbocharge", "masterpiece", "beautifully crafted", "crafted with", "reimagined", "embark", "journey", "dive into", "delve"];
const HELPERS = [
  /\bwelcome to\b/i, /\bget started\b/i, /\bclick here\b/i, /\bsimply (click|enter|type|select|drag)\b/i, /\bthis (app|tool|page|dashboard|widget) (lets|allows|helps|enables) you\b/i,
  /\b(enter|type) your [\w ]{1,24} (below|here)\b/i, /\bpowered by\b/i, /\bbuilt with\b/i, /\bmade with (love|❤️?)\b/i, /\ball rights reserved\b/i,
  /\blorem ipsum\b/i, /\bcoming soon\b/i, /\byour (ultimate|all-in-one|one-stop)\b/i, /\bto the next level\b/i, /\bdiscover the power\b/i, /\bexperience the\b/i,
  /\b(don'?t|do not) worry\b/i, /\bhappy (coding|learning|studying)\b/i, /\bpro tip\b/i, /\bfeel free to\b/i,
];
const NEON = /#(?:0ff|00ffff|f0f|ff00ff|39ff14|00ff41|0f0|00ff00|ff073a|fe53bb|08f7fe|09fbd3|f5d300|bc13fe|7df9ff|ccff00)\b/i;
const PURPLE = /#(?:8b5cf6|7c3aed|6d28d9|a855f7|9333ea|a78bfa|c084fc|6366f1|4f46e5|818cf8|ec4899|d946ef|e879f9|db2777)\b|\b(?:purple|violet|fuchsia|indigo|magenta)\b/i;

const lineOf = (text: string, idx: number) => text.slice(0, idx).split("\n").length;
const visible = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\{[^{}]*\}/g, " ");

/** Pull user-visible strings out of code (JSX text, string literals that look like prose). */
function copyOf(text: string, kind: string) {
  if (kind === "md") return text.replace(/```[\s\S]*?```/g, " ");
  if (/^(js|jsx|ts|tsx|vue|svelte)$/.test(kind)) {
    const jsx = [...text.matchAll(/>([^<>{}\n][^<>{}]*)</g)].map((m) => m[1]);
    const strs = [...text.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)].map((m) => m[2]).filter((s) => /\s/.test(s) && /[a-z]{3}/i.test(s) && !/[{};=<>]|^\.|\/\//.test(s));
    return [...jsx, ...strs].join("\n");
  }
  return visible(text);
}

export function slopLint(text: string, kind = "html"): Issue[] {
  const out: Issue[] = [];
  const add = (rule: string, msg: string, idx?: number, severity: Issue["severity"] = "warn") => {
    if (out.filter((i) => i.rule === rule).length < 4) out.push({ rule, msg, severity, ...(idx !== undefined ? { line: lineOf(text, idx) } : {}) });
  };
  const lower = text.toLowerCase();
  const styles = kind === "css" ? text : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style=\{?\{?["'`]?([^"'`>]*)|className=["'`]([^"'`]*)["'`]|class=["']([^"']*)["']/gi)].map((m) => m.slice(1).filter(Boolean).join(" ")).join("\n") + (/(css|scss|js|jsx|ts|tsx)$/.test(kind) ? "\n" + text : "");

  // --- typography
  for (const f of new Set(FONTS)) {
    const i = lower.search(new RegExp(`font-family[^;\\n]*\\b${f.replace(/ /g, "[ +]")}\\b|family=${f.replace(/ /g, "\\+")}\\b|['"]${f}['"]`));
    if (i >= 0) add("font", `Novelty font "${f}". Use the system stack (system-ui, -apple-system, "Segoe UI", sans-serif) or one neutral text face.`, i, "error");
  }
  if (/fonts\.googleapis\.com/.test(lower) && !/offline|cdn ok/.test(lower)) add("font-cdn", "Google Fonts link: breaks offline use and adds a network dependency. Prefer the system font stack.", lower.indexOf("fonts.googleapis.com"));
  const caps = styles.match(/text-transform:\s*uppercase[^}]*letter-spacing:\s*(0?\.\d+|\d+)(em|px)/i) || styles.match(/letter-spacing:\s*(0?\.\d+|\d+)(em|px)[^}]*text-transform:\s*uppercase/i);
  if (caps && ((caps[2] === "em" && parseFloat(caps[1]) >= 0.15) || (caps[2] === "px" && parseFloat(caps[1]) >= 3))) add("caps", "Wide-tracked uppercase text reads as sci-fi decoration. Use normal case; reserve small caps for tiny labels.", text.indexOf(caps[0]));

  // --- colour & effects
  let m = styles.match(NEON);
  if (m) add("neon", `Neon colour ${m[0]}. Use muted, low-saturation colours; one restrained accent at most.`, text.indexOf(m[0]), "error");
  const glow = styles.match(/(text-shadow|box-shadow|filter:\s*drop-shadow)\s*:?\s*[^;]*\b0(px)?\s+0(px)?\s+(1[2-9]|[2-9]\d|\d{3})px[^;]*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/i);
  if (glow && !/rgba?\(\s*0\s*,\s*0\s*,\s*0/i.test(glow[0])) add("glow", "Coloured glow shadow (neon look). Use a subtle neutral shadow or none.", text.indexOf(glow[0]), "error");
  if (/\b(neon|cyber|cyberpunk|synthwave|matrix-?rain|hologram|holographic|glitch)\b/i.test(styles)) add("cyber", "Cyberpunk/neon styling. Keep the interface plain: calm colours, no glitch/hologram effects.", text.search(/\b(neon|cyber|cyberpunk|synthwave|matrix-?rain|hologram|holographic|glitch)\b/i), "error");
  for (const g of styles.matchAll(/(linear|radial|conic)-gradient\(([^;]*)\)/gi)) {
    const body = g[2];
    const hues = (body.match(PURPLE) ? 1 : 0) + (body.match(/#(?:3b82f6|2563eb|06b6d4|0ea5e9|22d3ee)\b|\b(?:cyan|blue|teal)\b/i) ? 1 : 0) + (body.match(/#(?:f43f5e|fb7185|f97316|ec4899)\b|\b(?:pink|rose|orange)\b/i) ? 1 : 0);
    if (hues >= 2 || (body.match(PURPLE) && /(background|bg-)/i.test(styles))) { add("gradient", "Saturated multi-hue/purple gradient (generic AI look). Use a flat background; if a gradient is needed, one hue with small lightness change.", text.indexOf(g[0])); break; }
  }
  if (/bg-gradient-to-\w+\s+from-(purple|violet|indigo|fuchsia|pink)-/.test(styles)) add("gradient", "Tailwind purple/pink gradient. Use a flat neutral background.", text.search(/bg-gradient-to-\w+\s+from-(purple|violet|indigo|fuchsia|pink)-/));
  if (/background-clip:\s*text|bg-clip-text/.test(styles)) add("gradient-text", "Gradient-filled text. Use solid text colour.", text.search(/background-clip:\s*text|bg-clip-text/));
  const blur = (styles.match(/backdrop-filter:\s*blur|backdrop-blur/g) || []).length;
  if (blur >= 2) add("glass", `Glassmorphism (${blur} blurred panels). Use solid surfaces with a hairline border.`);
  const infinite = (styles.match(/animation[^;]*infinite|animate-(pulse|ping|bounce|spin)\b/g) || []).length;
  if (infinite >= 2) add("motion", `${infinite} endless animations. Animate only on state change (enter, hover, loading).`);

  // --- copy
  const copy = copyOf(text, kind);
  const hype = HYPE.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(copy));
  if (hype.length) add("hype", `Marketing words: ${hype.slice(0, 6).join(", ")}. Say what the thing does in plain words, or say nothing.`, text.search(new RegExp(`\\b${hype[0]}\\b`, "i")), hype.length > 2 ? "error" : "warn");
  for (const h of HELPERS) { const i = copy.search(h); if (i >= 0) add("helper", `Filler/helper copy "${copy.slice(i, i + 40).trim()}". Remove it; labels and layout should explain the UI.`, text.search(h)); }
  const bangs = (copy.match(/[a-z)]!(\s|$)/gi) || []).length;
  if (bangs >= 2) add("exclaim", `${bangs} exclamation marks in UI copy. Use a neutral tone.`);
  if (/(^|\n)\s*(#{1,4}\s*|<h[1-6][^>]*>\s*)\p{Extended_Pictographic}/u.test(text) || /<(button|h[1-6]|th|label)[^>]*>[^<]{0,6}\p{Extended_Pictographic}/u.test(text)) add("emoji", "Emoji in headings/buttons. Use text (or a real icon set) instead.", text.search(/<h[1-6][^>]*>\s*\p{Extended_Pictographic}|(^|\n)#{1,4}\s*\p{Extended_Pictographic}/u), "error");
  else if ((copy.match(/\p{Extended_Pictographic}/gu) || []).length >= 4) add("emoji", "Many emoji in UI copy. Remove decorative emoji.");
  if (/\b(tagline|hero-?(title|subtitle)|feature-card|testimonial|pricing)\b/i.test(styles) && kind !== "md") add("marketing", "Landing-page sections (hero/features/testimonials) inside a tool. Build the tool itself; no self-promotion.");
  return out;
}

/** BlocksUI source checks: unknown components, raw CSS, markup the runtime ignores. */
export function blocksLint(src: string, known: Set<string>): Issue[] {
  const out: Issue[] = [];
  const tags = new Set([...src.matchAll(/<(x-[a-z0-9-]+)/g)].map((m) => m[1]));
  const unknown = [...tags].filter((t) => !known.has(t));
  if (unknown.length) out.push({ rule: "blocks-unknown", msg: `Unknown components: ${unknown.join(", ")}. ui_search for real ones or use plain HTML.`, severity: "error" });
  if (/<style(?![^>]*type=["']?rel)/i.test(src)) out.push({ rule: "blocks-css", msg: "Raw <style> in BlocksUI. Use <style type=\"rel\"> relations; the runtime owns visuals.", severity: "warn" });
  if (/style="[^"]*(color|background|font|border|box-shadow)/i.test(src)) out.push({ rule: "blocks-inline", msg: "Inline visual styles in BlocksUI. Remove them; use tone/variant attributes.", severity: "warn" });
  return [...out, ...slopLint(src, "ui").filter((i) => !["font-cdn"].includes(i.rule))];
}

export const fmtIssues = (issues: Issue[], where = "") => issues.map((i) => `- ${i.severity === "error" ? "✗" : "!"} [${i.rule}]${where ? ` ${where}` : ""}${i.line ? `:${i.line}` : ""} ${i.msg}`).join("\n");
