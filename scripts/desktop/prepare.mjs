#!/usr/bin/env node
/**
 * Assemble everything the Tauri shell needs into `src-tauri/resources/` — the one build step
 * between "the app runs in a browser" and "the app is a bundle".
 *
 * Layout produced (all of it gitignored, all of it reproducible):
 *   resources/appserver/          the Next.js server as a child process runs it
 *     server.js .next/ node_modules/ public/      (standalone output, cleaned)
 *     vendor/                                      browser libraries for /vendor/<lib>/<file>
 *   resources/runtime/node        pinned Node.js interpreter (bin/node)
 *   resources/searxng/            SearXNG source + python env + settings template (no Docker)
 *   resources/workspace-template/ first-run seed for the workspace
 *   resources/python-requirements.txt   what the data-dir venv is provisioned from
 *   resources/BUILD-INFO.json     versions, commit, timestamps — shown in the app's About/logs
 *
 * Why the standalone output is *cleaned* rather than used as-is: Turbopack's file tracer reacts
 * to runtime-value fs calls and to the optional native node-pty by tracing the entire project
 * (see the note in next.config.ts), so .next/standalone contains src/, dev/, docs/ and friends.
 * None of that is reachable at run time; keeping only the server is what makes the bundle small
 * and the contents predictable.
 *
 *   node scripts/desktop/prepare.mjs [--skip-build] [--only=appserver|runtime|searxng] [--no-searxng]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const RES = path.join(ROOT, "src-tauri", "resources");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const DESKTOP = path.join(ROOT, ".desktop");

const argv = process.argv.slice(2);
const skipBuild = argv.includes("--skip-build");
const noSearxng = argv.includes("--no-searxng") || argv.includes("--skip-searxng");
const only = (argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";

const log = (m) => console.log(`prepare: ${m}`);
const die = (m) => {
  console.error(`prepare: ${m}`);
  process.exit(1);
};
const step = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) die(`\`${cmd} ${args.join(" ")}\` failed (${r.status})`);
};
const want = (part) => !only || only === part;
const readJson = (p, fallback = {}) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};

/** Everything the server needs, and nothing else. */
const APP_SERVER_KEEP = new Set(["server.js", "package.json", ".next", "node_modules", "public", "vendor", ".env"]);

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, dereference: false });
}

/**
 * Replacing a running binary fails with ETXTBSY ("text file busy") on Linux: a previous smoke
 * test, or the app itself, may still be executing the copy we are about to overwrite. Remove the
 * destination first and retry, so `prepare` never fails just because something is still running.
 */
function replaceDir(src, dst) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.rmSync(dst, { recursive: true, force: true });
      copy(src, dst);
      return;
    } catch (e) {
      if (!["ETXTBSY", "EBUSY", "EPERM"].includes(e.code) || attempt === 5) throw e;
      log(`${e.code} replacing ${path.relative(ROOT, dst)} — retrying in 1s (is the app still running?)`);
      spawnSync("sleep", ["1"]);
    }
  }
}

function dirSize(dir) {
  const out = spawnSync("du", ["-sk", dir], { encoding: "utf8" }).stdout || "";
  const kb = Number(out.split(/\s+/)[0]) || 0;
  return `${(kb / 1024).toFixed(0)} MB`;
}

// ── 1. vendor assets + the app build ───────────────────────────────────────────
if (want("appserver")) {
  step("Vendor assets (browser libraries for /vendor)");
  run("node", ["scripts/desktop/vendor-assets.mjs"]);

  if (!skipBuild) {
    step("Next.js build (standalone output)");
    run("npm", ["run", "--silent", "build"]);
  } else {
    log("--skip-build: reusing .next/");
  }
  if (!fs.existsSync(path.join(STANDALONE, "server.js"))) die(".next/standalone/server.js is missing — run without --skip-build");
}

// ── 2. appserver/ ──────────────────────────────────────────────────────────────
if (want("appserver")) {
  step("Assembling resources/appserver");
  const target = path.join(RES, "appserver");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  let copied = 0;
  let dropped = 0;
  for (const entry of fs.readdirSync(STANDALONE)) {
    const from = path.join(STANDALONE, entry);
    if (!APP_SERVER_KEEP.has(entry)) {
      dropped++;
      continue;
    }
    copy(from, path.join(target, entry));
    copied++;
  }
  log(`standalone → appserver: kept ${copied} entries, dropped ${dropped} traced extras`);

  // Next's standalone output never includes .next/static — the docs say to copy it in.
  const staticSrc = path.join(ROOT, ".next", "static");
  if (fs.existsSync(staticSrc)) copy(staticSrc, path.join(target, ".next", "static"));
  else die(".next/static is missing — the build did not finish");

  // Staged vendor libraries travel next to the server (route reads ./vendor).
  copy(path.join(ROOT, "vendor"), path.join(target, "vendor"));

  // The tracer drags in Next's optional image optimizer (sharp/libvips, ~33 MB). The app never
  // uses next/image — check tool screenshots go through puppeteer, PDF/office rendering is
  // client-side — so the binaries are dead weight in an installer.
  for (const waste of ["@img", "sharp"]) {
    const dir = path.join(target, "node_modules", waste);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log(`dropped node_modules/${waste} (unused image optimizer)`);
    }
  }
  // Leftover build directories inside traced packages (tests, docs, source maps).
  const pruneDirs = (root, name) => {
    let n = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (!e.isDirectory()) continue;
        if (e.name === name) {
          fs.rmSync(p, { recursive: true, force: true });
          n++;
          continue;
        }
        walk(p);
      }
    };
    walk(root);
    return n;
  };
  const pruned = pruneDirs(path.join(target, "node_modules"), "__pycache__");
  if (pruned) log(`dropped ${pruned} __pycache__ directories`);

  // node-pty is optional and native, so the tracer skips it; copy it in when it built.
  const pty = path.join(ROOT, "node_modules", "node-pty");
  if (fs.existsSync(pty)) {
    copy(pty, path.join(target, "node_modules", "node-pty"));
    // Its own build left object files and sources behind that the app never loads.
    fs.rmSync(path.join(target, "node_modules", "node-pty", "build"), { recursive: true, force: true });
    fs.rmSync(path.join(target, "node_modules", "node-pty", "src"), { recursive: true, force: true });
    log("node-pty copied (true-pty terminal enabled)");
  } else {
    log("node-pty not installed — the terminal falls back to util-linux `script`");
  }

  // The server's package.json: the standalone build drops the project's own (name, scripts,
  // dependency ranges) next to server.js, and it says more than it should — the app inside the
  // bundle is not an npm project. Write the canonical one instead, so `node -e require(...)`-style
  // lookups still find it and the bundle reports the app's real name and version.
  fs.writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ name: "minimalist-ai-appserver", private: true, version: rootPkg.version ?? "0.0.0" }, null, 2) + "\n"
  );

  // Developer mode is a supported feature, and two of its pieces are files rather than code:
  // the offline mock model and the sample-file generator (src/lib/devtools.ts finds them here).
  const devExtras = ["mock-llm.mjs", "samples.py"];
  for (const name of devExtras) {
    const from = path.join(ROOT, "dev", name);
    if (fs.existsSync(from)) copy(from, path.join(target, "dev", name));
  }
  log(`developer mode extras: ${devExtras.join(", ")}`);

  const stray = ["src", "docs", "test", "temp", "scripts", "agent", ".agents", ".claude", "docker", "workspace-template"].filter((d) => fs.existsSync(path.join(target, d)));
  if (stray.length) die(`appserver still contains project directories: ${stray.join(", ")}`);
  const devDir = path.join(target, "dev");
  const devStray = fs.existsSync(devDir) ? fs.readdirSync(devDir).filter((f) => !devExtras.includes(f)) : [];
  if (devStray.length) die(`appserver/dev contains unexpected files: ${devStray.join(", ")}`);
  log(`appserver ready (${dirSize(target)})`);
}

// ── 3. Node runtime ────────────────────────────────────────────────────────────
if (want("runtime")) {
  step("Node runtime");
  const runtimeOut = path.join(DESKTOP, "runtime");
  if (!fs.existsSync(path.join(runtimeOut, "bin", "node")) && !fs.existsSync(path.join(runtimeOut, "node.exe"))) {
    run("node", ["scripts/desktop/fetch-runtime.mjs"]);
  } else {
    log("runtime already staged (use --force on fetch-runtime.mjs to replace)");
  }
  replaceDir(runtimeOut, path.join(RES, "runtime"));
  const node = path.join(RES, "runtime", "bin", "node");
  // Official Node binaries ship with symbols the app never uses (~16 MB on x64). Stripping is
  // safe and applied to the *bundle copy* so .desktop/runtime stays a stock interpreter.
  if (process.platform !== "win32") {
    const before = fs.statSync(node).size;
    if (spawnSync("strip", [node], { stdio: "ignore" }).status === 0) log(`stripped node: ${(before / 1048576).toFixed(0)} → ${(fs.statSync(node).size / 1048576).toFixed(0)} MB`);
  }
  const version = spawnSync(node, ["--version"], { encoding: "utf8" }).stdout?.trim();
  if (!version) die("the staged Node runtime does not run after copying (this is fatal: the app has no interpreter)");
  log(`runtime ready: ${version} (${dirSize(path.join(RES, "runtime"))})`);
}

// ── 4. SearXNG (no Docker) ─────────────────────────────────────────────────────
if (want("searxng")) {
  step("SearXNG");
  if (noSearxng) {
    log("--no-searxng: search will fall back to the keyless adapters");
    fs.rmSync(path.join(RES, "searxng"), { recursive: true, force: true });
  } else {
    if (!fs.existsSync(path.join(DESKTOP, "searxng", "src", "searx", "webapp.py"))) run("node", ["scripts/desktop/provision-searxng.mjs"]);
    else log("already provisioned (use `npm run desktop:searxng -- --force` to rebuild)");
    const target = path.join(RES, "searxng");
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    copy(path.join(DESKTOP, "searxng", "src"), path.join(target, "src"));
    replaceDir(path.join(DESKTOP, "searxng", "venv"), path.join(target, "venv"));
    // The shipped environment only ever runs granian: pip/setuptools/wheel are build-time tools
    // (~22 MB). The app's *own* python environment for run_python is provisioned separately in
    // the data directory by the shell, so nothing here needs an installer.
    const venvLib = path.join(target, "venv", "lib");
    const sitePack = fs.existsSync(venvLib) ? fs.readdirSync(venvLib).map((d) => path.join(venvLib, d, "site-packages")).find((p) => fs.existsSync(p)) : null;
    if (sitePack) {
      const drop = ["pip", "setuptools", "pkg_resources", "_distutils_hack", "wheel"];
      for (const entry of fs.readdirSync(sitePack)) {
        if (drop.includes(entry) || /^(pip|setuptools|wheel)-.+\.dist-info$/.test(entry)) fs.rmSync(path.join(sitePack, entry), { recursive: true, force: true });
      }
    }
    for (const bin of ["pip", "pip3", "pip3.11"]) {
      fs.rmSync(path.join(target, "venv", "bin", bin), { force: true });
      fs.rmSync(path.join(target, "venv", "Scripts", `${bin}.exe`), { force: true });
    }
    log("trimmed pip/setuptools from the bundled environment");
    for (const extra of ["python", "COMMIT", "VERSION"]) {
      const from = path.join(DESKTOP, "searxng", extra);
      if (fs.existsSync(from)) copy(from, path.join(target, extra));
    }
    copy(path.join(ROOT, "scripts", "desktop", "searxng-settings.yml"), path.join(target, "settings.yml"));
    if (!fs.existsSync(path.join(target, "venv", "bin", "python"))) log("WARNING: no venv in the bundle — the shell will look for system python3");
    log(`searxng ready (${dirSize(target)})`);
  }
}

// ── 5. workspace template, python requirements, build info ─────────────────────
if (want("appserver")) {
  step("Workspace template, python requirements, build info");
  copy(path.join(ROOT, "workspace-template"), path.join(RES, "workspace-template"));
  copy(path.join(ROOT, "requirements.txt"), path.join(RES, "python-requirements.txt"));

  const pkg = rootPkg;
  const searxngMeta = readJson(path.join(DESKTOP, "searxng", "VERSION"));
  const gitSha = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() || "";
  const nodeVersion = spawnSync(path.join(RES, "runtime", "bin", "node"), ["--version"], { encoding: "utf8" }).stdout?.trim() || "";
  const info = {
    app: pkg.name,
    version: pkg.version,
    git: gitSha,
    builtAt: new Date().toISOString(),
    node: nodeVersion,
    searxng: searxngMeta.commit || null,
    searxngPython: searxngMeta.python || null,
    platform: process.platform,
    arch: process.arch,
  };
  fs.writeFileSync(path.join(RES, "BUILD-INFO.json"), JSON.stringify(info, null, 2) + "\n");
  log(JSON.stringify(info));
}

if (!only) {
  step("Done");
  log(`resources in ${path.relative(ROOT, RES)} (${dirSize(RES)})`);
  console.log("  next: npm run desktop:dev    # run the shell against the dev server");
  console.log("        npm run desktop:build  # cargo build + tauri bundle");
}
