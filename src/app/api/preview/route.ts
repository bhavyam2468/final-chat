/* Structured previews for canvas viewers: spreadsheets, documents, slides, archives (browse without extracting). */
import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { resolvePath, rel, WS, mimeOf, ensureWorkspace, isImage, readText, PY } from "@/lib/workspace";
import { getSettings } from "@/lib/settings";
import { runRaw, soffice } from "@/lib/exec";

export const dynamic = "force-dynamic";
const ext = (p: string) => path.extname(p).slice(1).toLowerCase();
const J = (o: unknown, status = 200) => Response.json(o, { status });

async function cacheDir(abs: string, tag: string) {
  const st = await fs.stat(abs);
  const h = crypto.createHash("sha1").update(abs + st.mtimeMs + tag).digest("hex").slice(0, 16);
  const dir = path.join(WS, ".cache/preview", h);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
async function py(code: string, timeout = 60000) {
  const r = await runRaw(PY(), ["-c", code], WS, timeout);
  if (r.code !== 0) throw new Error(r.out.trim().split("\n").slice(-3).join(" ").slice(0, 400));
  return JSON.parse(r.out.trim().split("\n").pop() || "{}");
}
/** Office → PDF through LibreOffice when installed (cached per file version). */
async function toPdf(abs: string): Promise<string | null> {
  const bin = soffice(); if (!bin) return null;
  const dir = await cacheDir(abs, "pdf");
  const out = path.join(dir, path.basename(abs, path.extname(abs)) + ".pdf");
  try { await fs.access(out); return out; } catch {}
  const r = await runRaw(bin, ["--headless", "--convert-to", "pdf", "--outdir", dir, abs], dir, 120000);
  try { await fs.access(out); return out; } catch { console.warn("soffice failed", r.out.slice(0, 300)); return null; }
}

function parseCsv(text: string, sep: string) {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; if (rows.length > 5000) break; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const SHEET_PY = (p: string) => `
import json
P=${JSON.stringify(p)}
out=[]
try:
    import openpyxl
    wb=openpyxl.load_workbook(P, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows=[]; n=0
        for r in ws.iter_rows(values_only=True):
            n+=1
            if n<=3000: rows.append(["" if v is None else (str(int(v)) if isinstance(v,float) and v.is_integer() else str(v)) for v in r[:80]])
        w=max([max([i+1 for i,c in enumerate(r) if c!=""] or [0]) for r in rows] or [0])
        rows=[r[:w] for r in rows]
        while rows and not any(rows[-1]): rows.pop()
        out.append({"name":ws.title,"rows":rows,"total":n})
except Exception:
    import pandas as pd
    for name,df in pd.read_excel(P, sheet_name=None, header=None).items():
        df=df.fillna("")
        out.append({"name":str(name),"rows":[[str(c) for c in r] for r in df.head(3000).values.tolist()],"total":len(df)})
print(json.dumps({"sheets":out}))`;

const SLIDES_PY = (p: string, dir: string) => `
import json, os
from pptx import Presentation
P=${JSON.stringify(p)}; D=${JSON.stringify(dir)}
prs=Presentation(P); W=prs.slide_width or 12192000; H=prs.slide_height or 6858000
def box(sh):
    try: return [round((sh.left or 0)/W*100,2), round((sh.top or 0)/H*100,2), round((sh.width or 0)/W*100,2), round((sh.height or 0)/H*100,2)]
    except Exception: return [0,0,100,10]
def walk(shapes, out, k):
    for sh in shapes:
        try:
            if sh.shape_type==6 and hasattr(sh,"shapes"): walk(sh.shapes, out, k); continue
            if hasattr(sh,"image"):
                k[0]+=1; fn=f"s{k[1]}_{k[0]}.{sh.image.ext}"
                open(os.path.join(D,fn),"wb").write(sh.image.blob)
                out.append({"t":"img","b":box(sh),"src":fn}); continue
            if getattr(sh,"has_table",False) and sh.has_table:
                out.append({"t":"table","b":box(sh),"rows":[[c.text for c in r.cells] for r in sh.table.rows]}); continue
            if getattr(sh,"has_text_frame",False) and sh.has_text_frame and sh.text_frame.text.strip():
                ps=[]
                for para in sh.text_frame.paragraphs:
                    t="".join(r.text for r in para.runs) or para.text
                    sz=None; b=False
                    for r in para.runs:
                        if r.font.size: sz=r.font.size.pt
                        if r.font.bold: b=True
                    ps.append({"t":t,"l":para.level,"s":sz,"b":b})
                ph=None
                try: ph=str(sh.placeholder_format.type).split(".")[-1].split(" ")[0] if sh.is_placeholder else None
                except Exception: pass
                out.append({"t":"text","b":box(sh),"p":ps,"ph":ph})
        except Exception: pass
slides=[]
for i,s in enumerate(prs.slides):
    items=[]; walk(s.shapes, items, [0,i+1])
    notes=""
    try:
        if s.has_notes_slide: notes=s.notes_slide.notes_text_frame.text
    except Exception: pass
    slides.append({"items":items,"notes":notes})
print(json.dumps({"ratio":W/H,"slides":slides}))`;

const ARCH_PY = (p: string, mode: string, arg: string) => `
import json, zipfile, tarfile, os, base64
P=${JSON.stringify(p)}; M=${JSON.stringify(mode)}; A=${JSON.stringify(arg)}
def safe(dst, name):
    t=os.path.realpath(os.path.join(dst, name)); r=os.path.realpath(dst)
    if not (t==r or t.startswith(r+os.sep)): raise Exception("unsafe path "+name)
if zipfile.is_zipfile(P):
    z=zipfile.ZipFile(P)
    if M=="list":
        print(json.dumps({"type":"zip","entries":[{"name":i.filename,"size":i.file_size,"packed":i.compress_size,"dir":i.is_dir(),"date":"%04d-%02d-%02d"%i.date_time[:3]} for i in z.infolist()[:20000]]}))
    elif M=="entry":
        d=z.read(A)[:8000000]; print(json.dumps({"b64":base64.b64encode(d).decode()}))
    else:
        o=json.loads(A); dst=o["to"]; names=o["entries"] or z.namelist()
        for n in names: safe(dst,n)
        for n in names: z.extract(n,dst)
        print(json.dumps({"n":len(names)}))
else:
    t=tarfile.open(P)
    if M=="list":
        print(json.dumps({"type":"tar","entries":[{"name":m.name+("/" if m.isdir() else ""),"size":m.size,"dir":m.isdir()} for m in t.getmembers()[:20000]]}))
    elif M=="entry":
        f=t.extractfile(A); d=f.read(8000000) if f else b""; print(json.dumps({"b64":base64.b64encode(d).decode()}))
    else:
        o=json.loads(A); dst=o["to"]; want=set(o["entries"] or [])
        ms=[m for m in t.getmembers() if (not want or m.name in want or m.name+"/" in want) and not m.issym() and not m.islnk()]
        for m in ms: safe(dst,m.name)
        t.extractall(dst, members=ms); print(json.dumps({"n":len(ms)}))`;

export async function GET(req: NextRequest) {
  await ensureWorkspace();
  const q = req.nextUrl.searchParams;
  const p = q.get("path") || "";
  const as = q.get("as") || "";
  let abs: string;
  try { abs = resolvePath(p, (await getSettings()).access); await fs.access(abs); } catch { return J({ error: "Not found: " + p }, 404); }
  const e = ext(abs);
  try {
    if (as === "card") {
      // compact summary for inline file cards in chat
      const st = await fs.stat(abs);
      const base = { name: path.basename(abs), size: st.size, dir: st.isDirectory(), mime: mimeOf(abs) };
      if (st.isDirectory()) return J({ ...base, kind: "dir", excerpt: (await fs.readdir(abs)).slice(0, 12).join("\n") });
      if (isImage(abs) || e === "svg") return J({ ...base, kind: "image" });
      if (["zip", "tar", "tgz", "gz", "jar", "bz2", "xz"].includes(e)) { const j = await py(ARCH_PY(abs, "list", ""), 30000).catch(() => ({ entries: [] })); const names = (j.entries || []).map((x: { name: string }) => x.name); return J({ ...base, kind: "archive", count: names.length, excerpt: names.slice(0, 8).join("\n") }); }
      if (["csv", "tsv"].includes(e)) { const rows = parseCsv((await fs.readFile(abs, "utf8")).slice(0, 200000), e === "tsv" ? "\t" : ","); return J({ ...base, kind: "sheet", rows: rows.slice(0, 6), total: rows.length }); }
      if (["html", "htm", "ui"].includes(e)) return J({ ...base, kind: "page" });
      if (["mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"].includes(e)) return J({ ...base, kind: "media" });
      const text = await readText(abs, 1200);
      const pages = e === "pdf" ? (text.match(/\[page \d+\]/g) || []).length : undefined;
      return J({ ...base, kind: ["pdf", "docx", "doc", "odt", "rtf"].includes(e) ? "doc" : ["pptx", "ppt", "odp"].includes(e) ? "slides" : ["xlsx", "xls", "ods"].includes(e) ? "sheet" : "text", pages, excerpt: text.replace(/\[page \d+\]\n?/g, "").slice(0, 600) });
    }
    if (as === "sheet") {
      if (["csv", "tsv"].includes(e)) {
        const text = (await fs.readFile(abs, "utf8")).slice(0, 8_000_000);
        const head = text.split("\n")[0];
        const sep = e === "tsv" ? "\t" : (head.match(/;/g)?.length || 0) > (head.match(/,/g)?.length || 0) ? ";" : ",";
        const rows = parseCsv(text, sep);
        return J({ sheets: [{ name: path.basename(abs), rows: rows.slice(0, 3000), total: rows.length }] });
      }
      return J(await py(SHEET_PY(abs)));
    }
    if (as === "doc") {
      if (e === "docx") {
        const mammoth = (await import("mammoth")).default;
        const r = await mammoth.convertToHtml({ path: abs });
        return J({ html: r.value });
      }
      const pdf = await toPdf(abs);
      return pdf ? J({ pdf: rel(pdf) }) : J({ error: "Install LibreOffice to preview ." + e }, 415);
    }
    if (as === "slides") {
      const pdf = await toPdf(abs);
      if (pdf) return J({ pdf: rel(pdf) });
      if (e !== "pptx") return J({ error: "Install LibreOffice to preview ." + e }, 415);
      const dir = await cacheDir(abs, "slides");
      const j = await py(SLIDES_PY(abs, dir), 90000);
      const base = rel(dir);
      for (const s of j.slides) for (const it of s.items) if (it.t === "img") it.src = base + "/" + it.src;
      return J(j);
    }
    if (as === "pdf") { const pdf = await toPdf(abs); return pdf ? J({ pdf: rel(pdf) }) : J({ error: "LibreOffice not installed" }, 415); }
    if (as === "archive") return J(await py(ARCH_PY(abs, "list", ""), 60000));
    if (as === "entry") {
      const name = q.get("entry") || "";
      const j = await py(ARCH_PY(abs, "entry", name), 60000);
      return new Response(new Uint8Array(Buffer.from(j.b64, "base64")), { headers: { "Content-Type": mimeOf(name), "Cache-Control": "no-store" } });
    }
    return J({ error: "unknown preview" }, 400);
  } catch (err) {
    return J({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** Extract an archive (all or selected entries) next to it or into `to`. */
export async function POST(req: NextRequest) {
  const { path: p, to, entries } = await req.json();
  const access = (await getSettings()).access;
  try {
    const abs = resolvePath(p, access);
    const dst = resolvePath(to || String(p).replace(/\.(zip|tar|tgz|tar\.gz|tar\.bz2|tar\.xz|jar)$/i, ""), access);
    await fs.mkdir(dst, { recursive: true });
    const j = await py(ARCH_PY(abs, "extract", JSON.stringify({ to: dst, entries: entries || [] })), 300000);
    return J({ ok: true, n: j.n, dir: rel(dst) });
  } catch (err) { return J({ error: err instanceof Error ? err.message : String(err) }, 500); }
}
