import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { execFile } from "child_process";

export const WS = path.resolve(process.env.WORKSPACE_DIR || "./workspace");
const TEMPLATE = path.resolve("./workspace-template");

let seeded = false;
async function copyDir(src: string, dst: string) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (!fss.existsSync(d)) await fs.copyFile(s, d);
  }
}
export async function ensureWorkspace() {
  if (seeded) return;
  await fs.mkdir(WS, { recursive: true });
  if (fss.existsSync(TEMPLATE)) await copyDir(TEMPLATE, WS);
  seeded = true;
}

export function resolvePath(p: string, full = false): string {
  const clean = (p || ".").replace(/^@/, "");
  if (full && path.isAbsolute(clean)) return path.resolve(clean);
  if (full && clean.startsWith("~")) return path.join(process.env.HOME || "/", clean.slice(1));
  const abs = path.resolve(WS, clean.replace(/^\/+/, ""));
  if (abs !== WS && !abs.startsWith(WS + path.sep)) throw new Error("Path escapes workspace: " + p);
  return abs;
}
export const rel = (abs: string) => path.relative(WS, abs) || ".";

const SKIP = new Set([".git", "node_modules", ".venv", "__pycache__", ".chroma", ".keep", ".DS_Store"]);

export type Node = { name: string; path: string; dir: boolean; size?: number; children?: Node[] };
export async function tree(dir = WS, depth = 4): Promise<Node[]> {
  const out: Node[] = [];
  let entries: fss.Dirent[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push({ name: e.name, path: rel(abs), dir: true, children: depth > 0 ? await tree(abs, depth - 1) : [] });
    else { const st = await fs.stat(abs).catch(() => null); out.push({ name: e.name, path: rel(abs), dir: false, size: st?.size }); }
  }
  return out;
}

/** Compact tree text for the prompt. Skills internals collapsed. */
export async function treeText(limit = 160): Promise<string> {
  const lines: string[] = [];
  const walk = (nodes: Node[], ind: string) => {
    for (const n of nodes) {
      if (lines.length >= limit) return;
      if (n.dir && (n.path === "system/skills" || n.path === "system/mcp")) { lines.push(`${ind}${n.name}/ (…)`); continue; }
      lines.push(`${ind}${n.name}${n.dir ? "/" : ""}`);
      if (n.children) walk(n.children, ind + " ");
    }
  };
  walk(await tree(WS, 3), "");
  if (lines.length >= limit) lines.push("… (truncated; use fs_list)");
  return lines.join("\n");
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf", html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", json: "application/json",
  md: "text/markdown", txt: "text/plain", csv: "text/csv", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const mimeOf = (p: string) => MIME[path.extname(p).slice(1).toLowerCase()] || "application/octet-stream";
export const isImage = (p: string) => mimeOf(p).startsWith("image/") && !p.endsWith(".svg");

function py(code: string, arg: string): Promise<string> {
  return new Promise((res) => execFile("python3", ["-c", code, arg], { timeout: 60000, maxBuffer: 20e6 }, (e, out) => res(e ? "" : out)));
}

/** Extract readable text from any file for context. */
export async function readText(abs: string, max = 60000): Promise<string> {
  const ext = path.extname(abs).slice(1).toLowerCase();
  let text = "";
  if (ext === "pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(await fs.readFile(abs)));
      const r = await extractText(doc, { mergePages: false });
      text = (r.text as string[]).map((t, i) => `[page ${i + 1}]\n${t}`).join("\n\n");
    } catch (e) { text = "(pdf extraction failed: " + String(e) + ")"; }
  } else if (ext === "docx") {
    text = await py("import sys,docx;print('\\n'.join(p.text for p in docx.Document(sys.argv[1]).paragraphs))", abs);
  } else if (ext === "pptx") {
    text = await py("import sys\nfrom pptx import Presentation\nfor i,s in enumerate(Presentation(sys.argv[1]).slides):\n print(f'[slide {i+1}]')\n for sh in s.shapes:\n  if sh.has_text_frame: print(sh.text_frame.text)", abs);
  } else if (ext === "xlsx" || ext === "xls") {
    text = await py("import sys,pandas as pd\nfor n,d in pd.read_excel(sys.argv[1],sheet_name=None).items():\n print(f'[sheet {n}] shape={d.shape}');print(d.head(60).to_csv(index=False))", abs);
  } else if (isImage(abs)) {
    text = "(image; attached visually)";
  } else {
    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return "(binary file)";
    text = buf.toString("utf8");
  }
  return text.length > max ? text.slice(0, max) + `\n… (truncated ${text.length - max} chars; use fs_read ranges)` : text;
}
