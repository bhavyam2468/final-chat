#!/usr/bin/env node
/**
 * Put a Node.js runtime inside `.desktop/runtime/` so the desktop app does not depend on
 * whatever Node the user happens to have (and so the version is the one node-pty was built
 * against — a mismatch only costs the true-pty terminal, which falls back to `script`).
 *
 * Order of preference:
 *   1. `actions/node-versions` GitHub release (a mirror of the official nodejs.org archives that
 *      is reachable from networks that block nodejs.org), pinned in scripts/desktop/versions.json
 *   2. nodejs.org directly
 *   3. the `node` already on PATH, copied in (works because the bundled app runs on the machine
 *      that built it; fine as a fallback, not for redistribution)
 *
 * Every candidate is executed (`node --version`) before it is accepted.
 *
 *   node scripts/desktop/fetch-runtime.mjs [--force] [--platform linux|darwin|win32] [--arch x64|arm64]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".desktop", "runtime");
const VERSIONS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/desktop/versions.json"), "utf8"));
const force = process.argv.includes("--force");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const platform = argOf("--platform", process.platform);
const arch = argOf("--arch", process.arch);
const version = VERSIONS.node.version;

/** Where the runtime lands. Windows ships node.exe next to it, everywhere else node/bin/node. */
const binDir = platform === "win32" ? OUT : path.join(OUT, "bin");
const binName = platform === "win32" ? "node.exe" : "node";
const target = path.join(binDir, binName);
const stamp = path.join(OUT, "VERSION");

const log = (msg) => console.log(`fetch-runtime: ${msg}`);

if (!force && fs.existsSync(target) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === version) {
  const v = spawnSync(target, ["--version"], { encoding: "utf8" }).stdout?.trim();
  if (v === `v${version}`) {
    log(`already present (${v})`);
    process.exit(0);
  }
}

/** The archive name used by both nodejs.org and the actions/node-versions mirror. */
function archiveName(kind) {
  const os_ = platform === "win32" ? "win" : platform;
  if (kind === "zip") return `node-v${version}-${os_}-${arch}.zip`;
  const libc = platform === "linux" ? VERSIONS.node.libc : "";
  return `node-v${version}-${os_}-${arch}${libc ? "-" + libc : ""}.tar.${kind}`;
}

const candidates = [];
if (platform === "linux" && VERSIONS.node.githubRelease) {
  candidates.push({
    name: "github mirror",
    url: `https://github.com/actions/node-versions/releases/download/${VERSIONS.node.githubRelease}/${archiveName("gz")}`,
    kind: "tar.gz",
  });
}
candidates.push({ name: "nodejs.org", url: `https://nodejs.org/dist/v${version}/${archiveName("gz")}`, kind: "tar.gz" });
if (platform === "win32") {
  candidates.push({ name: "nodejs.org (zip)", url: `https://nodejs.org/dist/v${version}/${archiveName("zip")}`, kind: "zip" });
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", ...opts });

/** Unpack into a scratch dir, then move only what the app needs into .desktop/runtime. */
function unpack(archive, kind) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "node-runtime-"));
  if (kind === "zip") {
    if (platform === "win32") run("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${scratch}'`]);
    else run("unzip", ["-q", archive, "-d", scratch]);
  } else {
    run("tar", ["-xzf", archive, "-C", scratch]);
  }
  const top = fs.readdirSync(scratch).map((n) => path.join(scratch, n)).find((p) => fs.statSync(p).isDirectory());
  if (!top) throw new Error("archive did not contain a node directory");
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  if (platform === "win32") {
    // Flat layout on Windows: node.exe + the dlls it needs, nothing else.
    for (const entry of fs.readdirSync(top)) {
      if (/^(node\.exe|.*\.dll)$/i.test(entry) || entry === "LICENSE") fs.copyFileSync(path.join(top, entry), path.join(OUT, entry));
    }
  } else {
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(path.join(top, "bin", "node"), target);
    fs.chmodSync(target, 0o755);
    const lic = path.join(top, "LICENSE");
    if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(OUT, "LICENSE"));
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

/** Copy the running interpreter. Dynamic libraries stay on the machine — acceptable fallback. */
function copySystemNode() {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["node"], { encoding: "utf8" });
  const found = (which.stdout || "").split("\n")[0].trim();
  if (!found || !fs.existsSync(found)) return false;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(found, target);
  fs.chmodSync(target, 0o755);
  return true;
}

let got = false;
for (const candidate of candidates) {
  const archive = path.join(os.tmpdir(), path.basename(candidate.url));
  log(`trying ${candidate.name}: ${candidate.url}`);
  const dl = run("curl", ["-fsSL", "--retry", "2", "--connect-timeout", "20", "-o", archive, candidate.url]);
  if (dl.status !== 0 || !fs.existsSync(archive) || fs.statSync(archive).size < 1_000_000) {
    log(`  … unavailable (${dl.status ?? "?"})`);
    continue;
  }
  try {
    unpack(archive, candidate.kind);
    got = true;
    log(`  … unpacked`);
  } catch (e) {
    log(`  … unpack failed: ${e.message}`);
  } finally {
    fs.rmSync(archive, { force: true });
  }
  if (got) break;
}

if (!got) {
  log("no archive could be downloaded; copying the system node instead");
  if (!copySystemNode()) {
    log("could not find node on PATH either — install Node.js ≥ 20, or run the desktop build on a machine that has one");
    process.exit(1);
  }
}

const check = spawnSync(target, ["--version"], { encoding: "utf8" });
if (check.status !== 0) {
  console.error(`fetch-runtime: the runtime at ${target} does not run:\n${check.stderr || check.stdout}`);
  process.exit(1);
}
fs.writeFileSync(stamp, version + "\n");
// The app's node-pty was compiled against whatever Node built it; record the ABI so the desktop
// verify step can warn before a user discovers a dead pty.
const abi = spawnSync(target, ["-p", "process.versions.modules"], { encoding: "utf8" }).stdout?.trim();
fs.writeFileSync(path.join(OUT, "ABI"), (abi || "") + "\n");
log(`runtime ready: ${target} (${check.stdout.trim()}, ABI ${abi})`);
