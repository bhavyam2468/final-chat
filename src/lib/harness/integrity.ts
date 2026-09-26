/**
 * Code-integrity check on files the agent changed this turn (before vs after). Catches the documented
 * reward hacks and lazy fixes: suppressing errors, skipping tests, empty catch blocks, stubs left as
 * "done", hardcoded secrets, special-casing tests, and editing tests the user never asked to change
 * (Claude 3.7 system card §6; ImpossibleBench 2025; METR). Counts only what the turn ADDED. Pure; unit-tested.
 */
import type { Issue } from "./slop";

const count = (re: RegExp, s: string) => (s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;

const SUPPRESS = /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|#\s*type:\s*ignore|#\s*noqa|#\s*pylint:\s*disable|@SuppressWarnings|#!?\[allow\(|\/\/\s*nolint|as\s+any\b|:\s*any\b/;
const SKIP = /\b(it|test|describe)\.(skip|only|todo)\(|\bx(it|describe|test)\(|@pytest\.mark\.(skip|xfail)|@unittest\.skip|\bt\.Skip\(|#\[ignore\]|\.skip\s*=\s*true/;
const EMPTY_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*\}|except(\s+[\w.]+(\s+as\s+\w+)?)?\s*:\s*(#[^\n]*)?\n?\s*pass\b|\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|undefined)\s*\)/;
const STUB = /TODO:?\s*implement|NotImplementedError|throw new Error\(["'`](not implemented|todo)|\/\/\s*your code here|#\s*your code here|unimplemented!\(|todo!\(\)|panic\(["']TODO|\bpass\s*#\s*TODO|return\s+(null|None|0|""|\[\]|\{\})\s*;?\s*(\/\/|#)\s*(TODO|placeholder|stub)/i;
const HACK = /special[- ]?case for (the )?tests?|hack(ed)? to (make|pass)|make (the )?tests? pass|hard-?coded? (for|to pass) (the )?tests?|to satisfy the (test|grader)/i;
const SECRET = /AIza[0-9A-Za-z_-]{35}|\bsk-(proj-|ant-)?[A-Za-z0-9_-]{24,}|\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_\w{40,}|\bxox[baprs]-[\w-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|\bfc-[0-9a-f]{32}\b|\bfreellmapi-[0-9a-f]{20,}/;
const ASSERT = /\bassert\w*\b|\bexpect\(|\bshould\.|\bt\.(Error|Fatal|Equal)/;

export const isTestFile = (p: string) => /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rs)$|(^|\/)test_\w+\.py$|Tests?\.(java|kt|swift|cs)$/.test(p);
export const isCodeFile = (p: string) => /\.(c|cc|cpp|h|hpp|cs|go|java|kt|kts|swift|rs|py|rb|php|js|jsx|mjs|cjs|ts|tsx|vue|svelte|dart|lua|sh|scala)$/i.test(p);

export function integrityIssues(file: string, before: string, after: string, userText = ""): Issue[] {
  if (!isCodeFile(file)) return [];
  const out: Issue[] = [];
  const grew = (re: RegExp) => count(re, after) - count(re, before);
  const test = isTestFile(file);
  const asked = /\btests?\b|\bspec\b|assert/i.test(userText);
  let d: number;
  if ((d = grew(SUPPRESS)) > 0) out.push({ rule: "suppress", severity: "warn", msg: `${d} new error suppression(s) (ts-ignore/eslint-disable/noqa/any). Fix the underlying error instead, or say why suppression is correct.` });
  if ((d = grew(SKIP)) > 0) out.push({ rule: "skip-test", severity: "error", msg: `${d} test(s) newly skipped/only'd. Tests must run; fix the code or explain to the user why a test is wrong.` });
  if ((d = grew(EMPTY_CATCH)) > 0) out.push({ rule: "swallow", severity: "warn", msg: `${d} new empty catch/except-pass. Errors disappear silently; handle or rethrow with context.` });
  if (!test && (d = grew(STUB)) > 0) out.push({ rule: "stub", severity: "error", msg: `${d} stub/placeholder left in (TODO implement / NotImplementedError / your code here). Implement it or tell the user it is unfinished.` });
  if (grew(HACK) > 0) out.push({ rule: "special-case", severity: "error", msg: "Comment says this special-cases tests. Implement the general behaviour; never hardcode expected outputs." });
  if (grew(SECRET) > 0) out.push({ rule: "secret", severity: "error", msg: "Hardcoded API key/token/private key. Read it from an environment variable or config the user controls." });
  if (test && before && before !== after && !asked) {
    const lost = count(ASSERT, before) - count(ASSERT, after);
    out.push({ rule: "test-edit", severity: lost > 0 ? "error" : "warn", msg: lost > 0 ? `Removed ${lost} assertion(s) from ${file}. Do not weaken tests to make them pass; restore them unless the user agreed the test is wrong.` : `Changed test file ${file} though the user did not ask about tests. Only change a test when it is provably wrong; say so explicitly.` });
  }
  return out;
}
