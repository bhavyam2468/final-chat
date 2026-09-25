import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { WS, ensureWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
const DIR = () => path.join(WS, "system/skills");

export async function GET() {
  await ensureWorkspace();
  const out = [];
  for (const d of await fs.readdir(DIR()).catch(() => [] as string[])) {
    const t = await fs.readFile(path.join(DIR(), d, "SKILL.md"), "utf8").catch(() => "");
    if (t) out.push({ name: d, description: t.match(/description:\s*(.+)/)?.[1] || "" });
  }
  return Response.json(out);
}
/** Install from GitHub: https://github.com/owner/repo/tree/branch/path/to/skill  or owner/repo/path */
export async function POST(req: NextRequest) {
  const { source, name: nm, content } = await req.json();
  let text = content as string | undefined, name = nm as string | undefined;
  if (!text && source) {
    const m = String(source).replace(/^https?:\/\/github.com\//, "").replace(/\/(tree|blob)\/([^/]+)/, "/$2").replace(/\/SKILL\.md$/, "");
    const parts = m.split("/");
    const [owner, repo] = parts; let branch = "main"; let rest = parts.slice(2);
    if (/github.com/.test(source) && /\/(tree|blob)\//.test(source)) { branch = parts[2]; rest = parts.slice(3); }
    for (const b of [branch, "master"]) {
      const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/${[...rest, "SKILL.md"].join("/")}`);
      if (r.ok) { text = await r.text(); break; }
    }
    if (!text) return Response.json({ error: "SKILL.md not found" }, { status: 404 });
    name = name || text.match(/name:\s*([\w-]+)/)?.[1] || rest[rest.length - 1] || repo;
  }
  if (!text || !name) return Response.json({ error: "name and content or source required" }, { status: 400 });
  const safe = name.replace(/[^\w-]/g, "-");
  await fs.mkdir(path.join(DIR(), safe), { recursive: true });
  await fs.writeFile(path.join(DIR(), safe, "SKILL.md"), text);
  return Response.json({ ok: true, name: safe });
}
