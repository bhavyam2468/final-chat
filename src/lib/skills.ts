import fs from "fs/promises";
import fss from "fs";
import path from "path";
import os from "os";
import { WS } from "./workspace";
import { runRaw } from "./exec";
import type { Settings } from "./settings";

/**
 * Skills = folders with SKILL.md (Agent Skills format: YAML front matter name + description, markdown body,
 * optional reference/ scripts/ files). Discovered in the workspace's system/skills plus the locations the
 * `npx skills` CLI writes to (.agents/skills, .claude/skills), so community skills work unchanged.
 * Extra front matter understood here:
 *   tools: dev              → opening the skill loads the dev tool pack (processes, browser, checks)
 *   requires: host-terminal | host-files → only listed when the user enabled that access
 */
export const SKILL_ROOTS = () => [path.join(WS, "system/skills"), path.join(WS, ".agents/skills"), path.join(WS, ".claude/skills")];

export function skillMeta(text: string) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
  const get = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "") || "";
  return { name: get("name"), description: get("description"), tools: get("tools"), requires: get("requires") };
}

export type SkillInfo = { name: string; dir: string; text: string; description: string; tools: string; requires: string; root: string };
export async function listSkills(): Promise<SkillInfo[]> {
  const out: SkillInfo[] = [];
  const seen = new Set<string>();
  for (const root of SKILL_ROOTS()) {
    for (const d of (await fs.readdir(root).catch(() => [] as string[])).sort()) {
      const dir = path.join(root, d);
      const text = await fs.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => "");
      if (!text || seen.has(d)) continue;
      seen.add(d);
      const m = skillMeta(text);
      out.push({ name: d, dir, text, description: m.description, tools: m.tools, requires: m.requires, root: path.relative(WS, root) });
    }
  }
  return out;
}

export const skillAllowed = (s: { requires: string }, st: Settings) =>
  !s.requires || (s.requires === "host-terminal" ? st.terminal === "host" : s.requires === "host-files" ? st.access !== "sandbox" : true);

export async function skillsIndex(st: Settings) {
  // Mode skills (mode-research, mode-plan…) are loaded by the mode itself, not selected by the model: listing
  // them next to the skills would invite the model to open one and change its own behaviour.
  const { isModeSkill } = await import("./modes");
  return (await listSkills()).filter((s) => skillAllowed(s, st) && !isModeSkill(s.name)).map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

export async function findSkill(name: string) {
  const clean = name.replace(/[^\w.-]/g, "");
  return (await listSkills()).find((s) => s.name === clean) || null;
}

export async function skillFiles(dir: string, sub = "", out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(path.join(dir, sub), { withFileTypes: true }).catch(() => [])) {
    const r = path.join(sub, e.name);
    if (e.isDirectory()) await skillFiles(dir, r, out);
    else if (r !== "SKILL.md" && out.length < 60) out.push(r);
  }
  return out;
}

/**
 * Install from GitHub: "owner/repo", "owner/repo/path/to/skill", or a github.com tree/blob URL.
 * Downloads the repo tarball once, finds every SKILL.md below the given path and copies each skill folder.
 * `pick` limits installation to named skills (repos like anthropics/skills contain many).
 */
const BUILTIN = path.resolve("./workspace-template/system/skills");
export async function installFromGitHub(source: string, pick?: string[]): Promise<{ installed: string[]; available: string[]; skipped: string[] }> {
  const m = source.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/SKILL\.md$/, "");
  const parts = m.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("use owner/repo or owner/repo/path");
  const [owner, repo] = parts;
  let ref = "HEAD", sub = parts.slice(2);
  if (sub[0] === "tree" || sub[0] === "blob") { ref = sub[1]; sub = sub.slice(2); }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-"));
  try {
    const r = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`, { signal: AbortSignal.timeout(60000) })
      .catch((e) => { const c = (e as { cause?: { code?: string; message?: string } }).cause; throw new Error(`download from GitHub failed: ${c?.code || c?.message || (e as Error).message}`); });
    if (!r.ok) throw new Error(`GitHub ${r.status} for ${owner}/${repo}`);
    await fs.writeFile(path.join(tmp, "a.tgz"), Buffer.from(await r.arrayBuffer()));
    const x = await runRaw("tar", ["-xzf", "a.tgz"], tmp, 60000);
    if (x.code !== 0) throw new Error("extract failed: " + x.out.slice(0, 200));
    const top = (await fs.readdir(tmp)).find((d) => d !== "a.tgz")!;
    const base = path.join(tmp, top, ...sub);
    const found: string[] = [];
    const walk = async (d: string, depth: number) => {
      if (depth > 5) return;
      if (fss.existsSync(path.join(d, "SKILL.md"))) { found.push(d); return; }
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") await walk(path.join(d, e.name), depth + 1);
    };
    await walk(base, 0);
    if (!found.length) throw new Error("no SKILL.md found at " + source);
    const names = await Promise.all(found.map(async (d) => skillMeta(await fs.readFile(path.join(d, "SKILL.md"), "utf8")).name || path.basename(d)));
    const installed: string[] = [], skipped: string[] = [];
    const want = pick?.length ? new Set(pick) : found.length === 1 ? null : new Set<string>();
    for (let i = 0; i < found.length; i++) {
      const name = names[i].replace(/[^\w.-]/g, "-");
      if (want && !want.has(name) && !want.has(path.basename(found[i]))) continue;
      if (fss.existsSync(path.join(BUILTIN, name))) { skipped.push(name); continue; } // never replace a built-in skill
      const dst = path.join(WS, "system/skills", name);
      await fs.rm(dst, { recursive: true, force: true });
      await fs.cp(found[i], dst, { recursive: true });
      await fs.writeFile(path.join(dst, ".source"), `${owner}/${repo}/${path.relative(path.join(tmp, top), found[i])}\n`);
      installed.push(name);
    }
    return { installed, available: names, skipped };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
