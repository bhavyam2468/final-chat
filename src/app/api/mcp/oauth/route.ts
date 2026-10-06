import { NextRequest } from "next/server";
import { readServers, dropMcpPool, expandCfg } from "@/lib/mcp";
import { startOAuth, finishOAuth, forgetTokens, authStatus } from "@/lib/mcp-auth";
import { getSettings } from "@/lib/settings";
import { varsFor, varsIn } from "@/lib/credentials";

import { originOf } from "@/lib/origin";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await authStatus());
}

/**
 * Sign-in for a remote MCP server, no API key.
 * {name} → starts OAuth (discovery + dynamic registration + PKCE) and returns the URL to open, or {connected:true}.
 * {name, code} → finishes with a code the user pasted (for when the browser cannot reach this app).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "");
  const raw = (await readServers())[name];
  if (!name || !raw?.url) return Response.json({ error: "unknown server" }, { status: 404 });
  const cfg = expandCfg(raw, varsFor(await getSettings(), varsIn(raw)));
  try {
    if (body?.code) {
      await finishOAuth(name, cfg, String(body.code).trim(), originOf(req));
      dropMcpPool();
      return Response.json({ ok: true, connected: true });
    }
    const r = await startOAuth(name, cfg, originOf(req));
    if (r.connected) dropMcpPool();
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 400 });
  }
}

/** Sign out: tokens for one server (or all when no name). */
export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  await forgetTokens(name || "__all__");
  if (!name) for (const n of Object.keys(await readServers())) await forgetTokens(n);
  dropMcpPool();
  return Response.json({ ok: true });
}
