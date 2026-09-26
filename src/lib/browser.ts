import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createRequire } from "module";
import { spawnSync } from "child_process";
import { WS, rel } from "./workspace";

/**
 * Headless browser for the agent: open a URL or workspace page, run a few steps, return a screenshot
 * (fed back to the model as an image), console errors, failed requests and visible text.
 * Uses puppeteer-core with the first Chrome/Chromium/Edge found (CHROME_PATH overrides).
 */
const req = createRequire(path.join(process.cwd(), "package.json"));
type Pptr = typeof import("puppeteer-core");
type Browser = import("puppeteer-core").Browser;
const g = globalThis as unknown as { __browser?: { b: Browser; idle?: ReturnType<typeof setTimeout> } };

const CANDIDATES = [
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
  "/usr/bin/microsoft-edge", "/usr/bin/brave-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
let found: { path: string; args: string[] } | null | undefined;
export async function findChrome() {
  if (found !== undefined) return found;
  found = null;
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return (found = { path: process.env.CHROME_PATH, args: [] });
  for (const c of CANDIDATES) if (fs.existsSync(c)) return (found = { path: c, args: [] });
  for (const n of ["google-chrome", "chromium", "chromium-browser", "chrome"]) {
    const r = spawnSync("bash", ["-lc", `command -v ${n}`], { encoding: "utf8", timeout: 3000 });
    if (r.status === 0 && r.stdout.trim()) return (found = { path: r.stdout.trim(), args: [] });
  }
  try { // serverless chromium build, if the operator installed it
    const ch = req("@sparticuz/chromium");
    const mod = ch.default || ch;
    return (found = { path: await mod.executablePath(), args: mod.args || [] });
  } catch {}
  return found;
}

async function browser(): Promise<Browser> {
  const cur = g.__browser;
  if (cur?.b.connected) { if (cur.idle) clearTimeout(cur.idle); cur.idle = setTimeout(() => closeBrowser(), 300_000); return cur.b; }
  let pptr: Pptr;
  try { pptr = req("puppeteer-core"); } catch { throw new Error("puppeteer-core is not installed (npm i puppeteer-core)."); }
  const c = await findChrome();
  if (!c) throw new Error("No Chrome/Chromium found. Install one or set CHROME_PATH.");
  const b = await pptr.launch({ executablePath: c.path, headless: true, args: [...new Set([...c.args, "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--mute-audio"])] });
  g.__browser = { b, idle: setTimeout(() => closeBrowser(), 300_000) };
  return b;
}
export async function closeBrowser() { const cur = g.__browser; g.__browser = undefined; await cur?.b.close().catch(() => {}); }

export type Step = { click?: string; type?: string; text?: string; press?: string; wait?: number | string; eval?: string; scroll?: number; hover?: string; select?: string; value?: string };
export type BrowseOut = { shot: string; url: string; title: string; text: string; errors: string[]; evals: string[] };

/** Build a standalone page for a BlocksUI (.ui) source so it can be screenshotted like any page. */
async function uiPage(source: string, theme: string) {
  const pub = path.join(process.cwd(), "public/blocks");
  const origin = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${pub}/runtime.css"><style>${theme === "dark" ? ":root{--bg:#1d1d1b;--fg:#e6e2da;--muted:#8f8a80;--faint:#5f5b54;--line:rgba(230,226,218,.10);--surface:rgba(230,226,218,.05);--bubble:#2a2926;--accent:#d08b5b}" : ""}</style></head><body class="fill" data-theme="${theme}"><div id="root"></div><template data-blocks>${source.replace(/<\/template/gi, "<\\/template")}</template><script>window.BLOCKS_ORIGIN=${JSON.stringify(origin)}</script><script src="file://${pub}/runtime.js"></script><script src="file://${pub}/elements.js"></script><script>Blocks.connect()</script></body></html>`;
  const f = path.join(WS, ".cache/pages", `ui-${Date.now()}.html`);
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, html);
  return "file://" + f;
}

export async function browse(target: string, o: { steps?: Step[]; width?: number; height?: number; full?: boolean; theme?: string; resolve: (p: string) => string }): Promise<BrowseOut> {
  let url = target.trim();
  if (!/^(https?|file):/.test(url)) {
    const abs = o.resolve(url);
    if (!fs.existsSync(abs)) throw new Error("not found: " + url);
    const st = fs.statSync(abs);
    const file = st.isDirectory() ? path.join(abs, "index.html") : abs;
    url = file.endsWith(".ui") ? await uiPage(await fsp.readFile(file, "utf8"), o.theme || "light") : "file://" + file;
  }
  const b = await browser();
  const page = await b.newPage();
  const errors: string[] = [], evals: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warn") errors.push(`console.${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String((e as Error).message || e).slice(0, 300)));
  page.on("requestfailed", (r) => { const u = r.url(); if (!u.startsWith("data:")) errors.push(`request failed: ${u.slice(0, 160)} (${r.failure()?.errorText || ""})`); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url().slice(0, 160)}`); });
  try {
    await page.setViewport({ width: Math.min(1920, Math.max(320, o.width || 1280)), height: Math.min(2000, Math.max(320, o.height || 800)) });
    if (o.theme) await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: o.theme === "dark" ? "dark" : "light" }]);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch((e) => errors.push("navigation: " + String(e.message || e).slice(0, 200)));
    for (const s of o.steps || []) {
      try {
        if (s.click) await page.click(s.click);
        else if (s.hover) await page.hover(s.hover);
        else if (s.type) await page.type(s.type, s.text || "");
        else if (s.select) await page.select(s.select, s.value || "");
        else if (s.press) await page.keyboard.press(s.press as import("puppeteer-core").KeyInput);
        else if (s.scroll !== undefined) await page.evaluate((y) => window.scrollTo(0, y), s.scroll);
        else if (typeof s.wait === "number") await new Promise((r) => setTimeout(r, Math.min(10000, s.wait as number)));
        else if (typeof s.wait === "string") await page.waitForSelector(s.wait, { timeout: 10000 });
        else if (s.eval) evals.push(String(await page.evaluate(`(async()=>{ ${/\breturn\b/.test(s.eval) ? s.eval : "return (" + s.eval + ")"} })()`)).slice(0, 2000));
        await new Promise((r) => setTimeout(r, 150));
      } catch (e) { errors.push(`step ${JSON.stringify(s).slice(0, 80)} failed: ${String((e as Error).message || e).slice(0, 160)}`); }
    }
    await new Promise((r) => setTimeout(r, 400));
    const shotAbs = path.join(WS, ".cache/shots", `shot-${Date.now()}.jpg`);
    await fsp.mkdir(path.dirname(shotAbs), { recursive: true });
    await page.screenshot({ path: shotAbs as `${string}.jpeg`, type: "jpeg", quality: 72, fullPage: !!o.full, captureBeyondViewport: !!o.full });
    const text = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    return { shot: rel(shotAbs), url: page.url(), title: await page.title().catch(() => ""), text: text.replace(/\n{3,}/g, "\n\n").slice(0, 2500), errors: [...new Set(errors)].slice(0, 20), evals };
  } finally {
    await page.close().catch(() => {});
  }
}
