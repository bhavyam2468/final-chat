import { renderTikz } from "@/lib/tikz";

export const runtime = "nodejs";
const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" }; // Blocks frames are sandboxed (null origin)

/** POST raw TikZ (text/plain, so sandboxed frames need no preflight) → { svg } | { error } */
export async function POST(req: Request) {
  const src = (await req.text()).slice(0, 60_000);
  if (!src.trim()) return new Response(JSON.stringify({ error: "empty source" }), { status: 400, headers: CORS });
  const r = await renderTikz(src);
  return new Response(JSON.stringify(r), { status: r.svg ? 200 : 422, headers: CORS });
}
