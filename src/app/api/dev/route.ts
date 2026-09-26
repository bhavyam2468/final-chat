import { NextRequest } from "next/server";
import path from "path";
import { execFile } from "child_process";
import { getSettings, saveSettings } from "@/lib/settings";
import { WS, ensureWorkspace } from "@/lib/workspace";
import { PY } from "@/lib/exec";

export const dynamic = "force-dynamic";

/**
 * Developer mode (hidden from the UI). Console: window.__dev.enable() / .disable() / .samples() / .mock().
 * Enabling adds the "mock" provider (offline scripted model) and allows generating sample files for the viewers.
 */
export async function GET() {
  return Response.json({ dev: (await getSettings()).dev });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.enable === "boolean") {
    if (!b.enable && process.env.DEV_MODE === "1") return Response.json({ dev: true, note: "DEV_MODE=1 is set in the environment" });
    await saveSettings({ dev: b.enable });
    return Response.json({ dev: b.enable });
  }
  const st = await getSettings();
  if (!st.dev) return Response.json({ error: "developer mode is off" }, { status: 403 });
  if (b.samples) {
    await ensureWorkspace();
    const out = path.join(WS, "uploads/samples");
    const r = await new Promise<{ ok: boolean; log: string }>((res) =>
      execFile(PY(), [path.join(process.cwd(), "dev/samples.py"), out], { timeout: 120000 }, (e, so, se) => res({ ok: !e, log: (so + se).slice(-2000) })));
    return Response.json({ ...r, dir: "uploads/samples" }, { status: r.ok ? 200 : 500 });
  }
  if (b.mock) {
    const port = process.env.PORT || "3000";
    const s = await saveSettings({ provider: "mock", baseUrl: `http://127.0.0.1:${port}/api/dev/mock/v1`, model: "mock", contextTokens: 16000 });
    return Response.json({ provider: s.provider });
  }
  return Response.json({ error: "enable | samples | mock" }, { status: 400 });
}
