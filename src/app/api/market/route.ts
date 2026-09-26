import { NextRequest } from "next/server";
import { spawnSync } from "child_process";
import { MCP_CATALOG, SKILL_REPOS, BUILTIN, overlapOf } from "@/lib/market";
import { readServers, writeServers } from "@/lib/mcp";
import { credStatus, varsIn, nativeAllowed } from "@/lib/credentials";
import { getSettings } from "@/lib/settings";
import { ensureWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };

/** Catalog + installed servers, each with credential status (where each ${VAR} would come from; never values). */
export async function GET() {
  await ensureWorkspace();
  const st = await getSettings();
  const servers = await readServers();
  const bins: Record<string, boolean> = { uv: has("uvx"), npx: has("npx"), docker: has("docker") };
  return Response.json({
    native: nativeAllowed(st),
    mcp: MCP_CATALOG.map((e) => ({ ...e, installed: !!servers[e.id], enabled: !!servers[e.id]?.enabled, creds: e.creds.map((c) => ({ ...c, source: credStatus(st, [c.name])[c.name] })), missingBin: e.needs && !bins[e.needs] ? e.needs : null })),
    installed: Object.fromEntries(Object.entries(servers).map(([k, c]) => [k, { vars: credStatus(st, varsIn(c)), overlap: overlapOf(k) }])),
    builtin: BUILTIN,
    skills: SKILL_REPOS,
  });
}

/** {id} adds a catalog server (enabled). */
export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const e = MCP_CATALOG.find((x) => x.id === id);
  if (!e) return Response.json({ error: "unknown" }, { status: 404 });
  const servers = await readServers();
  await writeServers({ ...servers, [e.id]: { ...e.config, enabled: true } });
  return Response.json({ ok: true });
}
