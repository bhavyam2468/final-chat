/**
 * Deterministic "slop" lint for things the agent builds (HTML/CSS/JSX/BlocksUI/markdown documents).
 * Targets the recurring defaults of small and distilled models: novelty fonts, neon/cyberpunk styling, purple
 * gradients, glass, emoji headings, marketing copy, self-promotion, helper text, and the "second-order"
 * defaults models fall into once told to avoid the first ones (cream + terracotta, near-black + one acid accent,
 * tracked all-caps eyebrows, decorative 01/02/03, fake window dots). Each finding carries a fix the model can act on.
 *
 * The brief wins: pass the user's request as `brief`; a rule is skipped when the user asked for that style
 * ("make it cyberpunk", "use Orbitron", "purple gradient hero"). Calibration follows avoid-ai-design
 * (MIT, funboy322): flag defaults reached for without reason, judge combinations, never override the brief.
 */
export type Issue = { rule: string; msg: string; line?: number; severity: "error" | "warn" };
export type LintOpts = { brief?: string };

const FONTS = ["orbitron", "audiowide", "exo 2", "exo", "rajdhani", "oxanium", "press start 2p", "michroma", "russo one", "syncopate", "monoton", "bungee", "righteous", "black ops one", "share tech mono", "vt323", "comic sans", "papyrus", "lobster", "pacifico", "creepster", "space mono", "major mono display", "zen dots", "tektur", "chakra petch", "electrolize", "aldrich", "quantico", "iceland", "wallpoet", "faster one", "nosifer", "bangers"];
const HYPE = ["seamless", "seamlessly", "unleash", "elevate", "elevated", "cutting-edge", "cutting edge", "state-of-the-art", "stunning", "supercharge", "supercharged", "next-gen", "next generation", "immersive", "blazing", "blazingly", "lightning-fast", "effortless", "effortlessly", "revolutionary", "revolutionize", "game-changing", "game changer", "unlock", "unlocks", "harness the power", "empower", "empowering", "delightful", "sleek", "robust solution", "world-class", "ultimate", "magical", "cosmic", "futuristic", "breathtaking", "unparalleled", "transformative", "synergy", "leverage", "turbocharge", "masterpiece", "beautifully crafted", "crafted with", "reimagined", "embark", "journey", "dive into", "delve"];
const HELPERS = [
  /\bwelcome to\b/i, /\bget started\b/i, /\bclick here\b/i, /\bsimply (click|enter|type|select|drag)\b/i, /\bthis (app|tool|page|dashboard|widget) (lets|allows|helps|enables) you\b/i,
  /\b(enter|type) your [\w ]{1,24} (below|here)\b/i, /\bpowered by\b/i, /\bbuilt with\b/i, /\bmade with (love|❤️?)\b/i, /\ball rights reserved\b/i,
  /\blorem ipsum\b/i, /\bcoming soon\b/i, /\byour (ultimate|all-in-one|one-stop)\b/i, /\bto the next level\b/i, /\bdiscover the power\b/i, /\bexperience the\b/i,
  /\b(don'?t|do not) worry\b/i, /\bhappy (coding|learning|studying)\b/i, /\bpro tip\b/i, /\bfeel free to\b/i, /\btrusted by\b/i, /\bjoin (thousands|millions)\b/i,
];
/** Writing tells for documents the agent writes (reports, READMEs, notes). Distinct hits ≥3 → warn. */
const PROSE = ["delve", "delves", "tapestry", "testament to", "pivotal", "underscores", "underscore the", "realm of", "intricate", "meticulous", "meticulously", "navigate the complexities", "ever-evolving", "evolving landscape", "in today's fast-paced", "it's important to note", "it is important to note", "it's worth noting", "it is worth noting", "in conclusion", "plays a crucial role", "plays a vital role", "a rich tapestry", "multifaceted", "paramount", "bustling", "vibrant", "showcasing", "fostering", "seamless", "robust", "leverage", "unlock the", "stands as", "serves as a reminder", "at the end of the day", "game-changer"];
const NEON = /#(?:0ff|00ffff|f0f|ff00ff|39ff14|00ff41|0f0|00ff00|ff073a|fe53bb|08f7fe|09fbd3|f5d300|bc13fe|7df9ff|ccff00)\b/i;
const PURPLE = /#(?:8b5cf6|7c3aed|6d28d9|a855f7|9333ea|a78bfa|c084fc|6366f1|4f46e5|818cf8|ec4899|d946ef|e879f9|db2777)\b|\b(?:purple|violet|fuchsia|indigo|magenta)\b/i;
const CREAM = /#(?:f4f1ea|f5f0e8|faf7f2|f7f3ec|f5efe6|fbf8f3|f3eee4|efe9df|f6f1e7|faf6f0|f5f1e8|f2ede3|fdf8f0|f9f5ee)\b/i;
const TERRACOTTA = /#(?:d97757|c96442|cc785c|da7756|e07a5f|c2410c|b85c38|d4704a|c65f3c|e2725b|bd5d38)\b/i;
const NEAR_BLACK = /#(?:0a0a0a|0b0b0b|0c0c0c|0d0d0d|111|111111|09090b|0a0a0b|0e0e0e)\b|bg-(?:zinc|neutral|stone)-950/i;
const ACID = /#(?:a3e635|84cc16|bef264|d9f99d|c6ff00|b8ff00|ccff00|39ff14|00ff88|22ff88|ff4500|ff3b00|d4ff00|e4ff1a)\b|\b(?:text|bg|border)-lime-(?:3|4|5)00\b/i;
const EFFECTS = /\b(Spotlight|BackgroundBeams|AnimatedBeam|ShimmerButton|BorderBeam|NumberTicker|Meteors|SparklesCore|TextGenerateEffect|TypewriterEffect|AuroraBackground|BackgroundGradientAnimation|CardContainer|WavyBackground|LampContainer|GlowingStarsBackgroundCard)\b/;
const PLACEHOLDER_MEDIA = /(pravatar\.cc|api\.dicebear\.com|ui-avatars\.com|randomuser\.me|via\.placeholder\.com|placehold\.co|placekitten\.com|picsum\.photos|source\.unsplash\.com|boring-avatars)/i;

/** Styles the user explicitly asked for, keyed by rule. A matching brief disables that rule. */
const BRIEF: [RegExp, string[]][] = [
  [/\b(neon|cyber\w*|synthwave|vaporwave|retro-?wave|arcade|8-?bit|pixel|hacker|matrix|terminal|glitch|holo\w*|tron|blade runner|80s|sci-?fi)\b/, ["neon", "glow", "cyber", "caps", "font", "near-black-acid", "mono-labels"]],
  [/\b(gradients?|purple|violet|indigo|magenta|fuchsia|pink)\b/, ["gradient", "gradient-text"]],
  [/\b(glass\w*|frosted|blur\w*|translucent)\b/, ["glass"]],
  [/\bemoji/, ["emoji"]],
  [/\b(animat\w*|motion|pulse|bounce|playful|lively|count-?up)\b/, ["motion", "bounce", "countup"]],
  [/\b(landing|marketing|homepage|home page|hero|saas|pitch|sales page|launch page|waitlist|portfolio)\b/, ["marketing", "helper", "stats"]],
  [/\b(cream|beige|parchment|paper|terracotta|warm|editorial|anthropic|claude)\b/, ["cream-terracotta"]],
  [/\b(lime|acid|green|terminal|hacker|matrix|console)\b/, ["near-black-acid"]],
  [/\b(steps?|how it works|numbered|timeline|roadmap|sequence)\b/, ["numbered"]],
  [/\b(mac\w*|window|terminal|traffic lights?|screenshot mock)\b/, ["window-dots"]],
  [/\b(uppercase|all caps|all-caps|small caps|eyebrow)\b/, ["caps"]],
  [/\b(stripe|border accent|left border|callout)\b/, ["stripe"]],
  [/\b(placeholder|mock ?data|dummy|avatar)\b/, ["placeholder-media"]],
];
function allowed(brief: string) {
  const off = new Set<string>();
  const b = brief.toLowerCase();
  for (const [re, rules] of BRIEF) if (re.test(b)) rules.forEach((r) => off.add(r));
  return off;
}

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

export function slopLint(text: string, kind = "html", opts: LintOpts = {}): Issue[] {
  const out: Issue[] = [];
  const off = allowed(opts.brief || "");
  const brief = (opts.brief || "").toLowerCase();
  const add = (rule: string, msg: string, idx?: number, severity: Issue["severity"] = "warn") => {
    if (off.has(rule)) return;
    if (out.filter((i) => i.rule === rule).length < 4) out.push({ rule, msg, severity, ...(idx !== undefined && idx >= 0 ? { line: lineOf(text, idx) } : {}) });
  };
  const lower = text.toLowerCase();
  const code = kind !== "md";
  const styles = kind === "css" ? text : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style=\{?\{?["'`]?([^"'`>]*)|className=["'`]([^"'`]*)["'`]|class=["']([^"']*)["']/gi)].map((m) => m.slice(1).filter(Boolean).join(" ")).join("\n") + (/(css|scss|js|jsx|ts|tsx)$/.test(kind) ? "\n" + text : "");
  const copy = copyOf(text, kind);

  if (code) {
    // --- typography
    for (const f of new Set(FONTS)) {
      if (brief.includes(f)) continue;
      const i = lower.search(new RegExp(`font-family[^;\\n]*\\b${f.replace(/ /g, "[ +]")}\\b|family=${f.replace(/ /g, "\\+")}\\b|['"]${f}['"]`));
      if (i >= 0) add("font", `Novelty font "${f}". Use the system stack (system-ui, -apple-system, "Segoe UI", sans-serif) or one neutral text face.`, i, "error");
    }
    if (/fonts\.googleapis\.com/.test(lower) && !/offline|cdn ok/.test(lower)) add("font-cdn", "Google Fonts link: breaks offline use and adds a network dependency. Prefer the system font stack.", lower.indexOf("fonts.googleapis.com"));
    const caps = styles.match(/text-transform:\s*uppercase[^}]*letter-spacing:\s*(0?\.\d+|\d+)(em|px)/i) || styles.match(/letter-spacing:\s*(0?\.\d+|\d+)(em|px)[^}]*text-transform:\s*uppercase/i);
    const twCaps = (styles.match(/\buppercase\b[^"'`]*\btracking-(wider|widest|\[0?\.[1-9]\d*em\])/g) || []).length;
    if ((caps && ((caps[2] === "em" && parseFloat(caps[1]) >= 0.12) || (caps[2] === "px" && parseFloat(caps[1]) >= 2))) || twCaps >= 2) add("caps", "Tracked-out ALL-CAPS labels (template chrome). Keep a label only if it adds information; set it in sentence case in the body face.", caps ? text.indexOf(caps[0]) : undefined);

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
    // second-order defaults
    if (CREAM.test(styles) && TERRACOTTA.test(styles)) add("cream-terracotta", "Cream ground + terracotta accent (the default \"tasteful AI\" look). Derive ground and accent from the subject; move off both coordinates.", text.search(TERRACOTTA));
    if (NEAR_BLACK.test(styles) && ACID.test(styles)) add("near-black-acid", "Near-black ground + one acid-green/vermilion accent (the default \"technical\" look). Theme dark as a palette; pick an accent for meaning.", text.search(ACID));
    const stripes = (styles.match(/border-(left|top):\s*[3-8]px\s+solid\s+(?!rgba?\(\s*0|#0{3,6}\b|transparent)[^;]+|\bborder-l-[4-8]\s+border-(?!gray|zinc|neutral|stone|slate|black|white|transparent)[a-z]+-\d{3}/gi) || []).length;
    // one CSS rule styles every card: a thick coloured edge + rounded corners in the same rule is the tell itself
    const stripeRule = /\{[^}]*(border-(left|top):\s*[3-8]px\s+solid\s+(?!rgba?\(\s*0|#0{3,6}\b|transparent)[^;}]+[^}]*border-radius|border-radius[^}]*border-(left|top):\s*[3-8]px\s+solid\s+(?!rgba?\(\s*0|#0{3,6}\b|transparent))[^}]*\}/i.test(styles);
    if (stripes >= 2 || stripeRule) add("stripe", `Coloured stripe on the edge of cards (a strong AI tell). Drop it; separate by spacing, weight or position.`);
    if (/#ff5f5[67]\b[\s\S]{0,400}#(febc2e|ffbd2e)\b|traffic-?lights?|window-?dots/i.test(text)) add("window-dots", "Fake macOS window dots as decoration. Show the real interface or nothing.", text.search(/#ff5f5[67]\b|traffic-?lights?|window-?dots/i));
    const eff = text.match(EFFECTS);
    if (eff && /(jsx|tsx|js|ts|vue|svelte)$/.test(kind)) add("effects", `Stock effect component <${eff[1]}> (Aceternity/Magic UI). Cut it or build an effect tied to the product's own data.`, text.indexOf(eff[0]));
    const media = text.match(PLACEHOLDER_MEDIA);
    if (media) add("placeholder-media", `Placeholder media service ${media[1]} (fake avatars/images; breaks offline). Use real assets, initials, or nothing.`, text.indexOf(media[0]));
    if (/lovable-tagger|gpt-engineer|generated (by|with) (v0|bolt|lovable)|made with (v0|bolt|lovable)/i.test(text)) add("fingerprint", "Generator signature left in the page. Remove it.", text.search(/lovable-tagger|gpt-engineer|generated (by|with)|made with (v0|bolt|lovable)/i), "error");
    if (/cubic-bezier\(\s*[\d.]+\s*,\s*(-0?\.\d+|1\.\d+|[2-9][\d.]*)|cubic-bezier\(\s*[\d.]+\s*,\s*[-\d.]+\s*,\s*[\d.]+\s*,\s*(-0?\.\d+|1\.[1-9]\d*|[2-9][\d.]*)\s*\)|\beaseOutBack|\bease-?out-?back|\belastic\b|type:\s*["']spring["']\s*,\s*bounce/i.test(styles)) add("bounce", "Bounce/elastic easing. Use 120-200ms ease-out on state changes.", text.search(/cubic-bezier|easeOutBack|elastic|bounce/i));
    if (/\bcount-?up\b|\bcountUp\b|\banimateValue\b|\bNumberTicker\b|\buseCountUp\b/.test(text)) add("countup", "Count-up number animation. Show the number.", text.search(/count-?up|countUp|animateValue|NumberTicker|useCountUp/));
    if (/\.(html?|css)$|^(html|css)$/.test(kind) && /@keyframes|animation\s*:/.test(styles) && !/prefers-reduced-motion/.test(text)) add("reduced-motion", "Animations without a prefers-reduced-motion fallback. Add @media (prefers-reduced-motion: reduce) { * { animation: none; transition: none } }.");
    if (kind === "html" && /<(button|input|select|textarea|a\s)/i.test(text) && /<style/i.test(text) && !/:focus/.test(text)) add("focus", "No focus styles. Add :focus-visible outlines so the page works from the keyboard.");
  }

  // --- copy
  const hype = HYPE.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(copy));
  if (hype.length && (code || hype.length >= 2)) add("hype", `Marketing words: ${hype.slice(0, 6).join(", ")}. Say what the thing does in plain words, or say nothing.`, text.search(new RegExp(`\\b${hype[0]}\\b`, "i")), hype.length > 2 ? "error" : "warn");
  if (code) for (const h of HELPERS) { const i = copy.search(h); if (i >= 0) add("helper", `Filler/helper copy "${copy.slice(i, i + 40).trim()}". Remove it; labels and layout should explain the UI.`, text.search(h)); }
  const bangs = (copy.match(/[a-z)]!(\s|$)/gi) || []).length;
  if (bangs >= 2) add("exclaim", `${bangs} exclamation marks in ${code ? "UI copy" : "the text"}. Use a neutral tone.`);
  if (/(^|\n)\s*(#{1,4}\s*|<h[1-6][^>]*>\s*)\p{Extended_Pictographic}/u.test(text) || /<(button|h[1-6]|th|label|li)[^>]*>[^<]{0,6}\p{Extended_Pictographic}/u.test(text) || /(^|\n)\s*[-*]\s+\p{Extended_Pictographic}[\s\S]*?\n\s*[-*]\s+\p{Extended_Pictographic}/u.test(text)) add("emoji", "Emoji in headings, buttons or as bullets. Use text (or a real icon set) instead.", text.search(/<h[1-6][^>]*>\s*\p{Extended_Pictographic}|(^|\n)#{1,4}\s*\p{Extended_Pictographic}|(^|\n)\s*[-*]\s+\p{Extended_Pictographic}/u), "error");
  else if ((copy.match(/\p{Extended_Pictographic}/gu) || []).length >= 4) add("emoji", "Many emoji in the copy. Remove decorative emoji.");
  if (code && /✨/.test(copy)) add("sparkle", "Sparkle ✨ badge/icon (the stock \"AI\" ornament). Remove it.", text.indexOf("✨"));
  if (/\b(tagline|hero-?(title|subtitle)|feature-card|testimonial|pricing)\b/i.test(styles) && code) add("marketing", "Landing-page sections (hero/features/testimonials) inside a tool. Build the tool itself; no self-promotion.");
  const nums = copy.match(/(^|\s)0[1-9](?=\s|\.|$)/g) || [];
  if (code && nums.length >= 3 && /(^|\s)01\b/.test(copy) && /(^|\s)02\b/.test(copy)) add("numbered", "Decorative 01 / 02 / 03 markers on content that is not a sequence. Use real labels or none.");
  const stat = copy.match(/\b\d[\d,.]*\s?[kKmMbB]?\+\s+(happy\s+)?(users|customers|developers|teams|companies|downloads|clients|students|members)\b|\b99\.9+%\s+uptime\b|\b\d(\.\d)?\/5\s+(stars|rating)\b/i);
  if (code && stat) add("stats", `Invented social-proof number "${stat[0]}". Only show numbers the product really has.`, text.indexOf(stat[0]), "error");
  if (code && /\b(john|jane) doe\b|\bacme (inc|corp)\b/i.test(copy)) add("placeholder-media", "Placeholder identity (John Doe / Acme). Use real data or an empty state.");
  const arrows = (text.match(/<(button|a)\b[^>]*>[^<]*→\s*<\/(button|a)>/g) || []).length;
  if (arrows >= 3) add("arrows", `→ stapled to ${arrows} buttons/links. Keep arrows for real navigation only.`);

  if (!code) {
    const hits = PROSE.filter((w) => lower.includes(w));
    if (hits.length >= 3) add("prose", `AI-writing tells: ${hits.slice(0, 6).join(", ")}. Say it plainly; cut words that add no information.`, lower.indexOf(hits[0]));
    const neg = (copy.match(/\b(it'?s|this is|that'?s)\s+not\s+(just\s+)?[^.,;\n]{2,40}[,;—-]+\s*(it'?s|but)\b|\bnot only\b[^.]{3,80}\bbut also\b/gi) || []).length;
    if (neg >= 2) add("prose", `${neg}× "not X, it's Y" / "not only… but also". State the point directly.`);
    const dashes = (copy.match(/—/g) || []).length, words = copy.split(/\s+/).length;
    if (dashes >= 4 && dashes / Math.max(words, 1) > 1 / 120) add("prose", `${dashes} em dashes in ${words} words. Use commas, colons or full stops.`);
  }
  return out;
}

/** BlocksUI source checks: unknown components, raw CSS, markup the runtime ignores. */
export function blocksLint(src: string, known: Set<string>, opts: LintOpts = {}): Issue[] {
  const out: Issue[] = [];
  const tags = new Set([...src.matchAll(/<(x-[a-z0-9-]+)/g)].map((m) => m[1]));
  const unknown = [...tags].filter((t) => !known.has(t));
  if (unknown.length) out.push({ rule: "blocks-unknown", msg: `Unknown components: ${unknown.join(", ")}. ui_search for real ones or use plain HTML.`, severity: "error" });
  if (/<style(?![^>]*type=["']?rel)/i.test(src)) out.push({ rule: "blocks-css", msg: "Raw <style> in BlocksUI. Use <style type=\"rel\"> relations; the runtime owns visuals.", severity: "warn" });
  if (/style="[^"]*(color|background|font|border|box-shadow)/i.test(src)) out.push({ rule: "blocks-inline", msg: "Inline visual styles in BlocksUI. Remove them; use tone/variant attributes.", severity: "warn" });
  return [...out, ...slopLint(src, "ui", opts).filter((i) => !["font-cdn", "reduced-motion", "focus"].includes(i.rule))];
}

export const fmtIssues = (issues: Issue[], where = "") => issues.map((i) => `- ${i.severity === "error" ? "✗" : "!"} [${i.rule}]${where ? ` ${where}` : ""}${i.line ? `:${i.line}` : ""} ${i.msg}`).join("\n");
