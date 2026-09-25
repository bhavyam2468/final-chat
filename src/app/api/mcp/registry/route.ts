import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  try {
    const r = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=20`);
    const j = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (j.servers || []).map((x: any) => { const s = x.server || x; const pkg = s.packages?.[0]; const remote = s.remotes?.[0];
      return { name: s.name, description: s.description, pkg: pkg ? { registry: pkg.registryType || pkg.registry_name, id: pkg.identifier || pkg.name } : null, url: remote?.url || null }; });
    return Response.json(items);
  } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
}
