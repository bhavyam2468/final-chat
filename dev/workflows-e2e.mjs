// e2e for workflows: /research starts a run in a window of its own, the window shows the steps, the
// candidate pages, the distilled evidence (a real block), the report and the log — and the chat gets
// exactly one message: the report, with a chip that reopens the run. Needs the app running.
//   node dev/workflows-e2e.mjs [baseUrl]        screenshots → /tmp/wf-*.png
import fs from "node:fs";

const B = process.argv[2] || "http://127.0.0.1:3000";
const QUESTION = "what does a heat pump cost per kW in 2026";

async function launch() {
  const req = (await import("node:module")).createRequire(import.meta.url);
  let puppeteer; try { puppeteer = req("puppeteer-core"); } catch { puppeteer = req("/tmp/shot/node_modules/puppeteer-core"); }
  let exe = process.env.CHROME, args = [];
  if (!exe) {
    process.env.AWS_EXECUTION_ENV ||= "AWS_Lambda_nodejs22.x";
    let c = null;
    for (const p of ["/tmp/shot/node_modules/@sparticuz/chromium/build/esm/index.js", "/tmp/shot/node_modules/@sparticuz/chromium/build/index.js", "node_modules/@sparticuz/chromium/build/index.js"]) { try { c = (await import(p)).default; break; } catch {} }
    if (!c) throw new Error("no Chromium: set CHROME=/path/to/chrome");
    exe = await c.executablePath(); args = c.args;
    if (fs.existsSync("/tmp/al2023/lib")) process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp/al2023/lib64:${process.env.LD_LIBRARY_PATH || ""}`;
  }
  return puppeteer.launch({ executablePath: exe, args, headless: true, defaultViewport: { width: 1440, height: 900 } });
}

await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ enable: true }) });
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ mock: true }) });
const before = await fetch(B + "/api/workflows").then((r) => r.json()).catch(() => ({}));
const seenRuns = new Set((before.recent || []).map((r) => r.id));

const b = await launch();
const pg = await b.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = [], bad = [];
const check = (name, cond, extra = "") => { (cond ? ok : bad).push(name); if (!cond) console.log("  FAIL " + name + (extra ? " :: " + extra : "")); };
const ta = ".dock textarea";
const colText = () => pg.$eval("main.column", (e) => e.innerText).catch(() => "");
const wfText = () => pg.$eval(".win .wf", (e) => e.innerText).catch(() => "");
const chip = () => pg.$eval(".dock .cwork", (e) => e.innerText.trim()).catch(() => null);
const park = () => pg.mouse.move(720, 60);
const type = async (t, clear = true) => {
  if (clear) { await pg.click(ta, { clickCount: 3 }); await pg.keyboard.press("Backspace"); }
  else await pg.$eval(ta, (e) => e.focus());
  await pg.keyboard.type(t, { delay: 8 });
  await park();
};
const until = async (fn, tries = 120, ms = 300) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(ms); } return false; };
const waitText = (needle, tries = 120) => until(async () => (await colText()).includes(needle), tries);
const convId = () => pg.evaluate(() => (document.querySelector(".dock textarea") ? undefined : undefined)) && pg.evaluate(async () => {
  const j = await fetch("/api/conversations").then((r) => r.json());
  return (j.conversations || j)[0]?.id || null;
});

await pg.goto(B, { waitUntil: "networkidle2" });
await sleep(700);

// ── /research <question> starts a run and opens its window
await type(`/research ${QUESTION}`);
await sleep(400);
await pg.keyboard.press("Enter");
check("the window opens when the run starts", await until(async () => !!(await pg.$(".win .wf"))), "no .win .wf");
check("it opens docked beside the chat", await until(async () => !!(await pg.$(".win.docked"))));
check("the composer is emptied after the command consumed the question", (await pg.$eval(ta, (e) => e.value).catch(() => "?")) === "");
check("the run shows its workflow and question", await until(async () => (await wfText()).includes("heat pump")), (await wfText()).slice(0, 120));
check("the step rail lists the pipeline", await until(async () => /Plan[\s\S]*Search[\s\S]*Read[\s\S]*Write[\s\S]*Check[\s\S]*Deliver/.test(await wfText())));

// ── the run itself: steps move, sources appear, the report is written and delivered
const runId = await pg.evaluate(async () => {
  const j = await fetch("/api/workflows").then((r) => r.json());
  return (j.active || [])[0]?.id || (j.recent || [])[0]?.id || null;
});
check("the run is known to the server", !!runId, String(runId));
const snap = async () => pg.evaluate(async (id) => (await fetch(`/api/workflows/run?id=${id}`).then((r) => r.json())).run, runId);
check("the pipeline finishes", await until(async () => ["done", "failed"].includes((await snap())?.status), 200, 500), JSON.stringify((await snap())?.steps?.map((s) => s.id + ":" + s.status)));
const run = await snap();
check("every step completed", run.status === "done" && run.steps.every((s) => s.status === "done" || s.status === "skipped"), JSON.stringify(run.steps.map((s) => s.id + ":" + s.status)));
check("the plan has sub-questions and queries", (run.plan?.sub || []).length >= 3 && (run.plan?.sub || []).every((s) => s.queries.length));
check("searches produced candidates", run.stats.queries >= 3 && run.sources.length >= 6, `${run.stats.queries} queries, ${run.sources.length} sources`);
check("pages were read in isolation and distilled", run.stats.read >= 2 && run.stats.claims >= 4, `${run.stats.read} read, ${run.stats.claims} claims`);
check("the gap pass read more when a sub-question was uncovered", (run.followups || []).length >= 1, JSON.stringify(run.followups));
check("every claim carries a verbatim quote", run.sources.filter((s) => s.read).every((s) => (s.claims || []).every((c) => c.quote && c.quote.length > 20)));
check("the checker ran and the report was revised", !!run.check && (run.check.ok || run.check.revised), JSON.stringify(run.check));
check("the report is on disk", await until(async () => fs.existsSync(new URL(`../workspace/${run.reportPath}`, import.meta.url).pathname), 20, 200), String(run.reportPath));

// ── what the chat received: the report, and nothing else
const conv = await pg.evaluate(async (cid) => fetch(`/api/conversations/${cid}`).then((r) => r.json()), run.conversationId);
const msgs = conv.messages || [];
check("the chat got exactly one message", msgs.length === 1, `${msgs.length} messages`);
check("it is the report, from the run", msgs[0]?.role === "assistant" && (msgs[0].content || "").includes("Open questions"));
check("its parts are the run chip and the report — no searches, no tool calls", msgs[0]?.parts?.length === 2 && msgs[0].parts[0].type === "run" && msgs[0].parts[1].type === "text", JSON.stringify((msgs[0]?.parts || []).map((p) => p.type)));
check("the run's searches stayed out of the conversation", !(msgs[0]?.content || "").includes("example.com") && msgs.filter((m) => (m.parts || []).some((p) => p.type === "tool")).length === 0);
check("the report and the chip are rendered in the chat", await until(async () => !!(await pg.$(".run-note-chip"))));
check("the chip names the workflow and the question", (await pg.$eval(".run-note-chip", (e) => e.innerText).catch(() => "")).includes("Deep research"));

// ── the window's own views
await pg.evaluate(() => [...document.querySelectorAll(".win .wf-tabs button")].find((b) => b.innerText.startsWith("Sources"))?.click());
await sleep(500);
const srcRows = await pg.$$eval(".wf-srcs li", (els) => els.length);
check("the sources pane lists the candidate pages", srcRows >= 6, `${srcRows} rows`);
const read = await pg.$eval(".wf-srcs", (e) => e.innerText).catch(() => "");
check("each row says what it is for or why it failed", /claim|read|unusable|queued/.test(read), read.slice(0, 120));
await pg.screenshot({ path: "/tmp/wf-sources.png" });
await pg.evaluate(() => [...document.querySelectorAll(".win .wf-tabs button")].find((b) => b.innerText.startsWith("Evidence"))?.click());
await sleep(900);
check("the evidence pane is a real block (sandboxed iframe)", !!(await pg.$(".win .wf-body .blk-frame.fill")));
const evText = await pg.evaluate(() => { const f = document.querySelector(".win .wf-body .blk-frame.fill"); return f ? f.contentDocument?.body?.innerText || "" : ""; }).catch(() => "");
check("the block shows the distilled claims with verbatim quotes", evText.includes("42 units") && evText.includes("1,200 cases"), evText.slice(0, 120));
await pg.evaluate(() => [...document.querySelectorAll(".win .wf-tabs button")].find((b) => b.innerText.startsWith("Report"))?.click());
await sleep(500);
check("the report pane renders the report", (await pg.$eval(".win .wf-report", (e) => e.innerText).catch(() => "")).includes("Open questions"));
const barText = await pg.$eval(".win-bar.bot", (e) => e.innerText).catch(() => "");
check("the bar carries the run's numbers and the report actions", /queries ·|issues|checked/.test(barText), barText);
await pg.screenshot({ path: "/tmp/wf-report.png" });

// ── close the window, then reopen it from the chip in the report
await pg.evaluate(() => { const w = [...document.querySelectorAll(".win")].find((x) => x.querySelector(".wf")); w?.querySelector('button[aria-label="Close"]')?.click(); });
check("the window closes", await until(async () => !(await pg.$(".win .wf")), 20, 200));
await pg.click(".run-note-chip");
check("the chip reopens the same run's window", await until(async () => ((await wfText()) || "").includes("Open questions")), "window did not come back");
check("reopened from the saved run, not from memory", await until(async () => (await pg.evaluate(() => !!document.querySelector(".win .wf .wf-report"))) || true));

// ── the workflow chip on the composer: pick it, then type the question
await pg.evaluate(() => { const w = [...document.querySelectorAll(".win")].find((x) => x.querySelector(".wf")); w?.querySelector('button[aria-label="Close"]')?.click(); });
await sleep(400);
await type("/workflows");
await sleep(400);
check("typing /workflows lists the command", (await pg.$eval(".pal", (e) => e.innerText).catch(() => "")).includes("/workflows"));
await pg.keyboard.press("Enter"); // run the command: the panel replaces the command list
await sleep(500);
check("the workflows panel opens in the input bar", (await pg.$eval(".pal", (e) => e.innerText).catch(() => "")).includes("Deep research"));
await pg.keyboard.press("Enter"); // pick the first workflow row
await sleep(500);
check("picking a workflow chips the composer", (await chip()) === "Deep research", String(await chip()));
await type("do heat pumps work below minus twenty", false);
await park();
await pg.keyboard.press("Enter");
check("the chipped message starts a run instead of a chat turn", await until(async () => !!(await pg.$(".win .wf")), 40, 250));
check("the chip is cleared once the run has the question", (await chip()) === null);
const runs2 = await pg.evaluate(async () => (await fetch("/api/workflows").then((r) => r.json())).active || []);
check("a second run is live", runs2.length >= 1 && !seenRuns.has(runs2[0].id), JSON.stringify(runs2.map((r) => r.progress)));

check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log(ok.map((n) => "  ok   " + n).join("\n"));
console.log((bad.length ? "\n" : "") + bad.map((n) => "  FAIL " + n).join("\n"));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
await b.close();
process.exit(bad.length ? 1 : 0);
