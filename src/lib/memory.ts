import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { WS, ensureWorkspace } from "./workspace";
import { projectSlug } from "./projects";
import { pickNotes, profileBody, sliceLines, when, norm, Rankable } from "./memory-rank";

/**
 * Three stores, all visible and deletable: profile (stable facts, always in context),
 * episodes (dated notes retrieved by relevance), project notes (projects/<slug>/NOTES.md).
 * AGENTS.md is *not* a store — it is the user's own instruction file.
 */

const dir = () => path.join(WS, "system", "memory");
const profilePath = () => path.join(dir(), "profile.md");
const episodesPath = () => path.join(dir(), "episodes.jsonl");

export type Episode = Rankable & { scope: "profile" | "episode" | "project" };

async function ready() {
  await ensureWorkspace();
  await fs.mkdir(dir(), { recursive: true });
  if (!fss.existsSync(profilePath())) await fs.writeFile(profilePath(), "# Profile\n");
  if (!fss.existsSync(episodesPath())) await fs.writeFile(episodesPath(), "");
}

export async function memoryPrompt(query: string): Promise<string> {
  await ready();
  const profile = (await fs.readFile(profilePath(), "utf8").catch(() => "")).trim();
  const lines = (await fs.readFile(episodesPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const eps: Episode[] = [];
  for (const line of lines) { try { eps.push(JSON.parse(line)); } catch { /* skip a torn line */ } }
  const picked = pickNotes(eps, query);
  const bits = [
    profileBody(profile) ? sliceLines(profileBody(profile), 1200) : "",
    picked.length ? "Notes from earlier chats (dated; forget(id) removes one):\n" + picked.map((e) => `- [${e.id}]${when(e.at) ? ` (${when(e.at)})` : ""} ${e.text}`).join("\n") : "",
  ].filter(Boolean);
  return sliceLines(bits.join("\n\n"), 1800);
}

const notesPath = (project: string) => path.join(WS, "projects", projectSlug(project), "NOTES.md");
const MAX_EPISODES = 800;

export async function remember(text: string, scope: "profile" | "episode" | "project" = "episode", project?: string): Promise<Episode> {
  await ready();
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!clean) throw new Error("empty memory");
  if (scope === "project" && !project) throw new Error("no project linked. project_open first, or use profile / episode.");
  const id = nanoid(8);
  const row: Episode = { id, text: clean, at: new Date().toISOString(), scope };
  if (scope === "profile") {
    const cur = await fs.readFile(profilePath(), "utf8").catch(() => "# Profile\n");
    if (cur.split("\n").some((l) => norm(l.replace(/^-\s*\[[^\]]*\]\s*/, "")) === norm(clean))) return row; // same fact already there
    await fs.writeFile(profilePath(), cur.replace(/\s*$/, "") + `\n- [${id}] ${clean}\n`);
  } else if (scope === "project" && project) {
    const file = notesPath(project);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const cur = await fs.readFile(file, "utf8").catch(() => `# Notes\n`);
    if (cur.split("\n").some((l) => norm(l.replace(/^-\s*\[[^\]]*\]\s*/, "")) === norm(clean))) return row;
    await fs.writeFile(file, cur.replace(/\s*$/, "") + `\n- [${id}] ${clean}\n`);
  } else {
    const lines = (await fs.readFile(episodesPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
    const eps: Episode[] = [];
    for (const line of lines) { try { eps.push(JSON.parse(line)); } catch { eps.push({ id: "", text: "", at: "", scope: "episode" }); } }
    const dup = eps.find((e) => e.id && norm(e.text) === norm(clean));
    if (dup) { // say the same thing again → freshen the note instead of duplicating it
      const next = lines.map((l) => { try { const e = JSON.parse(l) as Episode; return e.id === dup.id ? JSON.stringify({ ...e, at: row.at }) : l; } catch { return l; } });
      await fs.writeFile(episodesPath(), next.join("\n") + "\n");
      return { ...dup, at: row.at };
    }
    const kept = eps.filter((e) => e.id).slice(-(MAX_EPISODES - 1));
    kept.push(row);
    await fs.writeFile(episodesPath(), kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
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

export async function forget(id: string): Promise<boolean> {
  await ready();
  const safe = id.replace(/[^\w-]/g, "");
  if (!safe) return false;
  let hit = false;
  const prof = await fs.readFile(profilePath(), "utf8").catch(() => "");
  if (prof.includes(`[${safe}]`)) {
    hit = true;
    await fs.writeFile(profilePath(), prof.split("\n").filter((l) => !l.includes(`[${safe}]`)).join("\n").replace(/\n{3,}/g, "\n\n"));
  }
  const projects = path.join(WS, "projects");
  for (const name of await fs.readdir(projects).catch(() => [] as string[])) {
    const file = path.join(projects, name, "NOTES.md");
    const cur = await fs.readFile(file, "utf8").catch(() => "");
    if (!cur.includes(`[${safe}]`)) continue;
    hit = true;
    await fs.writeFile(file, cur.split("\n").filter((l) => !l.includes(`[${safe}]`)).join("\n"));
  }
  const lines = (await fs.readFile(episodesPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const keep = lines.filter((l) => { try { return JSON.parse(l).id !== safe; } catch { return true; } });
  if (keep.length !== lines.length) { hit = true; await fs.writeFile(episodesPath(), keep.length ? keep.join("\n") + "\n" : ""); }
  return hit;
}
