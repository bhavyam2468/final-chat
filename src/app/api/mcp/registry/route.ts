import { NextRequest } from "next/server";
import { registrySearch } from "@/lib/market";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  try {
    return Response.json(await registrySearch(q));
  } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
}
