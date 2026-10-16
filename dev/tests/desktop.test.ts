// Run: node --experimental-strip-types --no-warnings dev/tests/desktop.test.ts
//
// The desktop shell is a second program that has to agree with this one about a surprising number
// of things: the names of the environment variables it sets, where the bundle's payload ends up,
// which paths the app may write to, what the splash window exposes. Those agreements cannot be
// checked by the Rust compiler from here (and the shell is a separate crate anyway), so they are
// checked here, on the source of both sides. The bundle itself is checked end to end by
// `npm run desktop:smoke`; this suite is the fast, always-on half of the same contract.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const rel = (...parts: string[]) => path.join(root, ...parts);
const read = (...parts: string[]) => fs.readFileSync(rel(...parts), "utf8");
const json = (file: string) => JSON.parse(read(file));
const exists = (...parts: string[]) => fs.existsSync(rel(...parts));

let n = 0;
const t = async (name: string, f: () => void | Promise<void>) => {
  await f();
  n += 1;
  console.log("ok", name);
};

/**
 * The app's modules import each other through the `@/` alias (Next resolves it from tsconfig).
 * Node does not, so the snippets below register the same alias as a resolver hook — the modules
 * under test stay exactly the ones the app ships.
 */
const aliasHooks =
  `const map = (spec) => spec.startsWith("@/") ? ${JSON.stringify(pathToFileURL(rel("src")).href + "/")} + spec.slice(2) + ".ts" : null;` +
  "export async function resolve(spec, ctx, next) { const mapped = map(spec); if (mapped) return next(mapped, ctx); return next(spec, ctx); }";
const prelude = `import { register } from "node:module";\nregister("data:text/javascript," + encodeURIComponent(${JSON.stringify(aliasHooks)}));\n`;

/** Run a snippet in a fresh process with a controlled environment. */
function inFreshProcess(env: Record<string, string>, snippet: string): any {
  const code = prelude + snippet;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_PATH: process.env.NODE_PATH ?? "", ...env },
  });
  if (child.status !== 0) throw new Error(`child failed (${child.status}): ${child.stderr || child.stdout}`);
  return JSON.parse(child.stdout.trim().split("\n").pop() as string);
}

const moduleUrl = (p: string) => pathToFileURL(rel(p)).href;

// ── the environment contract between Rust and src/lib/paths.ts ───────────────────────────────
const shellSources = fs
  .readdirSync(rel("src-tauri", "src"))
  .filter((f) => f.endsWith(".rs"))
  .map((f) => read("src-tauri", "src", f))
  .join("\n");
const pathsSource = read("src", "lib", "paths.ts");

/** Every variable paths.ts consults: direct reads and the ones passed to resolve(). */
const envNames = [
  ...new Set([
    ...[...pathsSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
    ...[...pathsSource.matchAll(/resolve\(\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]),
  ]),
].sort();

await t("the shell sets every variable paths.ts reads", () => {
  assert.ok(envNames.length >= 10, `expected the full contract, found ${envNames.length}`);
  const missing = envNames.filter((name) => !shellSources.includes(`"${name}"`));
  assert.deepEqual(missing, [], `not passed by the shell: ${missing.join(", ")}`);
});

await t("the shell tells the server it is desktop, and where the read-only code root is", () => {
  const server = read("src-tauri", "src", "server.rs");
  assert.match(server, /"APP_MODE"\.into\(\), "desktop"\.into\(\)/, "APP_MODE is not set to desktop");
  // APP_ROOT must point at the server's own directory, never at the app root of the bundle.
  assert.match(server, /"APP_ROOT"\.into\(\), layout\.appserver_dir/);
  // The version the server reports in /api/health comes from the bundle, not from a constant.
  assert.match(server, /"APP_VERSION"\.into\(\), layout\.version\(\)/);
});

await t("desktop paths: absolute values pass through, relative ones anchor at APP_ROOT", async () => {
  const got = inFreshProcess(
    {
      APP_MODE: "desktop",
      APP_ROOT: "/bundle/appserver",
      APP_DATA_DIR: "/home/u/.local/share/dev.bhavyam.minimalist-ai",
      WORKSPACE_DIR: "work",
      WORKSPACE_TEMPLATE_DIR: "/bundle/workspace-template",
      PGLITE_DIR: "data/pglite",
      APP_LOG_DIR: "logs",
      VENV_DIR: "/home/u/.local/share/dev.bhavyam.minimalist-ai/venv",
      PY_REQUIREMENTS: "/bundle/python-requirements.txt",
      ENV_FILE: "config.env",
      APP_VERSION: "9.9.9",
    },
    `const m = await import(${JSON.stringify(moduleUrl("src/lib/paths.ts"))}); console.log(JSON.stringify(m.describePaths()));`
  );
  assert.equal(got.mode, "desktop");
  assert.equal(got.version, "9.9.9");
  assert.equal(got.root, "/bundle/appserver");
  assert.equal(got.data, "/home/u/.local/share/dev.bhavyam.minimalist-ai");
  assert.equal(got.workspace, "/bundle/appserver/work", "a relative override follows the code root");
  assert.equal(got.template, "/bundle/workspace-template");
  assert.equal(got.pglite, "/bundle/appserver/data/pglite");
  assert.equal(got.envFile, "/bundle/appserver/config.env");
});

await t("web mode is untouched: no environment, historical project-relative defaults", async () => {
  const got = inFreshProcess(
    { PWD: root },
    `const m = await import(${JSON.stringify(moduleUrl("src/lib/paths.ts"))}); console.log(JSON.stringify({ paths: m.describePaths(), root: m.APP_ROOT, pglite: m.PGLITE_DIR, venv: m.VENV_DIR }));`
  );
  assert.equal(got.paths.mode, "web");
  assert.equal(got.root, root, "APP_ROOT defaults to the working directory");
  assert.equal(got.paths.workspace, path.join(root, "workspace"));
  assert.equal(got.paths.template, path.join(root, "workspace-template"));
  assert.equal(got.pglite, path.join(root, "data", "pglite"));
  assert.equal(got.venv, path.join(root, ".venv"), "an existing checkout keeps its .venv");
  assert.equal(got.paths.envFile, path.join(root, "config.env"));
});

// ── dev/ sidecars: present in a checkout, copied into the bundle ─────────────────────────────
await t("developer-mode sidecars resolve in a bundle layout and in a checkout layout", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-devfiles-"));
  const bundleDev = path.join(tmp, "appserver", "dev");
  fs.mkdirSync(bundleDev, { recursive: true });
  fs.writeFileSync(path.join(bundleDev, "mock-llm.mjs"), "");
  const elsewhere = path.join(tmp, "cwd");
  fs.mkdirSync(path.join(elsewhere, "dev"), { recursive: true });
  fs.writeFileSync(path.join(elsewhere, "dev", "mock-llm.mjs"), "");

  // The bundle: APP_ROOT is the server directory, and the checkout it was launched from must not
  // win even when the cwd still points at it (the child runs with cwd = the repository root).
  const bundled = inFreshProcess(
    { APP_MODE: "desktop", APP_ROOT: path.join(tmp, "appserver") },
    `const m = await import(${JSON.stringify(moduleUrl("src/lib/devtools.ts"))}); console.log(JSON.stringify({ file: m.devFile("mock-llm.mjs"), missing: m.devFile("no-such-sidecar.py") }));`
  );
  assert.equal(bundled.file, path.join(bundleDev, "mock-llm.mjs"), "the bundle's own dev/ wins over the cwd");
  assert.equal(bundled.missing, null, "a missing sidecar reports null instead of throwing");

  // A checkout: APP_ROOT is not where dev/ lives, the cwd is.
  const checkout = inFreshProcess(
    { APP_MODE: "desktop", APP_ROOT: path.join(tmp, "nowhere") },
    `process.chdir(${JSON.stringify(elsewhere)}); const m = await import(${JSON.stringify(moduleUrl("src/lib/devtools.ts"))}); console.log(JSON.stringify({ file: m.devFile("mock-llm.mjs"), url: m.devFileUrl("mock-llm.mjs") }));`
  );
  assert.equal(checkout.file, path.join(elsewhere, "dev", "mock-llm.mjs"));
  assert.match(checkout.url, /^file:\/\//, "devFileUrl returns a URL import() accepts");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── tauri.conf.json against what prepare.mjs writes ─────────────────────────────────────────
const conf = json("src-tauri/tauri.conf.json");
const cargo = read("src-tauri", "Cargo.toml");
const packageJson = json("package.json");

await t("the bundle ships exactly the payload the shell looks for", () => {
  const resources = Object.keys(conf.bundle.resources).sort();
  assert.deepEqual(resources, [
    "resources/BUILD-INFO.json",
    "resources/appserver",
    "resources/python-requirements.txt",
    "resources/runtime",
    "resources/searxng",
    "resources/workspace-template",
  ]);
  // Every source path is produced by the prepare pipeline; nothing else may creep in.
  const prepare = read("scripts", "desktop", "prepare.mjs");
  for (const source of resources) {
    const bare = source.replace("resources/", "");
    assert.ok(prepare.includes(bare), `${bare} is not assembled by prepare.mjs`);
  }
});

await t("resource target names match the paths layout.rs computes", () => {
  const layout = read("src-tauri", "src", "layout.rs");
  for (const piece of ["appserver", "runtime", "searxng", "workspace-template", "python-requirements.txt", "BUILD-INFO.json"]) {
    assert.ok(layout.includes(`"${piece}"`), `layout.rs never mentions ${piece}`);
  }
  assert.match(layout, /appserver_entry: appserver_dir\.join\("server\.js"\)/);
  assert.match(layout, /node_bin: resources\.join\("runtime"\)\.join\("bin"\)\.join\("node"\)/);
  assert.match(layout, /searxng_src: searxng_dir\.join\("src"\)/);
  assert.match(layout, /searxng_settings_template: searxng_dir\.join\("settings\.yml"\)/);
  // prepare.mjs must put those files where the shell looks.
  const prepare = read("scripts", "desktop", "prepare.mjs");
  for (const target of ["bin/node", "server.js", "settings.yml", "src"]) {
    assert.ok(prepare.includes(target), `prepare.mjs never writes ${target}`);
  }
});

await t("the identifiers and versions on both sides agree", () => {
  assert.match(read("src-tauri", "src", "layout.rs"), new RegExp(`IDENTIFIER: &str = "${conf.identifier.replace(/\./g, "\\.")}"`));
  assert.equal(conf.version, packageJson.version, "the bundle version is the app version");
  assert.equal(conf.mainBinaryName, "minimalist-ai");
  assert.equal(conf.productName, "Minimalist AI Workspace");
});

await t("the shell crate and the CLI the scripts use are the same Tauri", () => {
  const crateVersion = /tauri\s*=\s*\{\s*version\s*=\s*"([^"]+)"/.exec(cargo)?.[1];
  const cliVersion = packageJson.devDependencies?.["@tauri-apps/cli"];
  const buildVersion = /tauri-build\s*=\s*\{\s*version\s*=\s*"([^"]+)"/.exec(cargo)?.[1];
  assert.ok(crateVersion, "no tauri dependency in Cargo.toml");
  assert.ok(cliVersion, "@tauri-apps/cli is not pinned in devDependencies");
  const minor = (v: string) => v.split(".").slice(0, 2).join(".");
  assert.equal(minor(cliVersion), minor(crateVersion), "CLI and crate must be the same minor version");
  assert.match(buildVersion ?? "", /^2\./, "tauri-build missing");
  assert.match(cargo, /rust-version = "1\.9\d"/, "the shell needs a recent toolchain");
  assert.match(cargo, /\[target\.'cfg\(unix\)'\.dependencies\]\s*\nlibc/, "child.rs uses libc for process groups");
});

await t("no plugin permissions: the window reaches the app over HTTP, not IPC", () => {
  const capabilities = json("src-tauri/capabilities/default.json");
  assert.ok(Array.isArray(capabilities.permissions));
  for (const permission of capabilities.permissions) {
    assert.match(String(permission), /^core:/, `a plugin permission slipped in: ${permission}`);
  }
  assert.ok(capabilities.windows.includes("splash"));
  assert.equal(conf.app.withGlobalTauri, false, "the splash is the only window with a webview API");
  assert.equal(conf.app.security.assetProtocol.enable, false, "the app needs no asset protocol");
  assert.deepEqual(conf.app.windows, [], "windows are created by the shell, not the config");
});

await t("every Rust module exists and is wired up", () => {
  const lib = read("src-tauri", "src", "lib.rs");
  const modules = [...lib.matchAll(/^mod ([a-z_]+);/gm)].map((m) => m[1]);
  for (const expected of ["child", "cli", "instance", "layout", "logging", "net", "search", "server", "shell", "tray", "window"]) {
    assert.ok(modules.includes(expected), `lib.rs does not declare ${expected}`);
    assert.ok(exists("src-tauri", "src", `${expected}.rs`), `${expected}.rs is missing`);
  }
  assert.ok(exists("src-tauri", "src", "main.rs"));
  assert.match(read("src-tauri", "src", "main.rs"), /minimalist_ai_lib::run\(\)/);
  // Every tray item and splash call the shell makes has to be defined somewhere.
  const tray = read("src-tauri", "src", "tray.rs");
  assert.match(tray, /TrayIconBuilder/);
  assert.match(tray, /autostart::set_enabled/);
  assert.match(tray, /shell\.stop_all\(\)/);
  const window = read("src-tauri", "src", "window.rs");
  assert.match(window, /CloseRequested/);
  assert.match(window, /prevent_close/);
  assert.match(window, /tray_available/, "closing without a tray must quit instead of hiding");
});

await t("the splash window exposes exactly the hooks the shell calls into it", () => {
  const splash = read("src-tauri", "splash", "index.html");
  const shell = shellSources;
  const called = [...shell.matchAll(/window\.(set[A-Za-z]+)\(/g)].map((m) => m[1]);
  assert.ok(called.length >= 3, `expected the shell to drive the splash, saw ${called.join(", ")}`);
  for (const fn of new Set(called)) {
    assert.ok(splash.includes(`window.${fn} =`), `splash/index.html does not define window.${fn}`);
  }
  // A splash window that needs the network would be a startup failure mode of its own.
  assert.ok(!/src=["']https?:/.test(splash), "the splash must be self-contained");
  assert.ok(!/<script[^>]+src=/.test(splash), "the splash must not load external scripts");
});

await t("bundle targets and Linux dependencies are declared", () => {
  assert.deepEqual(conf.bundle.targets, ["appimage", "deb", "rpm"]);
  const depends = conf.bundle.linux.deb.depends.join(" ");
  assert.match(depends, /libwebkit2gtk-4\.1-0/);
  assert.match(depends, /libgtk-3-0/);
  const rpm = conf.bundle.linux.rpm.depends.join(" ");
  assert.match(rpm, /webkit2gtk4\.1/);
  assert.match(rpm, /gtk3/);
});

// ── icons: generated by scripts/desktop/icons.mjs, consumed by the bundler ───────────────────
await t("every icon the bundle lists exists, in the format its platform needs", () => {
  const pngSize = (file: string): [number, number] => {
    const data = fs.readFileSync(rel("src-tauri", file));
    assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} is not a PNG`);
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  };
  // tauri.conf.json paths are relative to src-tauri/, and this is the full list the bundler needs.
  const expected: Record<string, [number, number]> = {
    "icons/32x32.png": [32, 32],
    "icons/128x128.png": [128, 128],
    "icons/128x128@2x.png": [256, 256],
    "icons/icon.png": [512, 512],
  };
  const listed: string[] = conf.bundle.icon;
  for (const [icon, size] of Object.entries(expected)) {
    assert.ok(listed.includes(icon), `${icon} is not listed in tauri.conf.json`);
    assert.deepEqual(pngSize(icon), size, `${icon} is the wrong size`);
  }
  assert.ok(listed.includes("icons/icon.ico"), "the Windows icon is not listed");
  assert.ok(listed.includes("icons/icon.icns"), "the macOS icon is not listed");

  const ico = fs.readFileSync(rel("src-tauri", "icons", "icon.ico"));
  assert.equal(ico.readUInt16LE(0), 0, "not an icon file");
  assert.equal(ico.readUInt16LE(2), 1, "not an icon file");
  assert.ok(ico.readUInt16LE(4) >= 5, "the .ico should carry several sizes");
  const icns = fs.readFileSync(rel("src-tauri", "icons", "icon.icns"));
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length, "the .icns header length must cover the whole file");
  for (const entry of ["ic07", "ic08", "ic09"]) assert.ok(icns.includes(Buffer.from(entry)), `the .icns has no ${entry} entry`);
});

await t("the icon generator is deterministic and self-contained", () => {
  const source = read("scripts", "desktop", "icons.mjs");
  assert.ok(!/from "(?!node:)/.test(source), "the icon generator must have no dependencies");
  const first = spawnSync(process.execPath, [rel("scripts", "desktop", "icons.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /up to date/, "re-running the generator must not rewrite identical icons");
});

// ── pins ─────────────────────────────────────────────────────────────────────────────────────
await t("the pinned inputs are the ones the scripts actually use", () => {
  const pins = json("scripts/desktop/versions.json");
  assert.match(pins.node.version, /^2[24]\./, "the pinned Node should be a current LTS");
  assert.match(pins.node.githubRelease, /^v\d/, "the Node release tag is how the runtime is fetched");
  assert.match(pins.searxng.commit, /^[0-9a-f]{40}$/, "SearXNG has no release tags: pin the commit");
  assert.match(pins.searxng.repo, /^https:\/\/github\.com\/searxng\/searxng\.git$/);
  // Both provisioning scripts read these pins, rather than carrying their own copies.
  for (const script of ["provision-searxng.mjs", "fetch-runtime.mjs"]) {
    const source = read("scripts", "desktop", script);
    assert.ok(source.includes("versions.json"), `${script} does not read the pins`);
  }
  assert.ok(read("scripts", "desktop", "provision-searxng.mjs").includes("VERSIONS.searxng.commit"), "the SearXNG commit is not taken from the pins");
  assert.ok(read("scripts", "desktop", "fetch-runtime.mjs").includes("VERSIONS.node.version"), "the Node version is not taken from the pins");
  // The settings template the shell copies into the data directory has to be valid YAML-ish and
  // contain the secret placeholder the shell replaces.
  const template = read("scripts", "desktop", "searxng-settings.yml");
  assert.match(template, /secret_key:/);
  assert.match(template, /REPLACED_AT_FIRST_RUN/);
  assert.match(template, /formats:.*json/s, "the JSON API is how the app queries search");
});

// ── the assembled bundle, when it is present (it is git-ignored) ─────────────────────────────
const bundleReady = exists("src-tauri", "resources", "appserver", "server.js");

await t("the assembled bundle matches the shell's expectations", () => {
  if (!bundleReady) {
    console.log("   (bundle not assembled here — run npm run desktop:prepare)");
    return;
  }
  const resources = rel("src-tauri", "resources");
  const info = json(path.join("src-tauri", "resources", "BUILD-INFO.json"));
  assert.equal(info.version, packageJson.version, "BUILD-INFO.json must carry the app version the shell reports");
  assert.equal(info.app, packageJson.name);
  assert.match(String(info.searxng), /^[0-9a-f]{40}$/, "BUILD-INFO.json should record the SearXNG commit it shipped");
  assert.match(String(info.node), /^v\d/, "BUILD-INFO.json should record the Node runtime it shipped");
  for (const file of [
    "appserver/server.js",
    "runtime/bin/node",
    "searxng/src/searx/webapp.py",
    "searxng/settings.yml",
    "workspace-template",
    "python-requirements.txt",
  ]) {
    assert.ok(fs.existsSync(path.join(resources, file)), `${file} is missing from the bundle`);
  }
  assert.ok(fs.statSync(path.join(resources, "runtime", "bin", "node")).mode & 0o111, "the bundled node is not executable");
  // Nothing from the source tree may end up inside the shipped server: prepare.mjs asserts this,
  // repeat it here because it is the difference between an app and a copy of the repository.
  for (const forbidden of ["src", "docs", "test", "tests", "scripts"]) {
    assert.ok(!fs.existsSync(path.join(resources, "appserver", forbidden)), `appserver/${forbidden} should not ship`);
  }
  const devFiles = fs.readdirSync(path.join(resources, "appserver", "dev")).sort();
  assert.deepEqual(devFiles, ["mock-llm.mjs", "samples.py"], "only the two developer-mode sidecars ship");
  // The searxng data directory belongs to the user's home, never to the bundle.
  assert.ok(!fs.existsSync(path.join(resources, "searxng", "settings.yml", "..", "..", "data")), "unexpected data dir");
});

console.log(`\ndesktop.test: ${n} checks ok`);
