import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const PUB = path.resolve("public");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(PUB, u);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", (MIME[path.extname(f)] || "application/octet-stream") + (/\.(js|css|html)$/.test(f) ? "; charset=utf-8" : ""));
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;
const VARS = "--bg:#1f1e1c;--fg:#e8e4dc;--muted:#9a958c;--faint:#6b675f;--line:rgba(255,255,255,.1);--surface:rgba(255,255,255,.04);--bubble:#2b2a27;--float:#2b2a27;--accent:#d97757;--success:#7c9a6d;--danger:#c0645a;--warning:#c29a4a;--info:#6f8a9c;--r:12px";
const src = `<x-stack>
<x-flow title="Sign-in flow" height="380">start[round]: Open the app
check[decision]: Signed in?
ok: Dashboard
signup: Create account
bad[decision,danger]: 3 failed attempts?
lock[tone-warning]: Locked for 15 min
log[data]: auth.log
start -> check
check -> ok: yes
check -> signup: no
signup => check
check -.-> bad
bad -> lock: yes
bad -> ok: no
lock -> log
</x-flow>
<x-row>
<x-steps>Collect sources | 5 papers | done
Draft the outline | three sections | now
Write the draft | long form | todo
! Check the numbers | unverified | warn
x Publish | blocked on review | fail</x-steps>
<x-tree open="2">Report | draft 3
  Introduction
    Hook | first line
    Scope
  Method
    Sample
  Results
</x-tree>
</x-row>
<x-list ordered>First law | inertia | 1687
! Second law | force = mass x acceleration | 1687
? Third law | action and reaction | 1687
* Conservation | energy is never lost | -
</x-list>
</x-stack>`;
const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="${ORIGIN}/blocks/runtime.css"><style>:root{${VARS}}html{background:var(--bg)}body{max-width:820px;margin:0 auto;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui}</style></head><body data-theme="dark"><div id="root"></div><script>window.BLOCKS_ORIGIN=${JSON.stringify(ORIGIN)};window.parent.postMessage=function(){};</script><script src="${ORIGIN}/blocks/runtime.js"></script><script src="${ORIGIN}/blocks/elements.js"></script><script src="${ORIGIN}/blocks/flow.js"></script><script>Blocks.render(${JSON.stringify(src).replace(/</g, "\\u003c")})</script></body></html>`;
const puppeteer = (await import("puppeteer-core")).default;
const b = await puppeteer.launch({ executablePath: "/tmp/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--single-process", "--disable-gpu"], headless: true, defaultViewport: { width: 900, height: 1200, deviceScaleFactor: 2 } });
const p = await b.newPage();
await p.goto(`${ORIGIN}/blocks/runtime.css`);
await p.setContent(html, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
const issues = await p.evaluate(() => window.__issues || null);
console.log("issues:", JSON.stringify(issues));
const file = process.argv[2] || "/tmp/shots/blocks.png";
await p.screenshot({ path: file, fullPage: true });
console.log("wrote", file);
await b.close(); srv.close();
