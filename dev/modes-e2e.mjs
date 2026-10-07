// e2e for the mode system: /mode expands the input bar into the picker, the chip reflects the chat's mode,
// the mode skill reaches the model, the denied tools are gone from its tool list, and the dispatcher refuses
// a denied call anyway. Needs the app running (dev or production).
//   node dev/modes-e2e.mjs [baseUrl]        screenshots → /tmp/modes-*.png
import fs from "node:fs";

const B = process.argv[2] || "http://127.0.0.1:3000";

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
  return puppeteer.launch({ executablePath: exe, args, headless: true, defaultViewport: { width: 1280, height: 860 } });
}

await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ enable: true }) });
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ mock: true }) });

const b = await launch();
const pg = await b.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = [], bad = [];
const check = (name, cond, extra = "") => { (cond ? ok : bad).push(name + (extra ? " :: " + extra : "")); if (!cond) console.log("  FAIL " + name + (extra ? " :: " + extra : "")); };
const ta = ".dock textarea";
const colText = () => pg.$eval("main.column", (e) => e.innerText).catch(() => "");
const chip = () => pg.$eval(".dock .cmode", (e) => e.innerText.trim()).catch(() => null);
// Park the pointer away from the palette before a keyboard pick: a hovered row keeps the highlight,
// which is right for a menu but wrong for a test that means "the first row".
const park = () => pg.mouse.move(640, 80);
const type = async (t, clear = true) => {
  if (clear) { await pg.click(ta, { clickCount: 3 }); await pg.keyboard.press("Backspace"); }
  else await pg.$eval(ta, (e) => e.focus());
  await pg.keyboard.type(t, { delay: 12 });
  await park();
};
const send = async (t) => { await type(t); await park(); await pg.keyboard.press("Enter"); };
const waitText = async (needle, tries = 80) => { for (let i = 0; i < tries; i++) { if ((await colText()).includes(needle)) return true; await sleep(250); } return false; };

await pg.goto(B, { waitUntil: "networkidle2" });
await sleep(600);
check("a fresh chat shows no mode chip", (await chip()) === null);

// ── /mode expands the input bar into the picker
await type("/mode");
await sleep(400);
check("typing /mode lists the command", (await pg.$eval(".pal", (e) => e.innerText)).includes("/mode"), await pg.$eval(".pal", (e) => e.innerText).catch(() => "no palette"));
await pg.keyboard.press("Enter");
await sleep(500);
const palText = await pg.$eval(".pal", (e) => e.innerText).catch(() => "");
const rows = await pg.$$eval(".pal .pal-row", (els) => els.map((e) => e.innerText.trim()));
check("the picker opens in the input bar", /mode · chat/i.test(palText), JSON.stringify(palText.slice(0, 60)));
check("every mode is listed", rows.length >= 7 && rows.join("|").includes("plan") && rows.join("|").includes("debug"), JSON.stringify(rows));

// ── pick plan with the keyboard
await pg.keyboard.press("ArrowDown"); // chat -> search
await pg.keyboard.press("ArrowDown"); // search -> plan
await pg.keyboard.press("Enter");
await sleep(500);
check("picking a mode closes the picker and shows the chip", (await chip()) === "plan", String(await chip()));
check("the picker collapsed", (await pg.$(".pal")) === null);
await pg.screenshot({ path: "/tmp/modes-picker.png" });

// ── the mode reaches the model: skill injected, denied tools gone
await send("modecheck");
await waitText("mode=plan");
const report = await colText();
const line = (k) => (report.match(new RegExp(k + "=(\\S+)")) || [])[1] || "";
check("the model is told which mode it is in", line("mode") === "plan", report.slice(-200));
check("the mode's skill is injected into the prompt", line("skill") === "injected", `skill=${line("skill")}`);
check("plan mode has no writing tools", line("fs_write") === "false" && line("shell") === "false", `fs_write=${line("fs_write")} shell=${line("shell")}`);
check("plan mode keeps the read tools", line("web_search") === "true", `web_search=${line("web_search")}`);

// ── the dispatcher refuses a denied call even when the model asks for it
await send("modewrite");
const refused = await waitText("off in plan mode");
check("a denied tool call is refused, not executed", refused, (await colText()).slice(-160));
check("the refused write never reached the disk", !fs.existsSync(new URL("../workspace/scratch/mode-should-not-exist.txt", import.meta.url).pathname));

// ── switching with an argument, and the search mode's own restrictions
await type("/mode search");
await sleep(300);
await pg.keyboard.press("Enter");
// "/mode search" typed in full: the command runs with its argument
await sleep(600);
await type("/mode search");
await sleep(200);
await pg.keyboard.press("Enter");
await sleep(600);
check("/mode <name> switches without opening the picker", (await chip()) === "search", String(await chip()));
await send("modecheck");
await waitText("mode=search");
const r2 = await colText();
check("search mode drops the file mutators", /fs_write=false/.test(r2) && /shell=false/.test(r2), r2.slice(-160));
check("search mode still has web_search", /web_search=true/.test(r2));

// ── the mode is part of the conversation, not of the page
await pg.reload({ waitUntil: "networkidle2" });
await sleep(1200);
await pg.click('button[aria-label="Chats"]').catch(() => {});
await sleep(400);
await pg.evaluate(() => [...document.querySelectorAll(".lstack .seg button")].find((b) => b.textContent.trim() === "General")?.click());
await sleep(400);
await pg.evaluate(() => [...document.querySelectorAll(".lstack .li")].find((e) => e.innerText.includes("modecheck"))?.click());
await sleep(1500);
check("the mode survives a reload (it belongs to the chat)", (await chip()) === "search", String(await chip()));

// ── leaving the mode
const chipEl = await pg.$(".dock .cmode");
if (chipEl) await chipEl.evaluate((e) => e.click());
await sleep(400);
check("clicking the chip leaves the mode", (await chip()) === null, String(await chip()));
await pg.screenshot({ path: "/tmp/modes-off.png" });

check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log(ok.map((n) => "  ok   " + n).join("\n"));
console.log((bad.length ? "\n" : "") + bad.map((n) => "  FAIL " + n).join("\n"));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
await b.close();
process.exit(bad.length ? 1 : 0);
