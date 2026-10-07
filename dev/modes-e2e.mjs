// Modes end to end: the picker reaches every mode, the mode is stored on the conversation (including on a
// chat that did not exist yet), and — the part that actually matters — the request the app builds for a
// turn in a mode withholds the tools that mode refuses and carries its prompt and skill.
// Needs the app running with developer mode available (DEV_MODE=1 or the /api/dev endpoint).
// Usage: node dev/modes-e2e.mjs [baseUrl]   (screenshots go to /tmp/modes-*.png)
async function launch() {
  const req = (await import("node:module")).createRequire(import.meta.url);
  let puppeteer; try { puppeteer = req("puppeteer-core"); } catch { puppeteer = req("/tmp/shot/node_modules/puppeteer-core"); }
  let exe = process.env.CHROME, args = [];
  if (!exe) { process.env.AWS_EXECUTION_ENV ||= "AWS_Lambda_nodejs22.x"; const m = await import("/tmp/shot/node_modules/@sparticuz/chromium/build/index.js"); const c = (m.default && m.default.default) || m.default || m; exe = await c.executablePath(); args = c.args; }
  return puppeteer.launch({ executablePath: exe, args, headless: true, defaultViewport: { width: 1280, height: 860 } });
}
const B = process.argv[2] || "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = [], bad = [];
const check = (n, c, x = "") => (c ? ok : bad).push(n + (x ? " :: " + x : ""));
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } };
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ enable: true }) });
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ mock: true }) });

// ---------------------------------------------------------------- the request the model actually receives
async function turn(mode, text) {
  const res = await fetch(B + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, user: { content: text, attachments: [] } }) });
  const cid = ((await res.text()).match(/"conversationId":"([^"]+)"/) || [])[1];
  if (!cid) return { cid: null, req: null, sys: "" };
  for (let i = 0; i < 80; i++) { await sleep(250); const s = await j(await fetch(`${B}/api/conversations/${cid}`)); if (s.messages?.some((m) => m.role === "assistant")) break; }
  const { last } = await j(await fetch(B + "/api/dev/mock/last"));
  const sys = (last?.messages || []).filter((m) => m.role === "system").map((m) => m.content).join("\n");
  return { cid, req: last, sys, tools: last?.tools || [] };
}
const plain = await turn("chat", "just chatting");
const pn = plain.tools;
const plan = await turn("plan", "how would you add a settings page?");
check("plan: the turn reaches the model", !!plan.req);
check("plan: no write or run tool is in the request at all", !["fs_write", "fs_edit", "fs_delete", "shell", "host_shell", "run_python"].some((x) => plan.tools.includes(x)), `${plan.tools.length} tools`);
check("plan: reading is still available", plan.tools.includes("fs_read") && plan.tools.includes("web_search"));
check("plan: the system prompt names the mode and its rules", /# Mode: Plan \(active/.test(plan.sys) && /it does not do|never edit a file/i.test(plan.sys));
check("plan: the mode's skill file travels with the prompt", /blocked here/.test(plan.sys) && /guess wearing a suit|A plan that cannot be executed/.test(plan.sys));
check("plan: the conversation keeps the mode", (await j(await fetch(`${B}/api/conversations/${plan.cid}`))).conversation?.state?.mode === "plan");
const research = await turn("research", "what is new in css anchor positioning?");
check("search: every web tool a normal chat had is kept", ["web_search", "web_fetch"].every((x) => research.tools.includes(x)) && research.tools.filter((x) => x.startsWith("web_")).length === pn.filter((x) => x.startsWith("web_")).length, research.tools.filter((x) => x.startsWith("web_")).join(","));
check("search: nothing can write, run or open a canvas", !["fs_write", "fs_edit", "shell", "run_python", "canvas_open", "remember"].some((x) => research.tools.includes(x)));
check("search: the model is told to cite pages", /cite|\[n\]\(url\)/i.test(research.sys));
const code = await turn("code", "add a hello endpoint");
check("code: the full toolset is available", code.tools.includes("fs_write") && code.tools.includes("shell") && code.tools.length === pn.length, `${code.tools.length} vs ${pn.length}`);
check("code: a normal chat is untouched by modes", pn.length > plan.tools.length && !/# Mode: /.test(plain.sys));

// ---------------------------------------------------------------- the picker, in the real UI
const b = await launch(); const pg = await b.newPage();
const errs = [], patches = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("request", (r) => { if (r.method() === "PATCH" && /\/api\/conversations\//.test(r.url())) patches.push(r.postData()); });
const ta = ".dock textarea";
const labels = () => pg.$$eval(".pal .pal-row", (els) => els.map((e) => e.innerText.replace(/\n/g, " — ")));
const chip = () => pg.$eval(".modestrip", (e) => e.innerText).catch(() => "");
const click = async (name) => { await pg.evaluate((n) => { const r = [...document.querySelectorAll(".pal .pal-row")].find((e) => e.innerText.trim().startsWith(n)); r?.click(); }, name); await sleep(400); };
await pg.goto(B, { waitUntil: "networkidle2" });
await sleep(700);
await pg.click(ta); await pg.keyboard.type("/mode"); await sleep(500);
const rows = await labels();
check("/mode expands the bar into a mode picker", await pg.$(".pal") !== null && rows.length === 6, rows.join(" | ").slice(0, 140));
check("the picker names every mode and what it is for", ["Search", "Plan", "Code", "Learn", "Write", "Data"].every((m) => rows.some((r) => r.startsWith(m))));
await pg.screenshot({ path: "/tmp/modes-picker.png" });
await click("Data");
check("a chat that does not exist yet can be put in a mode", /Data/.test(await chip()), (await chip()).replace(/\n/g, " | "));
await pg.click(ta); await pg.type(ta, "count these"); await pg.keyboard.press("Enter");
await sleep(2200);
const born = await pg.evaluate(async () => {
  const list = await fetch("/api/conversations").then((x) => x.json());
  return (await fetch("/api/conversations/" + list[0].id).then((x) => x.json())).conversation?.state?.mode ?? null;
});
check("the chat is born inside the mode", born === "data", String(born));
await pg.click(ta); await pg.keyboard.type("/mode"); await sleep(500);
await click("Plan");
check("picking a mode on an open chat patches it", patches.some((x) => /"mode":"plan"/.test(x || "")), patches.join(" | "));
check("the composer shows the mode while you write", /Plan/.test(await chip()));
await pg.screenshot({ path: "/tmp/modes-chip.png" });
await pg.reload({ waitUntil: "networkidle2" }); await sleep(1200);
await pg.click('button[aria-label="Chats"]'); await sleep(700);
await pg.evaluate(() => document.querySelector(".lstack .li")?.click());
await sleep(1200);
check("the mode is still there when the chat is reopened", /Plan/.test(await chip()), (await chip()).replace(/\n/g, " | "));
await pg.evaluate(() => document.querySelector(".modestrip .ib")?.click());
await sleep(400);
check("leaving the mode clears it", (await pg.$(".modestrip")) === null);
check("the composer stays quiet in a normal chat", !/\bopen\b/.test(await pg.$eval(".composer", (e) => e.className)));
check("no page errors", errs.length === 0, errs.slice(0, 2).join(" / "));
await b.close();

console.log(ok.map((o) => "ok   " + o).join("\n"));
if (bad.length) console.log(bad.map((x) => "FAIL " + x).join("\n"));
console.log(`\n${ok.length}/${ok.length + bad.length} passed`);
process.exit(bad.length ? 1 : 0);
