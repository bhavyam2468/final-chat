import { NextRequest } from "next/server";
import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { WS, ensureWorkspace } from "@/lib/workspace";
import { listSkills, installFromGitHub } from "@/lib/skills";

export const dynamic = "force-dynamic";
const TEMPLATE = path.resolve("./workspace-template/system/skills");

/** All skills from system/skills plus .agents/skills and .claude/skills (where `npx skills add` installs). */
export async function GET() {
  await ensureWorkspace();
  const list = await listSkills();
  return Response.json(list.map((s) => ({
    name: s.name, description: s.description, tools: s.tools, requires: s.requires, root: s.root,
    builtin: s.root === "system/skills" && fss.existsSync(path.join(TEMPLATE, s.name)),
    source: fss.existsSync(path.join(s.dir, ".source")) ? fss.readFileSync(path.join(s.dir, ".source"), "utf8").trim() : "",
  })));
}

/**
 * Install. {source: "owner/repo" | "owner/repo/path" | github URL, pick?: string[]} or {name, content}.
 * A repo with several skills and no pick returns {installed: [], available} so the UI can ask which ones.
 */
export async function POST(req: NextRequest) {
  await ensureWorkspace();
  const { source, pick, name, content } = await req.json();
  try {
    if (source) return Response.json({ ok: true, ...(await installFromGitHub(String(source), Array.isArray(pick) ? pick : undefined)) });
    if (!name || !content) return Response.json({ error: "source, or name and content, required" }, { status: 400 });
    const safe = String(name).replace(/[^\w.-]/g, "-");
    await fs.mkdir(path.join(WS, "system/skills", safe), { recursive: true });
    await fs.writeFile(path.join(WS, "system/skills", safe, "SKILL.md"), String(content));
    return Response.json({ ok: true, installed: [safe], available: [safe] });
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 400 });
  }
}

/** Remove an installed skill. Built-in skills can't be removed (they would be re-seeded). */
export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") || "";
  const s = (await listSkills()).find((x) => x.name === name);
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  if (s.root === "system/skills" && fss.existsSync(path.join(TEMPLATE, s.name))) return Response.json({ error: "built-in skill" }, { status: 400 });
  await fs.rm(s.dir, { recursive: true, force: true });
  return Response.json({ ok: true });
}
