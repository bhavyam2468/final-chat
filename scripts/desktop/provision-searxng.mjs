#!/usr/bin/env node
/**
 * Provision the bundled SearXNG — no Docker.
 *
 * Result (`.desktop/searxng/`, copied into the app bundle by prepare.mjs):
 *   src/            SearXNG source at the pinned commit
 *   venv/           python environment with SearXNG's requirements + granian (the WSGI server
 *                   SearXNG's own container uses: `granian searx.webapp:app`)
 *   python/         optional relocatable interpreter (only when versions.json enables it)
 *   VERSION         what exactly was provisioned, for `desktop:check` and bug reports
 *
 * The app starts it as `venv/bin/python -m granian …` — deliberately through the interpreter and
 * never through `venv/bin/granian`, whose shebang contains the absolute build-time venv path and
 * therefore breaks the moment the bundle is installed somewhere else. `python -m` resolves the
 * environment from the binary's own location, so the whole directory is relocatable.
 *
 *   node scripts/desktop/provision-searxng.mjs [--force] [--check] [--no-smoke]
 */
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".desktop", "searxng");
const SRC = path.join(OUT, "src");
const VENV = path.join(OUT, "venv");
const PY_DIR = path.join(OUT, "python");
const VERSIONS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/desktop/versions.json"), "utf8"));
const SETTINGS_TEMPLATE = path.join(ROOT, "scripts/desktop/searxng-settings.yml");

const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");
const noSmoke = process.argv.includes("--no-smoke");
const log = (m) => console.log(`searxng: ${m}`);
const die = (m) => {
  console.error(`searxng: ${m}`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
const quiet = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

/** Where the venv's interpreter lives once it exists (Windows keeps it under Scripts/). */
const venvPython = () => (process.platform === "win32" ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python"));

/** The bundled relocatable interpreter, if it was unpacked. */
const bundledPython = () => (process.platform === "win32" ? path.join(PY_DIR, "python.exe") : path.join(PY_DIR, "bin", "python3"));

/**
 * Interpreter to *build* the venv with: bundled, else the system one. Never the venv's own
 * python — that is the thing being created, and on a rebuild it has just been deleted.
 */
const basePython = () => {
  const bundled = bundledPython();
  if (fs.existsSync(bundled)) return bundled;
  for (const candidate of ["python3", "python"]) {
    const found = quiet(process.platform === "win32" ? "where" : "which", [candidate]).stdout?.split("\n")[0].trim();
    if (found) return found;
  }
  return null;
};

/** SearXNG needs ≥ 3.10 (it uses modern typing syntax at import time). */
function checkSystemPython(bin) {
  const r = quiet(bin, ["-c", "import sys;print('%d.%d' % sys.version_info[:2])"]);
  if (r.status !== 0) return null;
  const [maj, min] = r.stdout.trim().split(".").map(Number);
  if (maj < 3 || (maj === 3 && min < 10)) return null;
  return r.stdout.trim();
}

/** Optional relocatable interpreter, unpacked from python-build-standalone. */
function fetchStandalonePython() {
  const spec = VERSIONS.python?.standalone;
  if (!spec?.tag) return null;
  if (process.platform !== "linux" && process.platform !== "darwin") return null;
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const triple = `${arch}-${process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu"}`;
  const name = `cpython-${spec.version}+${spec.tag}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${spec.tag}/${name}`;
  const archive = path.join(os.tmpdir(), name);
  log(`fetching bundled python: ${url}`);
  if (run("curl", ["-fsSL", "--retry", "2", "--connect-timeout", "20", "-o", archive, url]).status !== 0) {
    log("bundled python unavailable — falling back to the system python3");
    return null;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "searxng-py-"));
  if (run("tar", ["-xzf", archive, "-C", scratch]).status !== 0) return null;
  const top = fs.readdirSync(scratch).map((n) => path.join(scratch, n)).find((p) => fs.statSync(p).isDirectory());
  fs.rmSync(PY_DIR, { recursive: true, force: true });
  fs.renameSync(path.join(top, "python"), PY_DIR);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  return pyBin();
}

function searxngCommit() {
  return VERSIONS.searxng.commit;
}

/** Fetch exactly the pinned commit (shallow), falling back to the branch tip with a loud note. */
function fetchSource() {
  const commit = searxngCommit();
  const stamp = path.join(OUT, "COMMIT");
  if (!force && fs.existsSync(path.join(SRC, "searx", "webapp.py")) && fs.existsSync(stamp)) {
    const have = fs.readFileSync(stamp, "utf8").trim();
    if (have === commit) {
      log(`source already at ${commit.slice(0, 8)}`);
      return;
    }
  }
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.mkdirSync(SRC, { recursive: true });
  log(`fetching SearXNG ${commit.slice(0, 8)}`);
  const steps = [
    ["init", "--quiet"],
    ["remote", "add", "origin", VERSIONS.searxng.repo],
    ["fetch", "--quiet", "--depth", "1", "origin", commit],
    ["checkout", "--quiet", "FETCH_HEAD"],
  ];
  for (const args of steps) {
    if (run("git", ["-C", SRC, ...args]).status !== 0) {
      log(`  fetching that exact commit failed; falling back to the branch tip`);
      fs.rmSync(SRC, { recursive: true, force: true });
      if (run("git", ["clone", "--quiet", "--depth", "1", VERSIONS.searxng.repo, SRC]).status !== 0) die("could not clone SearXNG");
      break;
    }
  }
  // Record the commit *before* .git goes away: afterwards this directory is no longer a
  // repository and `git rev-parse` would walk up into the enclosing project and lie.
  const head = quiet("git", ["-C", SRC, "rev-parse", "HEAD"]).stdout?.trim() || "unknown";
  // Runtime needs searx/ and the requirement lists; drop the tooling around it.
  for (const junk of [".git", ".github", "tests", "docs", "client", "container", "utils", "mise.toml", "go.mod", "go.sum", "pyrightconfig.json", "babel.cfg"]) {
    fs.rmSync(path.join(SRC, junk), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(OUT, "COMMIT"), head + "\n");
  log(`source ready (${head === commit ? commit.slice(0, 8) : head.slice(0, 8) + " — NOT the pinned commit"})`);
}

/** Requirements + granian, into a fresh venv. Uses the interpreter the bundle will ship. */
function buildVenv(python) {
  const py = venvPython();
  // A venv whose interpreter vanished (deleted, moved, replaced by a --force run) must be rebuilt.
  const usable = fs.existsSync(py) && quiet(py, ["-c", "import sys"]).status === 0;
  if (!usable) {
    fs.rmSync(VENV, { recursive: true, force: true });
    log("creating the python environment");
    if (run(python, ["-m", "venv", VENV]).status !== 0) die(`could not create a venv with ${python}`);
  } else if (quiet(py, ["-c", "import granian, flask, yaml, lxml"]).status === 0) {
    // Nothing to do: a usable environment with the server and its dependencies already in place.
    // (Re-running the installer on every build would add a minute to every prepare for no gain.)
    log("python environment already provisioned");
    return py;
  }
  const reqs = ["requirements.txt", "requirements-server.txt"].map((f) => path.join(SRC, f)).filter((f) => fs.existsSync(f));
  if (!reqs.length) die("SearXNG requirements are missing from the fetched source");
  log("installing requirements (pyyaml, lxml, flask, granian…)");
  if (run(py, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--upgrade", "pip"]).status !== 0) die("pip bootstrap failed");
  for (const req of reqs) {
    if (run(py, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", req]).status !== 0) die(`pip install -r ${path.basename(req)} failed`);
  }
  return py;
}

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });

/** Start it the way the app will and require a JSON answer. Falls back to a clear warning. */
async function smokeTest(venvPython) {
  const port = await freePort();
  const settings = path.join(os.tmpdir(), `searxng-smoke-${process.pid}.yml`);
  fs.copyFileSync(SETTINGS_TEMPLATE, settings);
  log(`smoke test on 127.0.0.1:${port}`);
  const child = spawn(venvPython, ["-m", "granian", "--interface", "wsgi", "--host", "127.0.0.1", "--port", String(port), "searx.webapp:app"], {
    cwd: SRC,
    env: { ...process.env, PYTHONPATH: SRC, PYTHONDONTWRITEBYTECODE: "1", SEARXNG_SETTINGS_PATH: settings, SEARXNG_SECRET: "smoke-test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const deadline = Date.now() + 45_000;
  let ok = false;
  while (Date.now() < deadline && !ok) {
    await new Promise((r) => setTimeout(r, 750));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/search?q=desktop+bundle+smoke&format=json`, { signal: AbortSignal.timeout(5000) });
      ok = res.status === 200 && typeof (await res.json()).results !== "undefined";
    } catch {}
    if (child.exitCode !== null) break;
  }
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (child.exitCode === null) child.kill("SIGKILL");
  fs.rmSync(settings, { force: true });
  if (!ok) {
    log("smoke test FAILED — the bundled instance did not answer with JSON");
    console.error(out.split("\n").slice(-25).join("\n"));
    return false;
  }
  log("smoke test ok (HTTP 200, JSON)");
  return true;
}

async function main() {
  if (checkOnly) {
    const problems = [];
    if (!fs.existsSync(path.join(SRC, "searx", "webapp.py"))) problems.push("source missing (src/searx/webapp.py)");
    const py = venvPython();
    if (!fs.existsSync(py)) problems.push("python environment missing");
    else if (quiet(py, ["-m", "granian", "--version"]).status !== 0) problems.push("granian is not installed in the environment");
    if (!fs.existsSync(path.join(OUT, "VERSION"))) problems.push("VERSION stamp missing");
    if (problems.length) {
      console.error("searxng: not provisioned —\n  " + problems.join("\n  ") + "\n  run `npm run desktop:searxng`");
      process.exit(1);
    }
    const stamp = JSON.parse(fs.readFileSync(path.join(OUT, "VERSION"), "utf8"));
    log(`ok — ${stamp.commit?.slice(0, 8)} · python ${stamp.python} · ${stamp.provisionedAt}`);
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  if (force) {
    fs.rmSync(VENV, { recursive: true, force: true });
    log("rebuilding from scratch (--force)");
  }
  let python = fs.existsSync(bundledPython()) ? bundledPython() : fetchStandalonePython();
  if (!python) {
    const system = basePython();
    if (!system) die("no python3 found — install python (Arch: `sudo pacman -S python`) or set a python in versions.json");
    const v = checkSystemPython(system);
    if (!v) die(`${system} is older than python 3.10, which SearXNG requires`);
    log(`using the system interpreter ${system} (python ${v})`);
    python = system;
  } else {
    log(`using the bundled interpreter ${python}`);
  }

  fetchSource();
  const py = buildVenv(python);

  const version = quiet(py, ["-c", "import sys;print('%d.%d.%d' % sys.version_info[:3])"]).stdout?.trim() || "unknown";
  const pkgs = (quiet(py, ["-m", "pip", "freeze"]).stdout || "").split("\n").filter(Boolean);
  const meta = {
    commit: fs.existsSync(path.join(OUT, "COMMIT")) ? fs.readFileSync(path.join(OUT, "COMMIT"), "utf8").trim() : VERSIONS.searxng.commit,
    pinned: searxngCommit(),
    python: version,
    interpreter: path.relative(OUT, py),
    provisionedAt: new Date().toISOString(),
    packages: pkgs.length,
  };
  fs.writeFileSync(path.join(OUT, "VERSION"), JSON.stringify(meta, null, 2) + "\n");

  if (!noSmoke) {
    const ok = await smokeTest(py);
    if (!ok) die("the provisioned instance is not usable (see the log above)");
  }
  const size = quiet("du", ["-sh", OUT]).stdout?.split("\t")[0];
  log(`done — ${meta.packages} packages · ${size || ""} · ${OUT}`);
}

await main();
