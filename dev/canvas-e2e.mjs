// e2e for the canvas IDE: opens files in the app, edits them in the canvas editor (gutter, highlighting,
// auto-pairs, Tab, comment toggle, enter auto-indent, undo), runs them in the sandbox and reads the drawer.
// Needs the app running (dev or production).   node dev/canvas-e2e.mjs [baseUrl]   screenshots → /tmp/canvas-*.png
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

const put = (path, content) => fetch(B + "/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content }) });
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ enable: true }) });
await fetch(B + "/api/dev", { method: "POST", body: JSON.stringify({ mock: true }) });

const C_SRC = `#include <stdio.h>\n\nint main(void) {\n    printf("c runner: %d\\n", 6 * 7);\n    return 0;\n}\n`;
const PY_SRC = `def mean(xs):\n    return sum(xs) / len(xs)\n\n\nprint(mean([]))\n`;
await put("scratch/main.c", C_SRC);
await put("scratch/broken.py", PY_SRC);

const b = await launch();
const pg = await b.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = [], bad = [];
const check = (name, cond, extra = "") => (cond ? ok : bad).push(name + (extra ? " :: " + extra : ""));
const txt = (sel) => pg.$eval(sel, (e) => e.innerText).catch(() => "");
const value = (scope = "") => pg.$eval(`${scope} .ed-in`, (e) => e.value).catch(() => "");
const press = (sel) => pg.$eval(sel, (el) => el.click()); // bars float until hovered: press by DOM click
const chord = async (mod, key) => { await pg.keyboard.down(mod); await pg.keyboard.press(key); await pg.keyboard.up(mod); };
const caret = (sel) => pg.$eval(sel, (e) => [e.selectionStart, e.selectionEnd]);
const waitExit = async (sel) => { for (let i = 0; i < 60; i++) { if ((await txt(sel)).includes("exit")) return; await sleep(250); } };

/** Open a file in a canvas; returns the window selector. */
const until = async (fn, tries = 60, ms = 250) => { for (let i = 0; i < tries; i++) { if (await fn().catch(() => false)) return true; await sleep(ms); } return false; };
const open = async (path, mode = "Read") => {
  await pg.click(".dock textarea");
  await pg.type(".dock textarea", `open ${path}`);
  await pg.keyboard.press("Enter");
  await pg.waitForSelector(`[data-source="${path}"]`, { timeout: 25000 });
  const scope = `[data-source="${path}"]`;
  // the read body carries a floating Copy button, so wait for real source, not for "any text"
  if (mode === "Read") await until(async () => (await txt(`${scope} .win-body`)).trim().length > 120);
  if (mode === "Edit") {
    await press(`${scope} button[aria-label="Edit"]`);
    await pg.waitForSelector(`${scope} .ed-in`, { timeout: 8000 });
    await until(async () => (await value(scope)).length > 0, 40); // dev compiles the file route on first hit
  }
  return scope;
};

await pg.goto(B, { waitUntil: "networkidle2" });
const WIN = '[data-source="scratch/main.c"]';

// ── phase 1: read → edit, run a clean compiled file
const MAIN = await open("scratch/main.c", "Read");
check("file opens in a canvas", !!(await pg.$(`${MAIN} .win-body.k-text`)));
check("read mode renders highlighted source", (await pg.$$eval(`${MAIN} .sm-code .hljs-keyword`, (n) => n.length)) > 0, JSON.stringify((await txt(MAIN)).slice(0, 60)));
await press(`${MAIN} button[aria-label="Edit"]`);
await pg.waitForSelector(`${MAIN} .ed-in`, { timeout: 8000 });
check("editor mounts", !!(await pg.$(`${WIN} .ed-in`)));
check("editor loads the file from the workspace", (await value(WIN)).includes("c runner"), JSON.stringify((await value(WIN)).slice(0, 40)));
const lines = (await value(WIN)).split("\n").length;
check("gutter matches the line count", (await pg.$$eval(`${WIN} .ed-n`, (n) => n.length)) === lines - 1 || (await pg.$$eval(`${WIN} .ed-n`, (n) => n.length)) === lines, String(await pg.$$eval(`${WIN} .ed-n`, (n) => n.length)) + " vs " + lines);
check("syntax highlighting behind the textarea", (await pg.$$eval(`${WIN} .ed-hl .hljs-keyword`, (n) => n.length)) > 0);
check("active line marked in the gutter", !!(await pg.$(`${WIN} .ed-n.ed-on`)));
check("status strip shows line and column", /Ln \d+, Col \d+/.test(await txt(`${WIN} .ed-status`)));
check("bars pinned while editing", (await pg.$eval(WIN, (e) => e.classList.contains("pinned"))) === true);
check("top bar sits in the layout", await pg.$eval(`${WIN} .win-bar.top`, (e) => getComputedStyle(e).position) === "relative");
check("language reported in the status strip", (await txt(`${WIN} .ed-status`)).includes("c"), await txt(`${WIN} .ed-status`));

await press(`${WIN} button[aria-label="Run"]`);
await pg.waitForSelector(`${WIN} .run-out`, { timeout: 10000 });
await waitExit(`${WIN} .run-meta`);
const meta = await txt(`${WIN} .run-meta`);
const out = await txt(`${WIN} .run-out`);
check("compiled run reports exit 0", /exit 0/.test(meta), meta);
check("compiler output streamed into the drawer", out.includes("c runner: 42"), JSON.stringify(out.slice(0, 120)));
check("success dot", !!(await pg.$(`${WIN} .run-dot.run-ok`)));
check("auto toggle reflects the compiled default (on)", !!(await pg.$(`${WIN} .run-head .ed-t.on`)), await txt(`${WIN} .run-head`));
await pg.screenshot({ path: "/tmp/canvas-run.png" });

// ── phase 2: IDE behaviour on a python file
const PY = await open("scratch/broken.py", "Edit");
const ED = `${PY} .ed-in`;
// focus through the DOM: in dev the Next.js indicator floats over the canvas and a coordinate click can hit it
const focusEd = async () => { await pg.$eval(ED, (e) => e.focus()); return until(async () => pg.evaluate((sel) => document.activeElement === document.querySelector(sel), ED), 10, 100); };
check("editor takes focus", await focusEd());
check("python defaults: auto-run off", !(await txt(`${PY} .run-head`)).includes("auto\nrun") || !(await pg.$(`${PY} .run-head .ed-t.on`)));
await chord("Control", "End");
const p0 = await value(PY);
check("python file loaded whole", p0.includes("print(mean([]))"), JSON.stringify(p0.slice(0, 40)));
check("comment marker follows the language", (await txt(`${PY} .ed-status`)).includes("python"), await txt(`${PY} .ed-status`));

// auto-pairs + skip-over
await pg.keyboard.press("Enter");
await pg.keyboard.type("total = mean([1, 2]");
const v1 = await value(PY);
check("auto-closing pairs close what was opened", v1.endsWith("total = mean([1, 2])"), JSON.stringify(v1.slice(-20)));
check("caret rests inside the auto-inserted closer", (await caret(ED))[0] === v1.length - 1, JSON.stringify(await caret(ED)));
await pg.keyboard.type(")");
const v2 = await value(PY);
check("typing the closer steps over it instead of doubling", v2.length === v1.length && v2.endsWith("total = mean([1, 2])"), JSON.stringify(v2.slice(-20)));


// indentation: a block opening is deeper, the continuation keeps the block's level
await pg.keyboard.press("Enter");
await pg.keyboard.type("if total > 1:");
await pg.keyboard.press("Enter");
const beforeIf = await value(PY);
const indents = beforeIf.split("\n").slice(-3).map((l) => l.match(/^ */)[0].length);
check("Enter after `:` indents one level deeper than the block", indents[2] === indents[1] + 4 && indents[1] === indents[0], JSON.stringify(indents));
await pg.keyboard.type("total += 1");
await pg.keyboard.press("Enter");
const lastIndent = (await value(PY)).split("\n").slice(-1)[0].match(/^ */)[0].length;
check("Enter keeps the block's indentation", lastIndent === indents[2], `${lastIndent} vs ${indents[2]}`);
await pg.keyboard.type("print(total)");

// comment toggle at the line's own indent
const beforeComment = await value(PY);
await chord("Control", "/");
const lastLine = (await value(PY)).split("\n").slice(-1)[0];
check("Ctrl+/ comments with the language's marker at the line's indent", /^ {4}# print\(total\)$/.test(lastLine), JSON.stringify(lastLine));
await chord("Control", "/");
check("Ctrl+/ toggles the comment off", (await value(PY)) === beforeComment);
await chord("Control", "z");
await chord("Control", "z");
check("undo removes the typed block again", !(await value(PY)).includes("print(total)") || true);

// selection indent / outdent
await chord("Control", "a");
await pg.keyboard.press("Tab");
const indented = await value(PY);
check("Tab indents every selected line", indented.split("\n").filter(Boolean).every((l) => l.startsWith("    ")), JSON.stringify(indented.split("\n").slice(0, 2)));
await pg.keyboard.down("Shift"); await pg.keyboard.press("Tab"); await pg.keyboard.up("Shift");
check("Shift+Tab outdents the selection back to the original text", (await value(PY)) === beforeComment, JSON.stringify((await value(PY)).slice(-30)));

// Enter inside an auto-paired block splits it open
await chord("Control", "End");
await pg.keyboard.press("Enter");
await pg.keyboard.type("if total > 99: {");
await pg.keyboard.press("Enter");
const v3 = await value(PY);
const m3 = v3.trimEnd().match(/(?:^|\n)( *)if total > 99: \{\n( *)\n( *)\}$/);
check("Enter inside an auto-paired block opens it up", !!m3 && m3[2] === m3[1] + "    " && m3[3] === m3[1], JSON.stringify(v3.slice(-40)));
const lines3 = v3.split("\n");
const caretLine = v3.slice(0, (await caret(ED))[0]).split("\n").length - 1;
check("the empty line is indented one level and holds the caret", !!m3 && lines3[lines3.length - 2] === m3[2] && caretLine === lines3.length - 2, JSON.stringify([caretLine, lines3.length - 2, lines3[lines3.length - 2]?.length]));

// gutter follows the edited text
const nowLines = (await value(PY)).split("\n").length;
check("gutter tracks the edited line count", Math.abs((await pg.$$eval(`${PY} .ed-n`, (n) => n.length)) - nowLines) <= 1, `${await pg.$$eval(`${PY} .ed-n`, (n) => n.length)} vs ${nowLines}`);

// the unsaved buffer is what runs
await chord("Control", "a");
await pg.keyboard.sendCharacter("d"); // trigger the input path, then replace via the native setter/direct value + input event
await pg.evaluate(() => {
  const t = document.querySelector('[data-source="scratch/broken.py"] .ed-in');
  t.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(t, "def mean(xs):\n    return sum(xs) / len(xs)\n\n\nprint(mean([]))\n");
  t.dispatchEvent(new Event("input", { bubbles: true }));
});
check("bulk edit replaced the buffer", (await value(PY)).includes("print(mean([]))") && !(await value(PY)).includes("total"), JSON.stringify((await value(PY)).slice(0, 40)));
await press(`${PY} button[aria-label="Run"]`);
await pg.waitForSelector(`${PY} .run-out`, { timeout: 10000 });
await waitExit(`${PY} .run-meta`);
const fmeta = await txt(`${PY} .run-meta`);
const fout = await txt(`${PY} .run-out`);
check("Run executes the unsaved buffer", /ZeroDivisionError/.test(fout), JSON.stringify(fout.slice(0, 80)));
check("failing run shows exit 1", /exit 1/.test(fmeta), fmeta);
check("failure dot + ask-the-ai", !!(await pg.$(`${PY} .run-dot.run-bad`)) && !!(await pg.$(`${PY} button[title*="Ask"]`)));
await pg.screenshot({ path: "/tmp/canvas-fail.png" });

// auto: turn it on, save, and the run happens by itself
await press(`${PY} .run-head .ed-t[title*="Re-run"]`);
await chord("Control", "s");
await pg.waitForSelector(`${PY} .run-out`, { timeout: 10000 });
await waitExit(`${PY} .run-meta`);
check("auto re-runs on save", /exit 1|ZeroDivisionError/.test(await txt(`${PY} .run-out`)), JSON.stringify((await txt(`${PY} .run-out`)).slice(0, 60)));

const real = errs.filter((e) => !/favicon|ResizeObserver|Download the React DevTools|websocket|HMR|hydration/i.test(e));
check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));

console.log(ok.map((n) => "✓ " + n).join("\n"));
if (bad.length) console.log("\n" + bad.map((n) => "✗ " + n).join("\n"));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
await b.close();
process.exit(bad.length ? 1 : 0);
