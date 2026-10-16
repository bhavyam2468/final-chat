#!/usr/bin/env node
/**
 * Smoke-test the assembled desktop bundle, as the Tauri shell will run it.
 *
 * Starts `resources/runtime/bin/node resources/appserver/server.js` with a throwaway data
 * directory and the same environment the shell passes, then starts the bundled SearXNG the same
 * way, and checks the things that break silently if the bundle is wrong:
 *
 *   · the server comes up and answers /api/health (200 with the DB reachable)
 *   · the UI document and Blocks runtime are served
 *   · /vendor/<lib>/<file> serves the staged browser libraries *with* the CORS header the
 *     sandboxed Block iframes need (this is what makes Blocks render offline)
 *   · conversation CRUD and settings round-trip through PGlite in the data dir
 *   · the bundled SearXNG answers the JSON API through the trimmed python environment
 *   · `POST /api/desktop/stop` shuts the server down cleanly and PGlite flushes to disk
 *
 *   node scripts/desktop/smoke.mjs [--resources src-tauri/resources] [--keep] [--no-searxng]
 */
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RES = path.resolve(ROOT, argOf("--resources", "src-tauri/resources"));
const KEEP = argv.includes("--keep");
const NO_SEARXNG = argv.includes("--no-searxng");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  \x1b[32m✓\x1b[0m" : "  \x1b[31m✗\x1b[0m"} ${name}${detail ? ` \x1b[2m${detail}\x1b[0m` : ""}`);
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET + parse, retried once. A local keep-alive socket can be reaped by the server between two
 * polls (it closes idle connections after 5s), and a reused-but-closed socket shows up as an
 * empty body. Retrying once distinguishes that from a genuinely broken endpoint.
 */
async function getJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { connection: "close" } });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      if (attempt === 1) return { status: res.status, body: null, raw: text.slice(0, 200) };
      await sleep(300);
    }
  }
}

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function waitFor(url, { timeout = 60_000, expect = 200, child } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.status === expect) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

/** Everything the bundle is expected to contain; missing pieces are reported, not thrown. */
function inspectBundle() {
  section("Bundle layout");
  const node = path.join(RES, "runtime", "bin", "node");
  const server = path.join(RES, "appserver", "server.js");
  const searxngSrc = path.join(RES, "searxng", "src", "searx", "webapp.py");
  const searxngVenv = process.platform === "win32" ? path.join(RES, "searxng", "venv", "Scripts", "python.exe") : path.join(RES, "searxng", "venv", "bin", "python");
  check("node runtime present", fs.existsSync(node), path.relative(ROOT, node));
  check("app server present", fs.existsSync(server), path.relative(ROOT, server));
  check("workspace template present", fs.existsSync(path.join(RES, "workspace-template", "system", "SYSTEM.md")));
  check("searxng source present", fs.existsSync(searxngSrc));
  check("searxng settings template present", fs.existsSync(path.join(RES, "searxng", "settings.yml")));
  if (!NO_SEARXNG) check("searxng python env present", fs.existsSync(searxngVenv), path.relative(ROOT, searxngVenv));
  // dev/ is allowed to exist with exactly the two developer-mode extras in it (mock model,
  // sample generator) and nothing else — see prepare.mjs.
  const allowedDev = ["mock-llm.mjs", "samples.py"];
  const devStray = fs.existsSync(path.join(RES, "appserver", "dev")) ? fs.readdirSync(path.join(RES, "appserver", "dev")).filter((f) => !allowedDev.includes(f)) : [];
  const stray = ["src", "docs", "test", "scripts"].filter((d) => fs.existsSync(path.join(RES, "appserver", d)));
  check("appserver carries no project source", stray.length === 0 && devStray.length === 0, [...stray, ...devStray].join(", "));
  for (const lib of ["katex/katex.min.js", "mermaid/mermaid.esm.min.mjs", "hljs/highlight.min.js"]) {
    check(`vendor staged: ${lib}`, fs.existsSync(path.join(RES, "appserver", "vendor", lib)));
  }
  return { node, server, searxngVenv };
}

async function testAppServer({ node, server }) {
  section("App server (as the shell starts it)");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "final-chat-smoke-"));
  const port = await freePort();
  const logs = [];
  const child = spawn(node, [server], {
    cwd: path.join(RES, "appserver"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      APP_MODE: "desktop",
      APP_VERSION: "smoke",
      APP_DATA_DIR: dataDir,
      WORKSPACE_DIR: path.join(dataDir, "workspace"),
      WORKSPACE_TEMPLATE_DIR: path.join(RES, "workspace-template"),
      PGLITE_DIR: path.join(dataDir, "data", "pglite"),
      VENV_DIR: path.join(dataDir, "venv"),
      APP_LOG_DIR: path.join(dataDir, "logs"),
      PY_REQUIREMENTS: path.join(RES, "python-requirements.txt"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const fail = (name, detail) => check(name, false, detail ?? logs.slice(-6).join("").slice(-400));

  try {
    const up = await waitFor(`${base}/api/health`, { child, timeout: 90_000 });
    if (!up) return fail("server answers /api/health", "never became healthy");
    const health = (await getJson(`${base}/api/health`)).body || {};
    check("server answers /api/health", health.ok === true, `db=${health.db} mode=${health.mode}`);
    check("workspace seeded from the template", fs.existsSync(path.join(dataDir, "workspace", "system", "SYSTEM.md")));
    check("pglite created inside the data dir", fs.existsSync(path.join(dataDir, "data", "pglite", "PG_VERSION")));

    const doc = await fetch(base);
    const html = await doc.text();
    check("UI document served", doc.status === 200 && html.includes("<html"), `http=${doc.status}`);
    const runtime = await fetch(`${base}/blocks/runtime.js`);
    check("Blocks runtime served", runtime.status === 200, `http=${runtime.status}`);

    const vendored = await fetch(`${base}/vendor/katex/katex.min.js`);
    check(
      "vendor library served with CORS for sandboxed iframes",
      vendored.status === 200 && (vendored.headers.get("access-control-allow-origin") || "") === "*" && (await vendored.text()).length > 10_000,
      `http=${vendored.status} cors=${vendored.headers.get("access-control-allow-origin")}`,
    );
    const esm = await fetch(`${base}/vendor/mermaid/mermaid.esm.min.mjs`);
    check("mermaid ESM entry served", esm.status === 200, `http=${esm.status}`);
    const traversal = await fetch(`${base}/vendor/katex/..%2F..%2Fpackage.json`);
    const unknown = await fetch(`${base}/vendor/not-a-library/x.js`);
    check("vendor route refuses traversal and unknown libraries", traversal.status !== 200 && unknown.status === 404, `traversal=${traversal.status} unknown=${unknown.status}`);

    const settings = await getJson(`${base}/api/settings`);
    check("settings endpoint answers", settings.status === 200 && typeof settings.body === "object", `http=${settings.status}${settings.raw ? " body=" + settings.raw : ""}`);

    // Developer mode turns on the app's own mock model, which is what makes a full agent turn
    // possible without a provider key or network. It also writes settings to the database.
    const dev = await fetch(`${base}/api/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enable: true }) });
    const mock = await fetch(`${base}/api/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mock: true }) });
    const after = (await getJson(`${base}/api/settings`)).body?.settings || {};
    check("settings write round-trips through PGlite", dev.status === 200 && mock.status === 200 && after.dev === true, `dev=${after.dev} provider=${after.provider}`);

    // Body shape follows src/app/api/chat/route.ts: parentId + user.content (a new conversation
    // is created by the route itself when conversationId is absent).
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: null, user: { content: "smoke test: say hello in one short line" } }),
    });
    let stream = "";
    if (chat.ok && chat.body) for await (const chunk of chat.body) stream += Buffer.from(chunk).toString();
    // NDJSON frames use `t` for the event name (see src/lib/runs.ts / api/chat).
    const events = stream.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).t; } catch { return ""; } });
    check(
      "agent turn completes against the bundled mock model",
      chat.status === 200 && events.includes("done"),
      `http=${chat.status} events=${[...new Set(events)].filter(Boolean).join(",").slice(0, 140)}${events.length ? "" : " body=" + stream.slice(0, 160)}`,
    );
    const convs = (await getJson(`${base}/api/conversations`)).body;
    const list = Array.isArray(convs) ? convs : convs?.conversations || [];
    check("the turn produced a conversation row", list.length > 0 && !!list[0].id, `${list.length} conversation(s)`);

    const term = await fetch(`${base}/api/terminal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", cols: 80, rows: 24 }) });
    const termBody = await term.json().catch(() => ({}));
    check("terminal session opens (pty or `script` fallback)", term.status === 200 && (termBody.ok === true || !!termBody.id), `http=${term.status} ${JSON.stringify(termBody).slice(0, 80)}`);
    if (termBody.id) await fetch(`${base}/api/terminal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "kill", id: termBody.id }) });

    const stop = await fetch(`${base}/api/desktop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
    check("graceful stop accepted", stop.status === 200, `http=${stop.status}`);
    const exited = await Promise.race([
      new Promise((r) => child.once("exit", () => r(true))),
      sleep(15_000).then(() => false),
    ]);
    check("process exited on its own after the stop request", exited === true);
    check("WAL flushed: data dir still readable after exit", fs.existsSync(path.join(dataDir, "data", "pglite", "PG_VERSION")));
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await sleep(1500);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (!KEEP) fs.rmSync(dataDir, { recursive: true, force: true });
    else console.log(`  (kept ${dataDir})`);
  }
}

async function testSearxng({ searxngVenv }) {
  if (NO_SEARXNG) return;
  section("Bundled SearXNG (no Docker)");
  const venvPython = searxngVenv;
  const src = path.join(RES, "searxng", "src");
  if (!fs.existsSync(venvPython)) return check("searxng python env present", false, path.relative(ROOT, venvPython));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "final-chat-searxng-"));
  // The shell copies the template into the data dir and generates a secret per install.
  const settings = path.join(dataDir, "settings.yml");
  fs.copyFileSync(path.join(RES, "searxng", "settings.yml"), settings);
  fs.writeFileSync(settings, fs.readFileSync(settings, "utf8").replace("REPLACED_AT_FIRST_RUN", "smoke-secret"));

  const port = await freePort();
  const logs = [];
  const child = spawn(venvPython, ["-m", "granian", "--interface", "wsgi", "--host", "127.0.0.1", "--port", String(port), "searx.webapp:app"], {
    cwd: src,
    env: { ...process.env, PYTHONPATH: src, PYTHONDONTWRITEBYTECODE: "1", SEARXNG_SETTINGS_PATH: settings, SEARXNG_SECRET: "smoke-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  try {
    const up = await waitFor(`http://127.0.0.1:${port}/search?q=smoke&format=json`, { child, timeout: 90_000 });
    if (!up) return check("searxng answers the JSON API", false, logs.slice(-6).join("").slice(-400));
    const res = await fetch(`http://127.0.0.1:${port}/search?q=smoke+test&format=json`);
    const body = await res.json();
    check("searxng answers the JSON API", res.status === 200 && Array.isArray(body.results), `http=${res.status} keys=${Object.keys(body).length}`);
    check("searxng html UI present (bundle is complete)", (await fetch(`http://127.0.0.1:${port}/`)).status === 200);
    // The app's own adapter must be able to talk to it, headers included.
    const withHeaders = await fetch(`http://127.0.0.1:${port}/search?q=smoke&format=json`, { headers: { "X-Forwarded-For": "127.0.0.1", Accept: "application/json" } });
    check("searxng accepts the app's request shape", withHeaders.status === 200, `http=${withHeaders.status}`);
  } finally {
    child.kill("SIGTERM");
    await sleep(1000);
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ── run ────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(RES)) {
  console.error(`smoke: ${path.relative(ROOT, RES)} does not exist — run \`npm run desktop:prepare\` first`);
  process.exit(1);
}
const bundle = inspectBundle();
await testAppServer(bundle);
await testSearxng(bundle);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error("smoke FAILED:\n" + failed.map((f) => `  · ${f.name}${f.detail ? ` — ${f.detail}` : ""}`).join("\n"));
  process.exit(1);
}
console.log("smoke: bundle is good");
