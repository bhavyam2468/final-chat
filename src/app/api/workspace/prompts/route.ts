import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { WS, ensureWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
const templateRoot = path.resolve("workspace-template");
const promptRoot = path.join(templateRoot, "system");
const backupRel = "system/.prompt-backups";

type SnapshotFile = { path: string; existed: boolean; backup?: string };
type Snapshot = { token: string; at: string; files: SnapshotFile[] };

async function shippedFiles(dir = promptRoot): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await shippedFiles(abs));
    else if (entry.isFile() && (abs === path.join(promptRoot, "SYSTEM.md") || abs === path.join(promptRoot, "AGENTS.md") || abs.startsWith(path.join(promptRoot, "skills") + path.sep))) out.push(path.relative(templateRoot, abs).split(path.sep).join("/"));
  }
  return out;
}

const inside = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep);

async function safeDir(rel: string) {
  const root = await fs.realpath(WS);
  const abs = path.resolve(root, rel);
  if (!inside(root, abs)) throw new Error("Invalid prompt path");
  const relative = path.relative(root, abs);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const st = await fs.lstat(current).catch(() => null);
    if (st?.isSymbolicLink()) throw new Error("Refusing to follow a linked prompt directory");
    if (!st) await fs.mkdir(current);
  }
  const real = await fs.realpath(current);
  if (!inside(root, real)) throw new Error("Prompt path resolves outside the workspace");
  return current;
}

async function destination(rel: string) {
  const root = await fs.realpath(WS);
  const abs = path.resolve(root, rel);
  if (!inside(root, abs)) throw new Error("Invalid prompt path");
  await safeDir(path.dirname(rel));
  const st = await fs.lstat(abs).catch(() => null);
  if (st?.isSymbolicLink()) throw new Error("Refusing to overwrite a linked prompt file");
  return abs;
}

async function latestSnapshot() {
  const root = await safeDir(backupRel);
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const snapshots: Snapshot[] = [];
  for (const entry of dirs) {
    if (!entry.isDirectory() || !/^[\w-]{1,40}$/.test(entry.name)) continue;
    try { snapshots.push(JSON.parse(await fs.readFile(path.join(root, entry.name, "manifest.json"), "utf8")) as Snapshot); } catch { /* incomplete backup */ }
  }
  snapshots.sort((a, b) => b.at.localeCompare(a.at));
  const top = snapshots[0];
  return top ? { token: top.token, at: top.at, files: top.files.map((f) => f.path) } : null;
}

export async function GET() {
  await ensureWorkspace();
  const files = await shippedFiles();
  const entries = await Promise.all(files.map(async (rel) => {
    const shipped = await fs.readFile(path.join(templateRoot, rel), "utf8");
    let current: string | null = null;
    try { current = await fs.readFile(await destination(rel), "utf8"); } catch { /* missing or unsafe link: expose status only */ }
    const core = rel === "system/SYSTEM.md" || rel === "system/AGENTS.md";
    return { path: rel, name: core ? path.basename(rel) : rel.slice("system/skills/".length), group: core ? "core" : "skills", modified: current !== shipped, missing: current === null };
  }));
  return Response.json({ entries, undo: await latestSnapshot() });
}

export async function POST(req: NextRequest) {
  await ensureWorkspace();
  const body = await req.json().catch(() => ({})) as { path?: unknown; all?: unknown; undo?: unknown };
  const shipped = await shippedFiles();

  if (typeof body.undo === "string") {
    if (!/^[\w-]{1,40}$/.test(body.undo)) return Response.json({ error: "Invalid rollback id." }, { status: 400 });
    const rootRel = `${backupRel}/${body.undo}`;
    try {
      await safeDir(backupRel);
      const root = path.resolve(WS, rootRel);
      const rootStat = await fs.lstat(root).catch(() => null);
      if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Rollback record was not found");
      const snapshot = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as Snapshot;
      if (snapshot.token !== body.undo || !Array.isArray(snapshot.files)) throw new Error("Rollback record is invalid");
      const restored: string[] = [], errors: { path: string; error: string }[] = [];
      for (const item of snapshot.files) {
        if (!shipped.includes(item.path)) { errors.push({ path: item.path, error: "No longer a shipped prompt file" }); continue; }
        try {
          const dest = await destination(item.path);
          if (item.existed) {
            if (!item.backup || !item.backup.startsWith(rootRel + "/")) throw new Error("Backup file is missing");
            const saved = path.resolve(WS, item.backup);
            if (!inside(path.resolve(WS, rootRel), saved)) throw new Error("Invalid backup path");
            await fs.writeFile(dest, await fs.readFile(saved));
          } else await fs.rm(dest, { force: true });
          restored.push(item.path);
        } catch (e) { errors.push({ path: item.path, error: e instanceof Error ? e.message : String(e) }); }
      }
      const remaining = snapshot.files.filter((item) => !restored.includes(item.path));
      if (remaining.length) await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify({ ...snapshot, files: remaining }, null, 2));
      else await fs.rm(root, { recursive: true, force: true });
      return Response.json({ ok: errors.length === 0, restored, errors, undoToken: remaining.length ? body.undo : null });
    } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
  }

  let targets: string[];
  if (body.all === true) targets = shipped;
  else if (typeof body.path === "string" && shipped.includes(body.path)) targets = [body.path];
  else return Response.json({ error: "Choose a shipped prompt or skill file to restore." }, { status: 400 });

  const token = nanoid(12);
  const rootRel = `${backupRel}/${token}`;
  const snapshot: Snapshot = { token, at: new Date().toISOString(), files: [] };
  const restored: string[] = [], errors: { path: string; error: string }[] = [];
  try {
    await safeDir(rootRel);
    for (const rel of targets) {
      try {
        const dest = await destination(rel);
        let previous: Buffer | null;
        try { previous = await fs.readFile(dest); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") previous = null; else throw e; }
        let backup: string | undefined;
        if (previous !== null) {
          backup = `${rootRel}/${rel.slice("system/".length)}`;
          const backupAbs = path.resolve(WS, backup);
          if (!inside(path.resolve(WS, rootRel), backupAbs)) throw new Error("Invalid backup destination");
          await fs.mkdir(path.dirname(backupAbs), { recursive: true });
          await fs.writeFile(backupAbs, previous);
        }
        snapshot.files.push({ path: rel, existed: previous !== null, ...(backup ? { backup } : {}) });
      } catch (e) { errors.push({ path: rel, error: e instanceof Error ? e.message : String(e) }); }
    }
    if (snapshot.files.length) await fs.writeFile(path.join(WS, rootRel, "manifest.json"), JSON.stringify(snapshot, null, 2));
    for (const rel of targets) {
      if (errors.some((e) => e.path === rel)) continue;
      try { await fs.writeFile(await destination(rel), await fs.readFile(path.join(templateRoot, rel))); restored.push(rel); }
      catch (e) { errors.push({ path: rel, error: e instanceof Error ? e.message : String(e) }); }
    }
    if (!snapshot.files.length) await fs.rm(path.join(WS, rootRel), { recursive: true, force: true });
    return Response.json({ ok: errors.length === 0, restored, errors, undoToken: snapshot.files.length ? token : null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
