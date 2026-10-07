/*
 * The desktop layer, end to end: the bridge API, the CLI that talks to it, and the summon window.
 *
 * The promise is "invokable through the app's own APIs", so that is what is checked here: the CLI
 * asks, the browser window asks, both land in normal conversations — and the two of them are the
 * same path, not the UI being driven from outside.
 *
 * A machine without notify-send / xdg-open / Chrome (this container) must answer with a clear
 * reason instead of failing silently, so those legs accept either outcome but never a vague one.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const req = (await import("node:module")).createRequire(import.meta.url);
let puppeteer;
try { puppeteer = req("puppeteer-core"); } catch { puppeteer = req("/tmp/shot/node_modules/puppeteer-core"); }
let exe = process.env.CHROME, args = [];
if (!exe) {
  process.env.AWS_EXECUTION_ENV ||= "AWS_Lambda_nodejs22.x";
  const m = await import("/tmp/shot/node_modules/@sparticuz/chromium/build/index.js");
  const c = (m.default && m.default.default) || m.default || m;
  exe = await c.executablePath(); args = c.args;
}
const B = "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ms, f) => { const t = Date.now() + ms; for (;;) { const v = await f().catch(() => null); if (v) return v; if (Date.now() > t) return null; await sleep(250); } };
let pass = 0, fail = 0;
const ok = (name, cond, diag) => { if (cond) { pass++; console.log("ok  ", name); } else { fail++; console.log("FAIL", name, diag === undefined ? "" : `→ ${typeof diag === "string" ? diag : JSON.stringify(diag).slice(0, 300)}`); } };

await fetch(`${B}/api/dev`, { method: "POST", body: JSON.stringify({ enable: true }) });
await fetch(`${B}/api/dev`, { method: "POST", body: JSON.stringify({ mock: true }) });
const post = (body) => fetch(`${B}/api/os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---------------------------------------------------------------- what the machine says it can do
const info = await fetch(`${B}/api/os`).then((r) => r.json());
ok("the bridge describes this machine", info.ok === true && info.platform === "linux", { ok: info.ok, platform: info.platform });
ok("it reports the session and the tools it looked for", !!info.session && "notify" in info.tools && "clipboard" in info.tools, info.tools);
ok("it hands out the summon window's command", Array.isArray(info.app?.argv) || (info.app?.argv === null && !info.tools.browser), info.app);
ok("…and the url that command opens", info.app.url.endsWith("/summon"), info.app.url);
ok("it names the hotkey file and snippet for this desktop", typeof info.hotkey?.snippet === "string" && info.hotkey.snippet.includes("summon"), info.hotkey);
ok("a locked install would say so", "locked" in info, Object.keys(info));

// ---------------------------------------------------------------- the actions, honest about a bare host
const noted = await post({ action: "notify", title: "desktop e2e", body: "hello" }).then((r) => r.json());
ok("notify either shows up or explains itself", noted.ok === true || typeof noted.error === "string", noted);
if (!info.tools.notify) ok("…and the reason names the missing tool", /notification tool/.test(noted.error || ""), noted.error);
const opened = await post({ action: "open", path: "/definitely/not/here-desktop-e2e" }).then((r) => r.json());
ok("open refuses a path that is not there", opened.ok === false && /Nothing at|xdg-open/.test(opened.error), opened);
const clip = await post({ action: "clipboard", text: "desktop e2e" }).then((r) => r.json());
ok("clipboard either copies or explains itself", clip.ok === true || /clipboard tool/.test(clip.error || ""), clip);
const bogus = await post({ action: "nonsense" });
ok("an unknown action is a 400", bogus.status === 400, bogus.status);
const summoned = await post({ action: "summon" }).then((r) => r.json());
ok("summon either opens a window or explains itself", summoned.ok === true ? ["focused", "launched", "opened"].includes(summoned.how) : /No browser/.test(summoned.error || ""), summoned);
if (summoned.ok) ok("…and says which it did", typeof summoned.how === "string", summoned);

// ---------------------------------------------------------------- the CLI (the OS side of it)
const status = await run("node", ["scripts/desktop.mjs", "status"], { cwd: process.cwd() }).catch((e) => e);
ok("minimalist-chat desktop prints the plan", status.code === undefined && /\/summon/.test(status.stdout || ""), (status.stdout || status.stderr || "").slice(0, 200));
const hk = await run("node", ["scripts/desktop.mjs", "hotkey"], { cwd: process.cwd() }).catch((e) => e);
ok("minimalist-chat hotkey prints a bind that runs the launcher", /minimalist-chat summon/.test(hk.stdout || ""), (hk.stdout || "").slice(0, 200));

// one question from the shell, streamed back — the whole point of the desktop layer
const asked = await run("node", ["scripts/desktop.mjs", "ask", "desk: ping"], { cwd: process.cwd(), maxBuffer: 4e6 }).catch((e) => e);
ok("minimalist-chat ask answers on stdout", /the bridge is up/.test(asked.stdout || ""), (asked.stdout || asked.stderr || "").slice(0, 300));
const cliConv = ((asked.stderr || "").match(/chat: \S+\?chat=([\w-]+)/) || [])[1];
ok("…and reports the chat it landed in", !!cliConv, (asked.stderr || "").slice(-120));

// ---------------------------------------------------------------- the summon window
const pg = await puppeteer.launch({ executablePath: exe, args: args.filter((a) => a !== "--single-process"), headless: true, userDataDir: process.env.CHROME_PROFILE || undefined });
const convs = [];
try {
  const p = await pg.newPage();
  await p.setViewport({ width: 620, height: 320 });
  await p.goto(`${B}/summon`, { waitUntil: "domcontentloaded" });
  ok("the summon page has its own title", (await p.title()) === "Ask · Workspace", await p.title());
  ok("the box is focused on arrival", await p.evaluate(() => document.activeElement?.tagName === "TEXTAREA"));
  ok("it says how to use it", /Enter sends/.test(await p.$eval('[data-role="stream"]', (e) => e.innerText)));

  // Next dev hydrates a moment after domcontentloaded: type a probe until React answers for it
  const ready = async (page) => {
    for (let i = 0; i < 40; i++) {
      await page.click("textarea").catch(() => {});
      await page.type("textarea", "h").catch(() => {});
      if (await busy(page)) break;
      await page.keyboard.press("Backspace").catch(() => {});
      await sleep(250);
    }
    await page.keyboard.press("Backspace").catch(() => {});
    return page.$eval("textarea", (e) => e.value === "").catch(() => false);
  };
  const busy = (page) => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.getAttribute("aria-label") === "Stop"));
  const send = async (text) => { await p.click("textarea"); await p.type("textarea", text); await p.keyboard.press("Enter"); };
  ok("the box takes input once the page is live", await ready(p));
  await send("desk: ping");
  const answered = await until(20000, async () => (await p.$eval('[data-role="stream"]', (e) => e.innerText)).includes("the bridge is up"));
  ok("typing a question streams an answer into the window", !!answered, (await p.$eval('[data-role="stream"]', (e) => e.innerText)).slice(0, 200));
  ok("the window settles back to Send", await until(8000, async () => !(await busy(p))));
  const href = await p.$eval('a[href^="/?chat="]', (e) => e.getAttribute("href")).catch(() => null);
  ok("the answer offers a way into the workspace", !!href && href.startsWith("/?chat="), href);
  convs.push((href || "").split("chat=")[1]);

  await p.keyboard.press("Escape");
  await sleep(300);
  ok("Esc leaves the answer alone in a plain tab", (await p.$eval('[data-role="stream"]', (e) => e.innerText)).includes("the bridge is up"));

  // Esc during a run stops it (that is what the key means while it is working)
  await send("longtext");
  await until(8000, async () => busy(p));
  const slowConv = await until(8000, async () => (await p.$eval("div[data-conv]", (e) => e.dataset.conv)) || null);
  convs.push(slowConv);
  ok("the window knows which chat it is in", !!slowConv, slowConv);
  ok("a long answer is still arriving", await busy(p));
  await p.keyboard.press("Escape");
  ok("Esc stops a run in flight", await until(8000, async () => !(await busy(p))));
  const left = await until(8000, async () => {
    const j = await fetch(`${B}/api/chat`).then((r) => r.json()).catch(() => ({}));
    return (j.running || []).includes(slowConv) ? null : true;
  });
  ok("…and the server stops running that chat", !!left, slowConv);

  // the link really opens that conversation in the app
  const page2 = await pg.newPage();
  await page2.goto(`${B}${href}`, { waitUntil: "domcontentloaded" });
  const shown = await until(15000, async () => (await page2.$eval("main.column", (e) => e.innerText).catch(() => "")).includes("the bridge is up"));
  ok("/?chat= opens that conversation in the workspace", !!shown, (await page2.$eval("main.column", (e) => e.innerText).catch(() => "")).slice(0, 160));
  await page2.close();

  // a summon is a quiet chat: no mode lens, no packs
  const list = await fetch(`${B}/api/conversations`).then((r) => r.json());
  const made = list.find((c) => c.id === convs[0]);
  ok("a summon lands as an ordinary quiet chat", made?.mode === "general", made ? { id: made.id, mode: made.mode, title: made.title } : "not in the list");
} finally {
  await pg.close();
  for (const id of convs.filter(Boolean)) await fetch(`${B}/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
  if (cliConv) await fetch(`${B}/api/conversations/${cliConv}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
