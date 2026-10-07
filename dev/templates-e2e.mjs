/*
 * Templates, end to end: the library through its API, the palette that browses it, a circuit that actually
 * renders in a canvas, and the tool path a model uses (template_search → template_get → "Checked: …").
 *
 * The point of the library is that `check.ok` is true, so the first section is the important one: every
 * shipped circuit is rendered through the app's TikZ engine, and every shipped block shell passes the block
 * checker, before anything else here is allowed to pass.
 */
import fs from "node:fs";
import path from "node:path";

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
const until = async (ms, f) => { const t = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > t) return null; await sleep(250); } };
let pass = 0, fail = 0;
const ok = (name, cond, diag) => { if (cond) { pass++; console.log("ok  ", name); } else { fail++; console.log("FAIL", name, diag === undefined ? "" : `→ ${typeof diag === "string" ? diag : JSON.stringify(diag).slice(0, 300)}`); } };

await fetch(`${B}/api/dev`, { method: "POST", body: JSON.stringify({ enable: true }) });
await fetch(`${B}/api/dev`, { method: "POST", body: JSON.stringify({ mock: true }) });

// ---------------------------------------------------------------- the library, verified
const list = await fetch(`${B}/api/templates`).then((r) => r.json());
const templates = list.templates || [];
ok("the library lists the shipped templates", templates.length >= 15, templates.length);
ok("all three kinds are listed", ["circuit", "block", "doc"].every((k) => templates.some((t) => t.kind === k)), [...new Set(templates.map((t) => t.kind))]);
ok("a listing never carries sources", templates.every((t) => !("body" in t) && !("code" in t)), Object.keys(templates[0] || {}));

const unverified = [];
const missingVars = [];
for (const t of templates) {
  const j = await fetch(`${B}/api/templates?id=${encodeURIComponent(t.id)}`).then((r) => r.json());
  if (!j.ok || !j.check?.ok) { unverified.push(`${t.id}: ${j.check?.error || j.error}`); continue; }
  if ((j.missing || []).length) missingVars.push(`${t.id}: ${j.missing.join(",")}`);
  // check.ok *is* the render for a circuit (the API renders before it answers): the source must also look like
  // the drawing it claims to be, so a template that quietly lost its fence cannot pass.
  if (t.kind === "circuit" && !/\\begin\{circuitikz\}/.test(j.source || "")) unverified.push(`${t.id}: no circuitikz source`);
  if (t.kind === "block" && !/<x-[a-z-]+/.test(j.source || "")) unverified.push(`${t.id}: no Blocks markup`);
}
ok("every shipped circuit renders and every block passes the checker (check.ok)", unverified.length === 0, unverified);
ok("reading a template fills its vars from the examples", missingVars.length === 0, missingVars);

const half = await fetch(`${B}/api/templates?id=half-adder&a=X&b=Y`).then((r) => r.json());
ok("values passed in land in the source", half.source.includes("X") && half.source.includes("Y") && !half.source.includes("{{"), half.source.slice(0, 80));
ok("the circuit description explains what it is for", /xor|carry/i.test(templates.find((t) => t.id === "half-adder")?.description || ""));

// ---------------------------------------------------------------- saving is the contribution path
const saved = await fetch(`${B}/api/templates`, {
  method: "POST",
  body: JSON.stringify({
    name: "e2e-scratch", kind: "doc", title: "E2E scratch", description: "Written by the templates e2e, deleted right after.",
    tags: "test", vars: [{ name: "who", label: "the subject", example: "the reader" }],
    body: "# Hello {{who}}\n\nProse for the test.\n", overwrite: true,
  }),
}).then((r) => r.json());
ok("a template can be saved to the user's shelf", saved.ok === true && saved.template?.id === "e2e-scratch", saved);
const read = await fetch(`${B}/api/templates?id=e2e-scratch`).then((r) => r.json());
ok("it reads back filled and checked", read.ok && read.template.source === "user" && /Hello the reader/.test(read.body), read.body?.slice(0, 60));
const dup = await fetch(`${B}/api/templates`, { method: "POST", body: JSON.stringify({ name: "e2e-scratch", kind: "doc", description: "again", body: "x" }) }).then((r) => r.json());
ok("saving over one needs overwrite=true", dup.ok === false && /overwrite/.test(dup.error || ""), dup);
const del = await fetch(`${B}/api/templates?id=e2e-scratch`, { method: "DELETE" }).then((r) => r.json());
ok("the user's own template can be removed", del.ok === true, del);
const bundledDel = await fetch(`${B}/api/templates?id=quiz`, { method: "DELETE" }).then((r) => r.json());
ok("a shipped template cannot be removed", bundledDel.ok === false, bundledDel);
ok("the scratch folder is gone", !fs.existsSync(path.resolve("workspace/templates/e2e-scratch")), fs.existsSync(path.resolve("workspace/templates/e2e-scratch")));

// ---------------------------------------------------------------- the palette, and a circuit that draws
const b = await puppeteer.launch({ executablePath: exe, args, headless: true, defaultViewport: { width: 1400, height: 900 } });
const pg = await b.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
pg.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
await pg.goto(B, { waitUntil: "networkidle2" });
await sleep(900);
await pg.click(".dock textarea");
await pg.keyboard.type("/templates");
await sleep(400);
await pg.keyboard.press("Enter");
await sleep(500);
const rows = await pg.$$eval(".pal .pal-row", (rs) => rs.map((r) => r.innerText.split("\n")[0]));
ok("the palette lists the library", rows.some((t) => /half adder/i.test(t)) && rows.some((t) => /quiz/i.test(t)), rows.slice(0, 6));
const groups = await pg.$$eval(".pal .pal-group, .pal .pal-head", (gs) => gs.map((g) => g.innerText.trim()));
ok("rows are grouped by kind", groups.some((g) => /circuit/i.test(g)) && groups.some((g) => /block|document/i.test(g)), groups.slice(0, 5));

const halfRow = rows.findIndex((t) => /half adder/i.test(t));
await pg.evaluate((i) => document.querySelectorAll(".pal .pal-row")[i]?.click(), halfRow);
const drew = await until(45_000, async () => {
  const frames = pg.frames().filter((f) => f !== pg.mainFrame());
  for (const f of frames) {
    const svg = await f.evaluate(() => (document.querySelector("svg.tikz, svg") || {}).outerHTML || "").catch(() => "");
    if (/<(path|line|polygon|text)\b/.test(svg)) return svg.length;
  }
  return 0;
});
ok("picking a circuit opens a canvas and the drawing renders in it", !!drew, drew);
await pg.screenshot({ path: "/tmp/templates-e2e.png" });

// ---------------------------------------------------------------- the tool path a model uses
// A fresh chat on purpose: the mock picks its answer from the conversation, and an older chat would win with
// one of its own branches before the directive is ever reached.
await pg.click('button[aria-label="New chat"]');
await sleep(800);
await pg.click(".dock textarea");
await pg.keyboard.type("tmpl: half adder");
await pg.keyboard.press("Enter");
const answer = await until(60_000, async () => {
  const text = await pg.evaluate(() => document.body.innerText);
  return /Took half-adder from the library/.test(text) ? text : null;
});
ok("template_search → template_get runs and the reply quotes the check", !!answer && /Checked:/.test(answer), (answer || "").slice(-300));
// The rows live inside a collapsed activity block: open it, then read the labels (they are humanized, so the
// assertion is on "template" appearing once per call rather than on the wire names).
await pg.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
await sleep(400);
const toolRows = await pg.evaluate(() => [...document.querySelectorAll(".tool, .tool-row")].map((t) => t.innerText.replace(/\s+/g, " ")).join(" | "));
ok("both tool calls are visible in the chat", (toolRows.match(/template/gi) || []).length >= 2, toolRows.slice(0, 200));
ok("no page errors", errs.length === 0, errs.slice(0, 3));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
