// Workflows, end to end, against the dev server with the mock model (see dev/mock-llm.mjs):
//
//   phase 1 — the composer: /workflows, pick one, type the question, Enter. The window must open, show real
//             progress while the run happens, present the run's own Blocks UI when it is done, and the chat must
//             end up with the card and the report — and nothing of the process.
//   phase 2 — the tools: `wfrun:` makes the model call start_workflow, `wfsave:` makes it call workflow_save.
//             A saved workflow is a file that the runner can actually run; a started run lands in the chat.
//
// Run: node dev/workflows-e2e.mjs [http://127.0.0.1:3000]
const fs = await import("node:fs/promises");

// the bench browser (puppeteer-core + the Lambda build of chromium); CHROME overrides the binary
async function launch() {
  const req = (await import("node:module")).createRequire(import.meta.url);
  let puppeteer; try { puppeteer = req("puppeteer-core"); } catch { puppeteer = req("/tmp/shot/node_modules/puppeteer-core"); }
  let exe = process.env.CHROME, args = [];
  if (!exe) { process.env.AWS_EXECUTION_ENV ||= "AWS_Lambda_nodejs22.x"; const m = await import("/tmp/shot/node_modules/@sparticuz/chromium/build/index.js"); const c = (m.default && m.default.default) || m.default || m; exe = await c.executablePath(); args = c.args; }
  return puppeteer.launch({ executablePath: exe, args, headless: true, defaultViewport: { width: 1280, height: 880 } });
}
const B = process.argv[2] || "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = [], bad = [];
const check = (n, c, x = "") => (c ? ok : bad).push(n + (x ? " :: " + x : ""));
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ enable: true }) });
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ mock: true }) });
const b = await launch(); const pg = await b.newPage();
pg.on("dialog", (d) => d.dismiss().catch(() => {}));
const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
const ta = ".dock textarea";
const say = async (text, wait = 400) => { await pg.click(ta); await pg.keyboard.type(text); await sleep(wait); await pg.keyboard.press("Enter"); };
const winText = () => pg.$eval(".win", (e) => e.innerText).catch(() => "");
const badge = () => pg.$eval(".wfbadge", (e) => e.innerText).catch(() => "");
const pct = async () => Number(await pg.$eval(".wf-progress", (e) => e.getAttribute("aria-valuenow")).catch(() => 0));
const chat = () => pg.$eval("main.column", (e) => e.innerText).catch(() => "");
/** Wait for something to become true, up to `ms` — runs are short here but they are still runs. */
async function until(ms, f) { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(250); } return false; }

await pg.goto(B, { waitUntil: "networkidle2" });
await sleep(900);

// ---------------------------------------------------------------- phase 1: from the composer
await say("hello there");                       // a chat must exist for the card and the report to land in
await sleep(2500);
await pg.keyboard.type("/workflows"); await sleep(500);
check("/workflows is a command", (await pg.$eval(".pal", (e) => e.innerText).catch(() => "")).includes("/workflows"));
await pg.keyboard.press("Enter"); await sleep(500);
const pal = await pg.$eval(".pal", (e) => e.innerText).catch(() => "");
check("Enter opens the workflow surface", /Deep research/.test(pal), pal.replace(/\n/g, " | ").slice(0, 160));
await pg.evaluate(() => { const r = [...document.querySelectorAll(".pal .pal-row")].find((e) => e.innerText.includes("Deep research")); r?.click(); });
await sleep(500);
check("picking it asks for the input", /look into/i.test(await pg.$eval(".pal-crumb", (e) => e.innerText).catch(() => "")));
await pg.keyboard.type("what changed in css anchor positioning");
await sleep(200);
await pg.keyboard.press("Enter");
check("a workflow window opens", await until(4000, async () => !!(await pg.$(".win"))));
check("the window shows the steps while it runs", await until(6000, async () => /Find sources/.test(await winText()) && /Open the pages/.test(await winText())), (await winText()).replace(/\n/g, " | ").slice(0, 160));
check("the window shows a progress bar", await until(6000, async () => !!(await pg.$(".wf-progress"))));
await pg.screenshot({ path: "/tmp/wf-running.png" });
// "done" is also a step's own word for itself, so the run's own badge and the bar's value are what count
const done = await until(30000, async () => (await badge()).toLowerCase() === "done" && (await pct()) === 100);
check("progress reaches the end", done, `${await badge()} / ${await pct()}% :: ` + (await winText()).replace(/\n/g, " | ").slice(0, 140));
check("the finished run shows its own UI or the default process view", !!(await pg.$(".wf-own, .wf-sources")));
const frames = pg.frames().filter((f) => f !== pg.mainFrame());
const own = frames.length ? await frames[0].evaluate(() => document.body.innerText).catch(() => "") : await pg.$eval(".wf-sources", (e) => e.innerText).catch(() => "");
check("the sources are shown", /docs\.example|pages/.test(own), own.replace(/\n/g, " | ").slice(0, 140));
await pg.screenshot({ path: "/tmp/wf-done.png" });
await pg.evaluate(() => { const t = [...document.querySelectorAll(".wftab")].find((e) => e.innerText.startsWith("Report")); t?.click(); });
const repText = () => pg.$eval(".wf-report", (e) => e.innerText).catch(() => "");
check("the report tab has the report", await until(4000, async () => /anchor positioning is specified/i.test(await repText())), (await repText()).slice(0, 120));
await pg.screenshot({ path: "/tmp/wf-report.png" });
const text = await chat();
check("the chat shows the workflow card", /Deep research/.test(text), text.slice(0, 200));
check("the card carries the question", /css anchor positioning/.test(text));
check("the chat has the report text", /anchor positioning is specified/i.test(text));
check("the process is not in the chat", !/docs\.example/.test(text.replace(/\[1\]\(https:\/\/docs\.example[^)]*\)/g, "")), "sources should live in the window");

// ---------------------------------------------------------------- phase 2: the model can drive it too
// a fresh name each run: a workflow is a file, and the point of the check is that this run writes it
const slug = "digest" + Date.now().toString(36).slice(-4);
await say(`wfsave: ${slug}`, 200);
const saved = await until(20000, async () => new RegExp(`workflows/${slug}/workflow\\.md`).test(await chat()));
check("the model can save a workflow", saved, (await chat()).replace(/\n/g, " | ").slice(-200));
const file = await fs.readFile(new URL(`../workspace/workflows/${slug}/workflow.md`, import.meta.url).pathname, "utf8").catch(() => "");
check("the saved file is a workflow the runner accepts", /- search limit=5/.test(file) && /- agent expect=6/.test(file), file.split("\n").slice(0, 12).join(" | "));

await say(`wfrun: ${slug} what happened this week`, 200);
const started = await until(20000, async () => /Digest/.test(await chat()));
check("the model can start a workflow", started, (await chat()).replace(/\n/g, " | ").slice(-200));
const landed = await until(40000, async () => /Digest/.test(await chat()) && /anchor positioning is specified/i.test(await chat()));
check("its report lands in the chat as its own message", landed);

check("no page errors", errs.length === 0, errs.slice(0, 2).join(" / "));
await b.close();
console.log(ok.map((o) => "ok   " + o).join("\n"));
console.log(bad.map((o) => "FAIL " + o).join("\n"));
console.log(`\n${ok.length}/${ok.length + bad.length} passed`);
if (bad.length) process.exit(1);
