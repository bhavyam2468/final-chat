import { NextRequest } from "next/server";
import { getSettings, saveSettings, mask, PRESETS } from "@/lib/settings";

export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ settings: mask(await getSettings()), presets: PRESETS }); }
export async function PUT(req: NextRequest) {
  const b = await req.json();
  const cur = await getSettings();
  for (const k of ["apiKey", "firecrawlKey"] as const) if (typeof b[k] === "string" && b[k].startsWith("••••")) delete b[k];
  if (b.secrets) b.secrets = { ...cur.secrets, ...Object.fromEntries(Object.entries(b.secrets as Record<string, string>).filter(([, v]) => v !== "••••")) };
  return Response.json({ settings: mask(await saveSettings(b)) });
}
