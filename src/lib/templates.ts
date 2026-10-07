/**
 * The template library: what it is, where it lives, and the one guarantee that makes it worth having.
 *
 * Two shelves, read as one:
 *   workspace-template/templates/  shipped with the app (upgraded with it, read-only, community contributions
 *                                  arrive here as folders in a PR);
 *   workspace/templates/           yours — written by the user, or by the agent through `template_save`.
 * A user template with the same name shadows the bundled one.
 *
 * The guarantee: a template of kind `circuit` is **rendered through the same TikZ engine the block uses**
 * before it is handed over. `readTemplate` returns `check: {ok, error}`, so a model that pulls a half adder
 * learns in the same breath whether the drawing compiles — instead of pasting something that renders as a red
 * box in front of the user. Block templates get the same treatment through `uiIssues` (the checker the app
 * already uses to report problems inside a block), so a quiz template is known to be sound markup as well.
 */
import fs from "fs/promises";
import path from "path";
import { WS } from "./workspace";
import { renderTikz } from "./tikz";
import { uiIssues } from "./ui-check";
import {
  bodyVars, fillTemplate, parseTemplate, publicTemplate, scoreTemplate, templateText,
} from "./template-format";
import type { TemplateDef, TemplateKind, TemplateSpec } from "./template-format";

const BUNDLED = path.resolve("./workspace-template/templates");
export const TEMPLATES_DIR = () => path.join(WS, "templates");
export const TEMPLATE_KIND_LIST = ["circuit", "block", "doc"] as const;

async function shelf(root: string, source: "bundled" | "user"): Promise<TemplateDef[]> {
  const out: TemplateDef[] = [];
  for (const d of (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort()) {
    const dir = path.join(root, d);
    const text = await fs.readFile(path.join(dir, "template.md"), "utf8").catch(() => "");
    try {
      const def = parseTemplate(text, dir, source);
      def.files = (await fs.readdir(dir).catch(() => [])).filter((f) => f !== "template.md").sort();
      out.push(def);
    } catch {
      // a broken folder is not a template; the checker test names the files that failed
    }
  }
  return out;
}

/** Both shelves, user first so a same-named user template wins. */
export async function listTemplates(): Promise<TemplateDef[]> {
  const user = await shelf(TEMPLATES_DIR(), "user");
  const bundled = await shelf(BUNDLED, "bundled");
  const seen = new Set(user.map((d) => d.name));
  return [...user, ...bundled.filter((d) => !seen.has(d.name))];
}

export async function findTemplate(name: string): Promise<TemplateDef | null> {
  const clean = String(name || "").trim().replace(/[^\w-]/g, "");
  if (!clean) return null;
  return (await listTemplates()).find((t) => t.name === clean) || null;
}

/** Ranked search: what `template_search` and the palette use. */
export async function searchTemplates(query: string, kind?: string, limit = 8) {
  const k = String(kind || "").toLowerCase();
  return (await listTemplates())
    .filter((t) => !k || t.kind === k)
    .map((t) => ({ t, s: scoreTemplate(t, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name))
    .slice(0, limit)
    .map((x) => publicTemplate(x.t));
}

export type ReadTemplate = {
  template: ReturnType<typeof publicTemplate>;
  /** the artefact with the values filled in: the TikZ source, or the Blocks document */
  source: string;
  /** the whole body (prose + fence) with the values filled in, for showing or reading */
  body: string;
  files: { path: string; content: string }[];
  missing: string[];
  usedExample: string[];
  check: { ok: boolean; error?: string; problems?: string[] };
};

/**
 * Read one template with `values` filled in, and verify it:
 *   circuit → renderTikz (the real engine, the real packages) — a failure is reported, never thrown;
 *   block   → uiIssues, the checker the app runs on a block before it agrees to render it.
 * `check.ok` means "this will come out right", not "this might".
 */
export async function readTemplate(name: string, values: Record<string, string> = {}): Promise<ReadTemplate> {
  const def = await findTemplate(name);
  if (!def) throw new Error(`no template called "${String(name || "").trim()}" — template_search first`);
  const filled = fillTemplate(def.body, values, def.vars);
  const source = def.code ? fillTemplate(def.code, values, def.vars).text : "";
  const files: { path: string; content: string }[] = [];
  for (const f of def.files.slice(0, 12)) {
    const text = await fs.readFile(path.join(def.dir, f), "utf8").catch(() => "");
    if (text) files.push({ path: f, content: text.slice(0, 20_000) });
  }
  let check: ReadTemplate["check"] = { ok: true };
  if (def.kind === "circuit") {
    const r = await renderTikz(source);
    check = r.svg ? { ok: true } : { ok: false, error: r.error || "the drawing did not compile" };
  } else if (def.kind === "block") {
    const problems = uiIssues(`<ui>\n${source}\n</ui>`);
    check = problems.length ? { ok: false, problems, error: problems.join(" · ") } : { ok: true };
  }
  return {
    template: publicTemplate(def), source, body: filled.text, files,
    missing: filled.missing, usedExample: filled.usedExample, check,
  };
}

/** Everything a template needs, as one document: used by the tool result and by the canvas preview. */
export async function templateDoc(def: TemplateDef, values: Record<string, string> = {}) {
  const filled = fillTemplate(def.body, values, def.vars);
  return { body: filled.text, source: def.code ? fillTemplate(def.code, values, def.vars).text : "", missing: filled.missing, usedExample: filled.usedExample };
}

/** The unused-variable guard: a body that never mentions a declared var is a template that lies about itself. */
export function varMismatch(def: TemplateDef) {
  const declared = new Set(def.vars.map((v) => v.name));
  const used = new Set(bodyVars(def.body));
  return { unused: [...declared].filter((v) => !used.has(v)), undeclared: [...used].filter((v) => !declared.has(v)) };
}

export async function saveTemplate(spec: TemplateSpec): Promise<TemplateDef> {
  const text = templateText(spec); // throws with the reason before anything is written
  const def = parseTemplate(text, path.join(TEMPLATES_DIR(), String(spec.name || "").trim().replace(/[^\w-]/g, "")), "user");
  const dir = def.dir;
  const file = path.join(dir, "template.md");
  const exists = await fs.stat(file).then(() => true).catch(() => false);
  if (exists && !spec.overwrite) throw new Error(`${def.name} already exists — pass overwrite=true to replace it`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, text);
  for (const f of spec.files || []) {
    const rel = String(f.path || "").replace(/^\/+/, "").replace(/\.\./g, "");
    if (!rel || rel === "template.md") continue;
    const target = path.join(dir, rel);
    if (!target.startsWith(dir + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(f.content ?? ""));
  }
  def.files = (await fs.readdir(dir).catch(() => [])).filter((f) => f !== "template.md").sort();
  return def;
}

/**
 * Remove one of the user's own.
 *
 * A shipped template is refused on purpose: `ensureWorkspace` keeps the workspace's copy of the library in
 * sync with the bundle (that is how a template edit survives an upgrade and how a new one arrives), so
 * deleting the copy would either be undone or silently reappear — a DELETE that lies. Editing the copy is the
 * way to make it yours; saving under a new name is the way to make a variant.
 */
export async function removeTemplate(name: string): Promise<{ ok: boolean; error?: string }> {
  const def = await findTemplate(name);
  if (!def) return { ok: false, error: `no template called "${String(name || "").trim()}"` };
  const shipped = await fs.stat(path.join(BUNDLED, def.name)).then(() => true, () => false);
  if (shipped) return { ok: false, error: `${def.name} ships with the app — edit its copy in templates/${def.name}/ or save a variant under another name` };
  if (def.dir !== path.join(TEMPLATES_DIR(), def.name)) return { ok: false, error: `${def.name} is not in your shelf` };
  await fs.rm(def.dir, { recursive: true, force: true });
  return { ok: true };
}

/** The palette's list: ids, kinds, titles — never the sources. */
export async function templateCatalog() {
  const templates = (await listTemplates()).map(publicTemplate);
  return { templates, kinds: [...TEMPLATE_KIND_LIST] as TemplateKind[] };
}
