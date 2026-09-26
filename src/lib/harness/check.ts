import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { Settings } from "../settings";
import { runShell } from "../exec";
import { slopLint, blocksLint, fmtIssues, Issue } from "./slop";

/** Component names the BlocksUI runtime really defines (read from the shipped runtime, never drifts). */
let known: Set<string> | null = null;
export function blocksTags() {
  if (!known) {
    known = new Set<string>();
    for (const f of ["elements.js", "runtime.js"]) {
      try { for (const m of fs.readFileSync(path.join(process.cwd(), "public/blocks", f), "utf8").matchAll(/["'`](x-[a-z0-9-]+)["'`]/g)) known.add(m[1]); } catch {}
    }
  }
  return known;
}

const UI_EXT = /\.(html?|css|jsx|tsx|vue|svelte|ui|md)$/i;
const kindOf = (f: string) => { const e = path.extname(f).slice(1).toLowerCase(); return e === "htm" ? "html" : e; };

/** Lint files/snippets for slop. Returns formatted findings ("" when clean). */
export async function lintFiles(files: { path: string; abs: string }[], brief = "") {
  const lines: string[] = [];
  for (const f of files) {
    if (!UI_EXT.test(f.path)) continue;
    const text = await fsp.readFile(f.abs, "utf8").catch(() => "");
    if (!text) continue;
    const k = kindOf(f.path);
    const issues: Issue[] = k === "ui" ? blocksLint(text, blocksTags(), { brief }) : slopLint(text, k, { brief });
    if (issues.length) lines.push(fmtIssues(issues, f.path));
  }
  return lines.join("\n");
}
export function lintChat(text: string, brief = "") {
  const out: string[] = [];
  for (const m of text.matchAll(/<ui[^>]*>([\s\S]*?)<\/ui>/g)) { const i = blocksLint(m[1], blocksTags(), { brief }); if (i.length) out.push(fmtIssues(i, "<ui>")); }
  return out.join("\n");
}

type Step = { label: string; cmd: string; timeout?: number };
/** Detect project type(s) under dir and pick fast verification commands. */
export function planChecks(abs: string, want: string): Step[] {
  const has = (f: string) => fs.existsSync(path.join(abs, f));
  const steps: Step[] = [];
  const all = want === "all" || !want;
  if (has("package.json")) {
    let pkg: { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> } = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(abs, "package.json"), "utf8")); } catch {}
    const sc = pkg.scripts || {};
    const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
    if (!has("node_modules")) steps.push({ label: "install", cmd: `${pm} install`, timeout: 600 });
    if ((all || want === "types") && has("tsconfig.json")) steps.push({ label: "types", cmd: sc.typecheck ? `${pm} run typecheck` : "npx --no-install tsc --noEmit -p .", timeout: 300 });
    if ((all || want === "lint") && sc.lint) steps.push({ label: "lint", cmd: `${pm} run lint`, timeout: 300 });
    if ((want === "test" || want === "all") && sc.test && !/no test specified/.test(sc.test)) steps.push({ label: "test", cmd: `${pm} test`, timeout: 600 });
    if (want === "build" && sc.build) steps.push({ label: "build", cmd: `${pm} run build`, timeout: 900 });
  }
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py") || fs.readdirSync(abs).some((f) => f.endsWith(".py"))) {
    if (all || want === "types" || want === "lint") steps.push({ label: "python syntax", cmd: `python3 -m compileall -q -x '(\\.venv|node_modules|\\.git)' . >/dev/null && echo ok`, timeout: 120 });
    if (all || want === "lint") steps.push({ label: "ruff", cmd: "command -v ruff >/dev/null && ruff check --quiet . || echo '(ruff not installed; skipped)'", timeout: 120 });
    if (want === "test" || want === "all") steps.push({ label: "pytest", cmd: "python3 -m pytest -q -x 2>&1 | tail -30", timeout: 600 });
  }
  if (has("go.mod")) { steps.push({ label: "go vet", cmd: "go vet ./...", timeout: 300 }); if (want === "build" || all) steps.push({ label: "go build", cmd: "go build ./...", timeout: 600 }); if (want === "test") steps.push({ label: "go test", cmd: "go test ./...", timeout: 600 }); }
  if (has("Cargo.toml")) { steps.push({ label: "cargo check", cmd: "cargo check -q --message-format short", timeout: 900 }); if (want === "test") steps.push({ label: "cargo test", cmd: "cargo test -q", timeout: 900 }); }
  if (has("gradlew")) steps.push({ label: "gradle", cmd: has("app/src/main/AndroidManifest.xml") ? "./gradlew -q assembleDebug" : "./gradlew -q build -x test", timeout: 1200 });
  else if (has("pom.xml")) steps.push({ label: "maven", cmd: "mvn -q -DskipTests package", timeout: 1200 });
  if (has("project.yml") && process.platform === "darwin") steps.push({ label: "xcodegen", cmd: "xcodegen generate -q && xcodebuild -quiet -scheme \"$(ls *.xcodeproj | head -1 | sed 's/.xcodeproj//')\" -destination 'generic/platform=iOS Simulator' build", timeout: 1200 });
  return steps;
}

/** Keep the useful part of long tool output: error lines first, then the tail. */
export function condense(out: string, max = 2500) {
  if (out.length <= max) return out.trim();
  const lines = out.split("\n");
  const err = lines.filter((l) => /error|fail|✗|panic|exception|cannot|undefined|not found|expected/i.test(l)).slice(0, 40);
  const tail = lines.slice(-15);
  return [...new Set([...err, "…", ...tail])].join("\n").slice(0, max);
}

export async function runChecks(st: Settings, abs: string, want: string, host: boolean) {
  const steps = planChecks(abs, want);
  if (!steps.length) return { ok: true, report: "No project checks detected (no package.json/pyproject/go.mod/Cargo.toml/gradle)." };
  const out: string[] = [];
  let ok = true;
  for (const s of steps) {
    const r = await runShell(st, s.cmd, (s.timeout || 300) * 1000, host, abs);
    const pass = r.code === 0;
    ok &&= pass || s.label === "ruff";
    out.push(`${pass ? "✓" : "✗"} ${s.label} (${s.cmd})${pass ? "" : "\n" + condense(r.out)}`);
    if (!pass && s.label === "install") break;
  }
  return { ok, report: out.join("\n") };
}
