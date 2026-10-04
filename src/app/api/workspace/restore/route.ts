import { NextRequest } from "next/server";
import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { WS, ensureWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const TEMPLATE = path.resolve("./workspace-template");

export type RollbackScope = "all" | "system" | "agents" | "memory" | "skills" | "mcp";

export async function rollbackDefaults(scope: RollbackScope): Promise<{ restored: string[]; error?: string }> {
  await ensureWorkspace();
  const restored: string[] = [];

  const copyFile = async (relPath: string) => {
    const src = path.join(TEMPLATE, relPath);
    const dst = path.join(WS, relPath);
    if (!fss.existsSync(src)) return false;
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    restored.push(relPath);
    return true;
  };

  const copyDir = async (srcDir: string, dstDir: string, baseRel = "") => {
    await fs.mkdir(dstDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const e of entries) {
      const src = path.join(srcDir, e.name);
      const dst = path.join(dstDir, e.name);
      const rel = path.join(baseRel, e.name);
      if (e.isDirectory()) {
        await copyDir(src, dst, rel);
      } else {
        await fs.copyFile(src, dst);
        restored.push(rel);
      }
    }
  };

  try {
    if (scope === "all" || scope === "system") {
      await copyFile("system/SYSTEM.md");
    }
    if (scope === "all" || scope === "agents") {
      await copyFile("system/AGENTS.md");
    }
    if (scope === "all" || scope === "memory") {
      const memDir = path.join(WS, "system/memory");
      await fs.mkdir(memDir, { recursive: true });
      await fs.writeFile(path.join(memDir, "profile.md"), "# Profile\n");
      await fs.writeFile(path.join(memDir, "episodes.jsonl"), "");
      restored.push("system/memory/profile.md", "system/memory/episodes.jsonl");
    }
    if (scope === "all" || scope === "mcp") {
      await copyFile("system/mcp/servers.json");
    }
    if (scope === "all" || scope === "skills") {
      const srcSkills = path.join(TEMPLATE, "system/skills");
      const dstSkills = path.join(WS, "system/skills");
      if (fss.existsSync(srcSkills)) {
        await copyDir(srcSkills, dstSkills, "system/skills");
      }
    }
    return { restored };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { restored, error: msg };
  }
}

export async function GET() {
  await ensureWorkspace();
  return Response.json({
    scopes: [
      { id: "all", label: "Rollback All Defaults", hint: "Restore system prompt, agents, memory, skills & MCP configs to pristine" },
      { id: "system", label: "Rollback SYSTEM.md", hint: "Restore default core system prompt and capabilities" },
      { id: "agents", label: "Rollback AGENTS.md", hint: "Restore default agent memory instructions" },
      { id: "memory", label: "Reset Memory", hint: "Clear remembered user profile facts and episodic memories" },
      { id: "skills", label: "Rollback Skills", hint: "Restore built-in skills to their pristine template files" },
      { id: "mcp", label: "Rollback MCP Servers", hint: "Reset system/mcp/servers.json to defaults" },
    ],
  });
}

export async function POST(req: NextRequest) {
  try {
    const { scope = "all" } = await req.json();
    const result = await rollbackDefaults(scope as RollbackScope);
    if (result.error) {
      return Response.json({ error: result.error, restored: result.restored }, { status: 500 });
    }
    return Response.json({ ok: true, scope, restored: result.restored });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 400 });
  }
}
