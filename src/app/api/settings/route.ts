import { NextRequest } from "next/server";
import { getSettings, saveSettings, mask, PRESETS, hostLocked } from "@/lib/settings";
import { hasBwrap, soffice } from "@/lib/exec";
import { HOME, WS } from "@/lib/workspace";

export const dynamic = "force-dynamic";
const caps = () => ({ bwrap: hasBwrap(), soffice: !!soffice(), home: HOME, workspace: WS, platform: process.platform, locked: hostLocked() });
const presets = (dev: boolean) => (dev ? { ...PRESETS, mock: { baseUrl: `http://127.0.0.1:${process.env.PORT || 3000}/api/dev/mock/v1`, model: "mock", contextTokens: 16000 } } : PRESETS);
export async function GET() { const st = await getSettings(); return Response.json({ settings: mask(st), presets: presets(st.dev), caps: caps() }); }
export async function PUT(req: NextRequest) {
  const b = await req.json();
  const cur = await getSettings();
  for (const k of ["apiKey", "firecrawlKey"] as const) if (typeof b[k] === "string" && b[k].startsWith("••••")) delete b[k];
  if (b.secrets) b.secrets = { ...cur.secrets, ...Object.fromEntries(Object.entries(b.secrets as Record<string, string>).filter(([, v]) => v !== "••••")) };
  return Response.json({ settings: mask(await saveSettings(b)) });
}
