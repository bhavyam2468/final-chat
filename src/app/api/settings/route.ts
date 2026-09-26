import { NextRequest } from "next/server";
import { getSettings, saveSettings, mask, PRESETS, hostLocked } from "@/lib/settings";
import { hasBwrap, soffice } from "@/lib/exec";
import { HOME, WS } from "@/lib/workspace";

export const dynamic = "force-dynamic";
const caps = () => ({ bwrap: hasBwrap(), soffice: !!soffice(), home: HOME, workspace: WS, platform: process.platform, locked: hostLocked() });
export async function GET() { return Response.json({ settings: mask(await getSettings()), presets: PRESETS, caps: caps() }); }
export async function PUT(req: NextRequest) {
  const b = await req.json();
  const cur = await getSettings();
  for (const k of ["apiKey", "firecrawlKey"] as const) if (typeof b[k] === "string" && b[k].startsWith("••••")) delete b[k];
  if (b.secrets) b.secrets = { ...cur.secrets, ...Object.fromEntries(Object.entries(b.secrets as Record<string, string>).filter(([, v]) => v !== "••••")) };
  return Response.json({ settings: mask(await saveSettings(b)) });
}
