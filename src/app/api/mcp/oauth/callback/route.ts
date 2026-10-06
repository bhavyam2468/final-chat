import { NextRequest } from "next/server";
import { readServers } from "@/lib/mcp";
import { stateFor, finishOAuth, authError } from "@/lib/mcp-auth";
import { originOf } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * OAuth redirect target. The browser lands here after the user approves, so we exchange the code and
 * send them back into the app with a status the Extensions panel can show.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const code = q.get("code");
  const state = q.get("state");
  const denied = q.get("error_description") || q.get("error");
  const servers = await readServers();

  let name = "";
  for (const n of Object.keys(servers)) if (state && (await stateFor(n)) === state) { name = n; break; }
  if (!name) return Response.redirect(`${originOf(req)}/?mcp_error=${encodeURIComponent("Sign-in callback did not match a server. Start again from Extensions.")}`, 302);
  if (denied || !code) {
    const msg = denied ? String(denied) : "No authorization code came back.";
    await authError(name, msg);
    return Response.redirect(`${originOf(req)}/?mcp_error=${encodeURIComponent(msg)}&mcp=${encodeURIComponent(name)}`, 302);
  }
  try {
    await finishOAuth(name, servers[name], code, originOf(req));
    return Response.redirect(`${originOf(req)}/?mcp=${encodeURIComponent(name)}&connected=1`, 302);
  } catch (e) {
    const msg = String((e as Error).message || e);
    await authError(name, msg);
    return Response.redirect(`${originOf(req)}/?mcp_error=${encodeURIComponent(msg)}&mcp=${encodeURIComponent(name)}`, 302);
  }
}
