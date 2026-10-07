import { NextRequest } from "next/server";
import { attachRun, runState } from "@/lib/workflows/runner";

export const dynamic = "force-dynamic";

/** One run's window: `?id=` is the snapshot, `?id=&stream=1` replays the state and then stays live. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  if (req.nextUrl.searchParams.has("stream")) {
    const stream = attachRun(id, req.signal);
    if (stream) return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
  }
  const state = await runState(id);
  if (!state) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run: state });
}
