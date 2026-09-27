import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { WS, ensureWorkspace } from "./workspace";

/** Three layers, all visible and deletable: AGENTS.md (the model appends), profile (stable facts), episodes (per-chat notes retrieved by overlap). */

const dir = () => path.join(WS, "system", "memory");
const profilePath = () => path.join(dir(), "profile.md");
const episodesPath = () => path.join(dir(), "episodes.jsonl");

export type Episode = { id: string; text: string; at: string; scope: "profile" | "episode" };

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

export async function remember(text: string, scope: "profile" | "episode" = "episode"): Promise<Episode> {
  await ready();
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!clean) throw new Error("empty memory");
  const id = nanoid(8);
  const row: Episode = { id, text: clean, at: new Date().toISOString(), scope };
  if (scope === "profile") {
    const cur = await fs.readFile(profilePath(), "utf8").catch(() => "# Profile\n");
    await fs.writeFile(profilePath(), cur.replace(/\s*$/, "") + `\n- [${id}] ${clean}\n`);
  } else {
    await fs.appendFile(episodesPath(), JSON.stringify(row) + "\n");
  }
  return row;
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
  const lines = (await fs.readFile(episodesPath(), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const keep = lines.filter((l) => { try { return JSON.parse(l).id !== safe; } catch { return true; } });
  if (keep.length !== lines.length) { hit = true; await fs.writeFile(episodesPath(), keep.length ? keep.join("\n") + "\n" : ""); }
  return hit;
}
