import fs from "fs/promises";
import fss from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";

export const WS = path.resolve(process.env.WORKSPACE_DIR || "./workspace");
const TEMPLATE = path.resolve("./workspace-template");

let seeded = false;
const sha1 = (b: Buffer) => crypto.createHash("sha1").update(b).digest("hex");
/**
 * Seed the workspace from the template. Files the user never edited are upgraded when the template changes
 * (tracked in system/.template.json; .pristine.json lists hashes of earlier shipped versions); edited files are left alone.
 */
async function copyDir(src: string, dst: string, man: Record<string, string>, pristine: Set<string>, root = src) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (e.name === ".pristine.json") continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name), key = path.relative(root, s);
    if (e.isDirectory()) { await copyDir(s, d, man, pristine, root); continue; }
    const tpl = await fs.readFile(s), th = sha1(tpl);
    if (!fss.existsSync(d)) { await fs.writeFile(d, tpl); man[key] = th; continue; }
    const cur = sha1(await fs.readFile(d));
    if (cur === th) { man[key] = th; continue; }
    if (cur === man[key] || (!man[key] && pristine.has(cur))) { await fs.writeFile(d, tpl); man[key] = th; }
  }
}
export async function ensureWorkspace() {
  if (seeded) return;
  await fs.mkdir(WS, { recursive: true });
  if (fss.existsSync(TEMPLATE)) {
    const mp = path.join(WS, "system/.template.json");
    const man: Record<string, string> = JSON.parse(await fs.readFile(mp, "utf8").catch(() => "{}"));
    const pristine = new Set<string>(JSON.parse(await fs.readFile(path.join(TEMPLATE, ".pristine.json"), "utf8").catch(() => "[]")));
    await copyDir(TEMPLATE, WS, man, pristine);
    await fs.mkdir(path.dirname(mp), { recursive: true });
    await fs.writeFile(mp, JSON.stringify(man));
  }
  seeded = true;
}

/** Python interpreter: PYTHON_BIN → the app's .venv (created by setup.sh; avoids PEP 668 "externally managed" errors) → python3. */
// Runtime-only path built with Array.join: the bundler's file tracer follows path.join(process.cwd(), …) and
// fails on .venv/bin/python (a symlink outside the project).
const VENV_DIR = () => [process.cwd(), process.env.VENV_DIR || ".venv"].join("/");
export const VENV = () => { const d = VENV_DIR(); return fss.existsSync([d, "bin", "python"].join("/")) ? d : ""; };
export const PY = () => process.env.PYTHON_BIN || (VENV() ? [VENV(), "bin", "python"].join("/") : "python3");

export type AccessMode = "sandbox" | "home" | "full";
export const HOME = process.env.HOME || os.homedir();

/**
 * Resolve an agent/user path.
 * sandbox: everything is relative to the workspace ("/x" == "x").
 * home:    "~/x" and absolute paths inside $HOME are real; anything else maps into the workspace.
 * full:    "~/x" and any absolute path are real.
 */
export function resolvePath(p: string, access: AccessMode | boolean = "sandbox"): string {
  const mode: AccessMode = access === true ? "full" : access === false ? "sandbox" : access;
  const clean = (p || ".").replace(/^@/, "");
  const inside = (abs: string, root: string) => abs === root || abs.startsWith(root + path.sep);
  const wsAbs = () => {
    const abs = path.resolve(WS, clean.replace(/^\/+/, ""));
    if (!inside(abs, WS)) throw new Error("Path escapes workspace: " + p);
    return abs;
  };
  if (mode === "sandbox") return wsAbs();
  let real: string | null = null;
  if (clean.startsWith("~")) real = path.join(HOME, clean.slice(1));
  else if (path.isAbsolute(clean)) real = path.resolve(clean);
  if (!real) return wsAbs();
  if (inside(real, WS) || mode === "full" || inside(real, HOME)) return real;
  return wsAbs();
}
export const rel = (abs: string) => {
  if (abs === WS) return ".";
  if (abs.startsWith(WS + path.sep)) return path.relative(WS, abs);
  return abs.startsWith(HOME + path.sep) ? "~/" + path.relative(HOME, abs) : abs;
};

const SKIP = new Set([".git", ".trash", ".cache", ".template.json", "node_modules", ".venv", "__pycache__", ".chroma", ".keep", ".DS_Store"]);

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
  return new Promise((res) => execFile(PY(), ["-c", code, arg], { timeout: 60000, maxBuffer: 20e6 }, (e, out) => res(e ? "" : out)));
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
