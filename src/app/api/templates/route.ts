import { readTemplate, removeTemplate, saveTemplate, searchTemplates, templateCatalog } from "@/lib/templates";

export const runtime = "nodejs";

/**
 * GET /api/templates            → the library (id, kind, title, description, tags, vars) — never sources
 * GET /api/templates?q=&kind=    → the same, ranked by a search
 * GET /api/templates?id=&var…    → one template, filled in and *verified* (circuits are rendered)
 * POST /api/templates            → save one (the user's shelf; bundled templates are read-only)
 * DELETE /api/templates?id=      → remove one of the user's own
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") || "";
  if (!id) {
    const q = u.searchParams.get("q") || "";
    const kind = u.searchParams.get("kind") || "";
    if (q || kind) return Response.json({ ok: true, templates: await searchTemplates(q, kind, 60) });
    return Response.json({ ok: true, ...(await templateCatalog()) });
  }
  const values: Record<string, string> = {};
  for (const [k, v] of u.searchParams) if (k !== "id" && k !== "q" && k !== "kind") values[k] = v;
  try {
    const t = await readTemplate(id, values);
    return Response.json({ ok: true, ...t });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 404 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const def = await saveTemplate(body as Parameters<typeof saveTemplate>[0]);
    return Response.json({ ok: true, template: { id: def.name, kind: def.kind, title: def.title } });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const r = await removeTemplate(id);
  return Response.json({ ok: r.ok, error: r.error }, { status: r.ok ? 200 : 400 });
}
