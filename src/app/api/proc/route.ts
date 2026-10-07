import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";
import { procList, procLogOf, procRestart, procStop } from "@/lib/procs";

export const dynamic = "force-dynamic";

/** GET — process list for the input-bar strip; ?name= for one process's log (the terminal canvas polls this). */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (name) return Response.json(procLogOf(name));
  return Response.json({ procs: procList() });
}

/** POST — stop or restart a process from the UI. */
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { name: string; action?: "stop" | "restart"; signal?: string };
  if (!b.name) return Response.json({ error: "name required" }, { status: 400 });
  const st = await getSettings();
  if (b.action === "restart") return Response.json(await procRestart(st, b.name));
  return Response.json(await procStop(b.name, (b.signal as "SIGTERM") || "SIGTERM"));
}
