// BlocksUI end-to-end bench: renders model-realistic sources in headless Chromium, inline and canvas ("fill") mode,
// performs interactions and asserts the result. Catches the bug classes seen in real chats: unbound {{ }}, literal
// "[object Object]", dead buttons, empty graphs, stretched SVG text, runtime exceptions.
//   node dev/blocks-e2e.mjs [filter]     (needs Chromium: CHROME=/path or @sparticuz/chromium in /tmp/shot)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { cases } from "./blocks-cases.mjs";

const PUB = path.resolve(import.meta.dirname, "../public");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".json": "application/json", ".html": "text/html" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (u === "/api/tikz") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' })); }); return; }
  const f = path.join(PUB, u);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", (MIME[path.extname(f)] || "application/octet-stream") + (/\.(js|css|html)$/.test(f) ? "; charset=utf-8" : ""));
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

import { launch } from "./browser.mjs";

const VARS = "--bg:#1f1e1c;--fg:#e8e4dc;--muted:#9a958c;--faint:#6b675f;--line:rgba(255,255,255,.1);--surface:rgba(255,255,255,.04);--bubble:#2b2a27;--float:#2b2a27;--accent:#d97757;--success:#7c9a6d;--danger:#c0645a;--r:12px";
const page = (src, fill) => `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="${ORIGIN}/blocks/runtime.css"><style>:root{${VARS}}html{background:var(--bg)}</style></head><body class="${fill ? "fill" : ""}" data-theme="dark"><div id="root"></div><script>window.BLOCKS_ORIGIN=${JSON.stringify(ORIGIN)};window.__errs=[];addEventListener("error",e=>__errs.push(String(e.message)));window.parent.postMessage=function(m){if(m&&m.type==="error")__errs.push(m.text);if(m&&m.type==="lm")window.__lm=m;if(m&&m.type==="issues")window.__issues=m.issues}</script><script src="${ORIGIN}/blocks/runtime.js"></script><script src="${ORIGIN}/blocks/elements.js"></script><script>(function(){const src=${JSON.stringify(src).replace(/</g, "\\u003c")};for(let i=37;i<src.length;i+=37)Blocks.feed(src.slice(0,i),false);Blocks.feed(src,true)})()</script></body></html>`;

const filter = process.argv[2] || "";
if (!cases.some((c) => c.name.includes(filter))) { console.log(`No case name contains "${filter}" (plain substring match).`); process.exit(2); }
const b = await launch();
let pass = 0, fail = 0; const fails = [];
for (const c of cases.filter((c) => c.name.includes(filter))) {
  for (const fill of c.modes || [false, true]) {
    const p = await b.newPage();
    if (c.width) await p.setViewport({ width: c.width, height: 700 });
    const tag = `${c.name} [${fill ? "canvas" : "inline"}]`;
    try {
      await p.goto(`${ORIGIN}/blocks/runtime.css`); // same-origin blank-ish page so setContent resolves relative fetches
      await p.setContent(page(c.src, fill), { waitUntil: "load" });
      await new Promise((r) => setTimeout(r, c.wait || 350));
      for (const s of c.steps || []) {
        if (s.click) {
          await p.evaluate((sel) => {
            let e = null; try { if (/^[#.\[]|^[a-z-]+$/.test(sel)) e = document.querySelector(sel); } catch {}
            const cands = [...document.querySelectorAll("button,label,.opt,[role=button]")];
            e ||= cands.find((x) => x.textContent.trim() === sel) || cands.find((x) => (x.querySelector(".tx") || {}).textContent === sel);
            if (!e) throw new Error("no element " + sel); e.click();
          }, s.click);
        }
        if (s.type) { await p.focus(s.type[0]); await p.keyboard.type(s.type[1]); }
        if (s.eval) await p.evaluate(s.eval);
        await new Promise((r) => setTimeout(r, s.wait || 120));
      }
      const r = await p.evaluate(c.expect);
      const errs = await p.evaluate(() => window.__errs.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|load/i.test(e)));
      const text = await p.evaluate(() => document.getElementById("root").innerText);
      const junk = /\{\{|\[object Object\]|undefined|NaN/.exec(text);
      if (r === true && !errs.length && !(junk && !c.allowJunk)) { pass++; }
      else { fail++; fails.push(`${tag}: ${r !== true ? "expect → " + JSON.stringify(r) : ""}${errs.length ? " errors → " + errs.join(" | ") : ""}${junk && !c.allowJunk ? " junk → " + JSON.stringify(junk[0]) : ""}`); }
      if (process.env.SHOT) await p.screenshot({ path: `/tmp/shot/${c.name.replace(/\W+/g, "_")}_${fill ? "c" : "i"}.png`, fullPage: true });
    } catch (e) { fail++; fails.push(`${tag}: threw ${e.message.split("\n")[0]}`); }
    await p.close();
  }
}
await b.close(); srv.close();
console.log(fails.map((f) => "✗ " + f).join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
