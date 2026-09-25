import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { WS, ensureWorkspace, mimeOf } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  await ensureWorkspace();
  const form = await req.formData();
  const dir = String(form.get("dir") || "uploads").replace(/\.\./g, "");
  const out = [];
  for (const f of form.getAll("files")) {
    if (typeof f === "string") continue;
    const ext = path.extname(f.name), base = path.basename(f.name, ext).replace(/[^\w.\- ]/g, "_");
    let name = base + ext, i = 1;
    while (await fs.access(path.join(WS, dir, name)).then(() => true, () => false)) name = `${base}-${i++}${ext}`;
    await fs.mkdir(path.join(WS, dir), { recursive: true });
    await fs.writeFile(path.join(WS, dir, name), Buffer.from(await f.arrayBuffer()));
    out.push({ path: `${dir}/${name}`, name, mime: f.type || mimeOf(name), size: f.size });
  }
  return Response.json(out);
}
