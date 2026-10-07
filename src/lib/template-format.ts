/**
 * Templates: a small, verified piece the model pulls instead of inventing one.
 *
 * A template is a folder with a `template.md` in it — front matter for the shape, the body for the prose and
 * the source, `{{key}}` for the parts that change. The three kinds are the three things a model is reliably
 * bad at when it writes them from memory:
 *
 *   circuit  a circuitikz/TikZ drawing that has to be *right* (a half adder, a bridge rectifier). The library
 *            ships ones that were rendered before they were saved, and `templates.ts` renders the source
 *            again whenever a template is read, so "it compiles" is a fact the model can rely on;
 *   block    a Blocks document that has to *work* (a quiz with scoring, a live dashboard, a poll). The shell
 *            is reusable; the model fills the content;
 *   doc      prose structure (a lab report, a study plan) with the sections already in the right order.
 *
 * Community contribution is the same move as skills and workflows: a folder you drop in, or the agent
 * writing one for you through `template_save`. This file is the parser and nothing else — no fs, no Next — so
 * it can be unit-tested the way `workflow-format.ts` is.
 */

export const TEMPLATE_KINDS = ["circuit", "block", "doc"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type TemplateVar = { name: string; label: string; example: string };
export type TemplateDef = {
  name: string;
  kind: TemplateKind;
  title: string;
  description: string;
  tags: string[];
  vars: TemplateVar[];
  body: string;
  dir: string;
  /** where it came from: shipped with the app, or written in this workspace */
  source: "bundled" | "user";
  /** the fenced block that is the actual artefact (tex for a circuit, the Blocks source for a block); "" for a doc */
  code: string;
  codeLang: string;
  files: string[];
};

export type TemplateSpec = {
  name: string;
  kind: string;
  title?: string;
  description?: string;
  tags?: string[] | string;
  vars?: (Partial<TemplateVar> & { name?: string })[] | string;
  body?: string;
  /** extra files for the folder, e.g. a BOM next to the schematic */
  files?: { path: string; content: string }[];
  overwrite?: boolean;
};

const KIND_SET = new Set<string>(TEMPLATE_KINDS);
const LANGS: Record<TemplateKind, string[]> = {
  circuit: ["tex", "tikz", "latex"],
  block: ["html", "ui", "blocks"],
  doc: [],
};

/** `name | label | example` — the same forgiving third field as workflows, used for previews and tests. */
export function parseVarLine(line: string): TemplateVar | null {
  const parts = line.replace(/^\s*[-*]\s*/, "").split("|").map((s) => s.trim());
  const name = (parts[0] || "").trim();
  if (!/^[\w-]+$/.test(name)) return null;
  return { name, label: parts[1] || name, example: parts[2] || "" };
}

/** The first fenced block of the kind's language — the artefact; everything else in the body is prose. */
export function firstFence(body: string, kind: TemplateKind): { code: string; lang: string } {
  const want = LANGS[kind];
  const fences = [...String(body || "").matchAll(/^```([\w-]*)\n([\s\S]*?)^```/gm)];
  const pick = fences.find((f) => want.includes((f[1] || "").toLowerCase())) || (kind === "doc" ? null : fences[0]);
  return pick ? { code: pick[2].replace(/\s+$/, ""), lang: (pick[1] || "").toLowerCase() } : { code: "", lang: "" };
}

/** Front matter + body → a definition. Throws with a sentence the model can act on. */
export function parseTemplate(text: string, dir: string, source: "bundled" | "user" = "bundled"): TemplateDef {
  const m = String(text || "").match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/);
  if (!m) throw new Error("template.md needs front matter (--- … ---) with at least name, kind and title");
  const fm = m[1];
  const body = text.slice(m[0].length);
  const one = (k: string) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
  const name = one("name").replace(/[^\w-]/g, "");
  if (!name) throw new Error("front matter needs a name (one word: letters, digits, - and _)");
  const kind = one("kind").toLowerCase();
  if (!KIND_SET.has(kind)) throw new Error(`kind must be one of ${TEMPLATE_KINDS.join(", ")} (got "${kind || "nothing"}")`);
  const title = one("title") || name;
  const description = one("description");
  if (!description) throw new Error(`${name}: front matter needs a description (one line, shown when searching)`);
  const tags = (one("tags") || "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  // vars: either a repeated `- name | label | example` list, or one comma-separated line
  const vars: TemplateVar[] = [];
  const list = fm.match(/^vars:\s*$([\s\S]*?)(?=^\S|$(?![\s\S]))/m);
  if (list) {
    for (const line of list[1].split("\n")) {
      if (!line.trim()) continue;
      const v = parseVarLine(line);
      if (v) vars.push(v);
    }
  } else {
    for (const piece of (one("vars") || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const v = parseVarLine(piece);
      if (v) vars.push(v);
    }
  }
  const k = kind as TemplateKind;
  const fence = firstFence(body, k);
  return { name, kind: k, title, description, tags, vars, body, dir, source, code: fence.code, codeLang: fence.lang, files: [] };
}

/** The placeholders a body actually uses, in order, so a new template's vars can be checked against its text. */
export function bodyVars(body: string): string[] {
  const out: string[] = [];
  for (const m of String(body || "").matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export type FillResult = { text: string; missing: string[]; usedExample: string[] };

/**
 * `{{key}}` → the value. A value that was not given falls back to the template's example (so a preview is a
 * real document rather than a page of braces) and is reported, so the caller can say what it guessed.
 */
export function fillTemplate(text: string, values: Record<string, string> = {}, vars: TemplateVar[] = []): FillResult {
  const byName = new Map(vars.map((v) => [v.name, v]));
  const missing: string[] = [];
  const usedExample: string[] = [];
  const out = String(text || "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) => {
    const given = values[key];
    if (given !== undefined && given !== "") return given;
    const ex = byName.get(key)?.example || "";
    if (ex) { usedExample.push(key); return ex; }
    if (!missing.includes(key)) missing.push(key);
    return whole;
  });
  return { text: out, missing, usedExample: [...new Set(usedExample)] };
}

/** Search ranking for the palette and `template_search`: name and tags weigh more than prose. */
export function scoreTemplate(def: TemplateDef, query: string): number {
  const words = String(query || "").toLowerCase().split(/\W+/).filter(Boolean);
  if (!words.length) return 1;
  const hay = `${def.title} ${def.description}`.toLowerCase();
  return words.reduce((a, w) => {
    let s = 0;
    if (def.name === w) s += 6;
    else if (def.name.includes(w)) s += 3;
    if (def.tags.includes(w)) s += 3;
    else if (def.tags.some((t) => t.includes(w))) s += 2;
    if (def.kind === w) s += 3;
    if (hay.includes(w)) s += 1;
    return a + s;
  }, 0);
}

/** Files on disk → the text of a definition (the same shape `parseTemplate` reads back). */
export function templateText(spec: TemplateSpec): string {
  const name = String(spec.name || "").trim().replace(/[^\w-]/g, "");
  if (!/^[\w-]+$/.test(name)) throw new Error("name must be one word (letters, digits, - and _)");
  const kind = String(spec.kind || "").toLowerCase();
  if (!KIND_SET.has(kind)) throw new Error(`kind must be one of ${TEMPLATE_KINDS.join(", ")}`);
  const title = String(spec.title || name).replace(/\n/g, " ").trim();
  const description = String(spec.description || "").replace(/\n/g, " ").trim();
  if (!description) throw new Error("description is required — one line, it is what the model sees when searching");
  const tags = (Array.isArray(spec.tags) ? spec.tags : String(spec.tags || "").split(/[,\s]+/)).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const vars = (Array.isArray(spec.vars) ? spec.vars : [])
    .map((v) => (typeof v === "string" ? parseVarLine(v) : v && v.name ? { name: String(v.name), label: String(v.label || v.name), example: String(v.example || "") } : null))
    .filter((v): v is TemplateVar => !!v && /^[\w-]+$/.test(v.name));
  const body = String(spec.body || "").trim();
  if (!body) throw new Error("body is required — the prose, with the source in a fenced block for a circuit or block");
  const lines = [
    "---",
    `name: ${name}`,
    `kind: ${kind}`,
    `title: ${title}`,
    `description: ${description}`,
    tags.length ? `tags: ${tags.join(", ")}` : "",
    vars.length ? "vars:" : "",
    ...vars.map((v) => `  - ${v.name} | ${v.label} | ${v.example}`),
    "---",
    "",
    body,
    "",
  ].filter((l) => l !== "");
  return lines.join("\n");
}

/** Compact shape for lists, tool results and the palette — never the whole body. */
export function publicTemplate(def: TemplateDef) {
  return {
    id: def.name, name: def.name, kind: def.kind, title: def.title, description: def.description,
    tags: def.tags, vars: def.vars.map((v) => ({ name: v.name, label: v.label, example: v.example })),
    source: def.source, files: def.files, hasSource: !!def.code,
  };
}
