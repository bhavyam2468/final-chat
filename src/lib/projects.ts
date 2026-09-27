import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { WS } from "./workspace";

export function projectSlug(name: string) {
  return (name || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
}

export async function ensureProject(name: string) {
  const id = projectSlug(name);
  const dir = path.join(WS, "projects", id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "PROJECT.md");
  if (!fss.existsSync(file)) {
    await fs.writeFile(file, `# ${name.trim() || id}\n\nInstructions for every chat linked to this project. Edit this file.\n`);
  }
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return { id, path: `projects/${id}/PROJECT.md`, text };
}

export async function projectText(id: string) {
  const file = path.join(WS, "projects", projectSlug(id), "PROJECT.md");
  return fs.readFile(file, "utf8").catch(() => "");
}

export async function listProjects() {
  const dir = path.join(WS, "projects");
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: { id: string; title: string }[] = [];
  for (const id of names) {
    const file = path.join(dir, id, "PROJECT.md");
    if (!fss.existsSync(file)) continue;
    const title = (await fs.readFile(file, "utf8").catch(() => "")).match(/^#\s+(.+)/)?.[1] || id;
    out.push({ id, title });
  }
  return out;
}
