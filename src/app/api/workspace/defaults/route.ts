import fs from "fs/promises";
import path from "path";
import { ensureWorkspace, WS } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const TEMPLATE_ROOT = path.resolve("./workspace-template");
const inside = (candidate: string, root: string) => candidate === root || candidate.startsWith(root + path.sep);

type DefaultFile = { path: string; label: string };

function labelFor(rel: string) {
  if (rel === "README.md") return "Workspace guide · README.md";
  if (rel === "system/SYSTEM.md") return "System prompt · SYSTEM.md";
  if (rel === "system/AGENTS.md") return "Agent instructions · AGENTS.md";
  if (rel === "system/memory/profile.md") return "Profile memory";
  if (rel === "system/memory/episodes.jsonl") return "Episode memory";
  if (rel === "system/mcp/servers.json") return "MCP server settings";
  if (rel.startsWith("system/skills/")) {
    const parts = rel.split("/");
    const skill = parts[2] || "skill";
    return parts.length === 4 ? `Skill · ${skill}` : `Skill reference · ${skill} · ${parts.at(-1)}`;
  }
  return `System file · ${path.posix.basename(rel)}`;
}

async function listDefaults(): Promise<DefaultFile[]> {
  const files: DefaultFile[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".template.json" || entry.name === ".pristine.json" || entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) {
        const rel = path.relative(TEMPLATE_ROOT, abs).split(path.sep).join("/");
        files.push({ path: rel, label: labelFor(rel) });
      }
    }
  };
  await walk(TEMPLATE_ROOT);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function rejectSymlinkPath(target: string) {
  let cursor = WS;
  const rel = path.relative(WS, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Invalid restore destination.");
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    const st = await fs.lstat(cursor).catch((e: NodeJS.ErrnoException) => e.code === "ENOENT" ? null : Promise.reject(e));
    if (st?.isSymbolicLink()) throw new Error(`Refusing to restore through a symbolic link: ${path.relative(WS, cursor)}`);
  }
}

export async function GET() {
  try {
    await ensureWorkspace();
    return Response.json({ defaults: await listDefaults() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureWorkspace();
    const body = await req.json().catch(() => null) as { all?: boolean; paths?: unknown } | null;
    const defaults = await listDefaults();
    let selected: DefaultFile[];
    if (body?.all === true) selected = defaults;
    else if (Array.isArray(body?.paths) && body.paths.length) {
      const allowed = new Map(defaults.map((d) => [d.path, d]));
      const paths = [...new Set(body.paths)];
      if (paths.some((p) => typeof p !== "string" || !allowed.has(p))) return Response.json({ error: "Choose a shipped default file from the list." }, { status: 400 });
      selected = (paths as string[]).map((p) => allowed.get(p)!);
    } else return Response.json({ error: "Choose one default file or restore all defaults." }, { status: 400 });

    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    const plan = [] as { entry: DefaultFile; source: string; target: string; content: Buffer; current: Buffer | null; mode: number }[];
    for (const entry of selected) {
      const source = path.resolve(TEMPLATE_ROOT, entry.path);
      const target = path.resolve(WS, entry.path);
      if (!inside(source, TEMPLATE_ROOT) || !inside(target, WS)) throw new Error("Invalid restore path.");
      await rejectSymlinkPath(target);
      const st = await fs.stat(source);
      const currentStat = await fs.lstat(target).catch((e: NodeJS.ErrnoException) => e.code === "ENOENT" ? null : Promise.reject(e));
      if (currentStat?.isDirectory()) throw new Error(`${entry.path} is a directory; it was not changed.`);
      const [content, current] = await Promise.all([
        fs.readFile(source),
        currentStat ? fs.readFile(target) : Promise.resolve(null),
      ]);
      plan.push({ entry, source, target, content, current, mode: st.mode & 0o777 });
    }

    const changed = plan.filter((p) => !p.current?.equals(p.content));
    const backups: { path: string; backupPath: string }[] = [];
    const committed: typeof plan = [];
    try {
      for (const item of changed) {
        if (item.current) {
          const backup = path.join(WS, ".trash", "defaults", runId, item.entry.path);
          await rejectSymlinkPath(backup);
          await fs.mkdir(path.dirname(backup), { recursive: true });
          await fs.copyFile(item.target, backup);
          backups.push({ path: item.entry.path, backupPath: path.relative(WS, backup).split(path.sep).join("/") });
        }
        await fs.mkdir(path.dirname(item.target), { recursive: true });
        const temp = `${item.target}.restore-${runId}`;
        await fs.writeFile(temp, item.content, { mode: item.mode });
        await fs.rename(temp, item.target);
        committed.push(item);
      }
    } catch (e) {
      for (const item of committed.reverse()) {
        const backup = backups.find((b) => b.path === item.entry.path);
        if (backup) await fs.copyFile(path.join(WS, backup.backupPath), item.target).catch(() => {});
        else await fs.rm(item.target, { force: true }).catch(() => {});
      }
      throw e;
    }
    return Response.json({
      ok: true,
      restored: changed.map((p) => p.entry.path),
      unchanged: plan.length - changed.length,
      backups,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
