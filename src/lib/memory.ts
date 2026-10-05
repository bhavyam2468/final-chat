import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { WS, ensureWorkspace } from "./workspace";
import { projectSlug } from "./projects";

/** Three layers, all visible and deletable: AGENTS.md (the model appends), profile (stable facts), episodes (per-chat notes retrieved by overlap). */

const dir = () => path.join(WS, "system", "memory");
const profilePath = () => path.join(dir(), "profile.md");
const episodesPath = () => path.join(dir(), "episodes.jsonl");
const trashPath = () => path.join(dir(), "trash.jsonl");

export type Episode = { id: string; text: string; at: string; scope: "profile" | "episode" | "project" };
type Forgotten = { id: string; text: string; scope: Episode["scope"]; file: string; raw: string; at: string };

async function ready() {
  await ensureWorkspace();
  await fs.mkdir(dir(), { recursive: true });
  if (!fss.existsSync(profilePath())) await fs.writeFile(profilePath(), "# Profile\n");
  if (!fss.existsSync(episodesPath())) await fs.writeFile(episodesPath(), "");
}

function words(s: string) {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

export async function memoryPrompt(query: string): Promise<string> {
  await ready();
  const profile = (await fs.readFile(profilePath(), "utf8").catch(() => "")).trim();
  const lines = (await fs.readFile(episodesPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const eps: Episode[] = [];
  for (const line of lines) { try { eps.push(JSON.parse(line)); } catch { /* skip a torn line */ } }
  const q = words(query);
  const scored = eps.map((e) => ({ e, s: [...words(e.text)].filter((w) => q.has(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
  const bits = [
    profile && profile !== "# Profile" ? profile.slice(0, 1200) : "",
    scored.length ? "Related notes:\n" + scored.map((x) => `- [${x.e.id}] ${x.e.text}`).join("\n") : "",
  ].filter(Boolean);
  return bits.join("\n\n").slice(0, 1800);
}

const notesPath = (project: string) => path.join(WS, "projects", projectSlug(project), "NOTES.md");

export async function remember(text: string, scope: "profile" | "episode" | "project" = "episode", project?: string): Promise<Episode> {
  await ready();
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!clean) throw new Error("empty memory");
  if (scope === "project" && !project) throw new Error("no project linked. project_open first, or use profile / episode.");
  const id = nanoid(8);
  const row: Episode = { id, text: clean, at: new Date().toISOString(), scope };
  if (scope === "profile") {
    const cur = await fs.readFile(profilePath(), "utf8").catch(() => "# Profile\n");
    await fs.writeFile(profilePath(), cur.replace(/\s*$/, "") + `\n- [${id}] ${clean}\n`);
  } else if (scope === "project" && project) {
    const file = notesPath(project);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const cur = await fs.readFile(file, "utf8").catch(() => `# Notes\n`);
    await fs.writeFile(file, cur.replace(/\s*$/, "") + `\n- [${id}] ${clean}\n`);
  } else {
    await fs.appendFile(episodesPath(), JSON.stringify(row) + "\n");
  }
  return row;
}

export async function revise(id: string, text: string): Promise<boolean> {
  await ready();
  const safe = id.replace(/[^\w-]/g, "");
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!safe || !clean) return false;
  let hit = false;
  const rewrite = async (file: string) => {
    const cur = await fs.readFile(file, "utf8").catch(() => "");
    if (!cur.includes(`[${safe}]`)) return;
    hit = true;
    await fs.writeFile(file, cur.replace(new RegExp(`(\\- \\[${safe}\\] ).*`), `$1${clean}`));
  };
  await rewrite(profilePath());
  const projects = path.join(WS, "projects");
  for (const name of await fs.readdir(projects).catch(() => [] as string[])) await rewrite(path.join(projects, name, "NOTES.md"));
  const lines = (await fs.readFile(episodesPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const next = lines.map((l) => {
    try {
      const row = JSON.parse(l) as Episode;
      if (row.id !== safe) return l;
      hit = true;
      return JSON.stringify({ ...row, text: clean });
    } catch { return l; }
  });
  if (hit) await fs.writeFile(episodesPath(), next.length ? next.join("\n") + "\n" : "");
  return hit;
}

async function archiveForgotten(entry: Forgotten) { await fs.appendFile(trashPath(), JSON.stringify(entry) + "\n"); }

export async function forget(id: string): Promise<boolean> {
  await ready();
  const safe = id.replace(/[^\w-]/g, "");
  if (!safe) return false;
  let hit = false;
  const now = new Date().toISOString();
  const prof = await fs.readFile(profilePath(), "utf8").catch(() => "");
  const profileLines = prof.split("\n");
  for (const line of profileLines) if (line.includes(`[${safe}]`)) {
    hit = true;
    await archiveForgotten({ id: safe, text: line.replace(/^.*\]\s*/, ""), scope: "profile", file: "system/memory/profile.md", raw: line, at: now });
  }
  if (hit) await fs.writeFile(profilePath(), profileLines.filter((l) => !l.includes(`[${safe}]`)).join("\n").replace(/\n{3,}/g, "\n\n"));

  const projects = path.join(WS, "projects");
  for (const name of await fs.readdir(projects).catch(() => [] as string[])) {
    const file = path.join(projects, name, "NOTES.md");
    const cur = await fs.readFile(file, "utf8").catch(() => "");
    const lines = cur.split("\n");
    for (const line of lines) if (line.includes(`[${safe}]`)) {
      hit = true;
      await archiveForgotten({ id: safe, text: line.replace(/^.*\]\s*/, ""), scope: "project", file: `projects/${name}/NOTES.md`, raw: line, at: now });
    }
    if (lines.some((l) => l.includes(`[${safe}]`))) await fs.writeFile(file, lines.filter((l) => !l.includes(`[${safe}]`)).join("\n"));
  }

  const lines = (await fs.readFile(episodesPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const keep: string[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as Episode;
      if (row.id === safe) { hit = true; await archiveForgotten({ id: safe, text: row.text, scope: row.scope, file: "system/memory/episodes.jsonl", raw: line, at: now }); }
      else keep.push(line);
    } catch { keep.push(line); }
  }
  if (keep.length !== lines.length) await fs.writeFile(episodesPath(), keep.length ? keep.join("\n") + "\n" : "");
  return hit;
}

export async function restoreForgotten(id: string): Promise<boolean> {
  await ready();
  const safe = id.replace(/[^\w-]/g, "");
  if (!safe) return false;
  const rows = (await fs.readFile(trashPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
  let index = -1, entry: Forgotten | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    try { const row = JSON.parse(rows[i]) as Forgotten; if (row.id === safe) { index = i; entry = row; break; } } catch { /* skip damaged history lines */ }
  }
  if (!entry || index < 0) return false;
  if (entry.file === "system/memory/episodes.jsonl" && entry.scope === "episode") {
    const current = await fs.readFile(episodesPath(), "utf8").catch(() => "");
    if (current.includes(`\"id\":\"${safe}\"`)) return false;
    await fs.appendFile(episodesPath(), entry.raw + "\n");
  } else if (entry.file === "system/memory/profile.md" || /^projects\/[\w-]+\/NOTES\.md$/.test(entry.file)) {
    const abs = path.resolve(WS, entry.file);
    if (!abs.startsWith(path.resolve(WS) + path.sep)) return false;
    const current = await fs.readFile(abs, "utf8").catch(() => "");
    if (current.includes(`[${safe}]`)) return false;
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.appendFile(abs, (current && !current.endsWith("\n") ? "\n" : "") + entry.raw + "\n");
  } else return false;
  rows.splice(index, 1);
  await fs.writeFile(trashPath(), rows.length ? rows.join("\n") + "\n" : "");
  return true;
}
