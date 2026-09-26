// Run: node --experimental-strip-types dev/tests/edit.test.ts
import assert from "node:assert/strict";
import { applyEdits, insertLines, snippet, stripNumbers, hasPlaceholder } from "../../src/lib/tools/edit.ts";
import { slopLint, blocksLint } from "../../src/lib/harness/slop.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };

const src = `function a() {\n    return 1;\n}\n\nfunction b() {\n    return 1;\n}\n`;

t("exact unique", () => {
  const r = applyEdits(src, [{ find: "function a() {\n    return 1;", replace: "function a() {\n    return 2;" }]);
  assert.ok(r.ok); if (r.ok) assert.match(r.text, /return 2;\n}\n\nfunction b\(\) {\n    return 1;/);
});
t("ambiguous rejected with line numbers", () => {
  const r = applyEdits(src, [{ find: "return 1;", replace: "return 3;" }]);
  assert.ok(!r.ok); if (!r.ok) assert.match(r.error, /2 places \(lines 2, 6\)/);
});
t("all=true replaces every match", () => {
  const r = applyEdits(src, [{ find: "return 1;", replace: "return 3;", all: true }]);
  assert.ok(r.ok); if (r.ok) assert.equal(r.text.match(/return 3/g)!.length, 2);
});
t("line numbers copied from fs_read are stripped", () => {
  const r = applyEdits(src, [{ find: "5\tfunction b() {\n6\t    return 1;", replace: "function b() {\n    return 9;" }]);
  assert.ok(r.ok); if (r.ok) assert.match(r.text, /return 9/);
});
t("indentation drift is re-indented", () => {
  const r = applyEdits(src, [{ find: "function b() {\nreturn 1;\n}", replace: "function b() {\n  const x = 2;\n  return x;\n}" }]);
  assert.ok(r.ok); if (r.ok) { assert.match(r.text, /function b\(\) {\n {2}const x = 2;/); assert.ok(r.notes[0].includes("re-indented")); }
});
t("trailing whitespace tolerated", () => {
  const r = applyEdits("x = 1   \ny = 2\n", [{ find: "x = 1\ny = 2", replace: "x = 5\ny = 2" }]);
  assert.ok(r.ok); if (r.ok) assert.equal(r.text, "x = 5\ny = 2\n");
});
t("not found shows closest region", () => {
  const r = applyEdits(src, [{ find: "function b() {\n    return 11;\n}", replace: "x" }]);
  assert.ok(!r.ok); if (!r.ok) assert.match(r.error, /Closest region[\s\S]*5\tfunction b/);
});
t("placeholder rejected", () => {
  assert.ok(hasPlaceholder("a\n// ... rest of code unchanged\n", "a"));
  const r = applyEdits(src, [{ find: "function a() {", replace: "function a() {\n  // ... existing code ..." }]);
  assert.ok(!r.ok);
});
t("atomic multi-edit", () => {
  const r = applyEdits(src, [{ find: "function a()", replace: "function A()" }, { find: "nope", replace: "x" }]);
  assert.ok(!r.ok); if (!r.ok) assert.match(r.error, /^edit 2/);
});
t("identical find/replace rejected", () => { assert.ok(!applyEdits(src, [{ find: "a", replace: "a" }]).ok); });
t("insert after line / top / end", () => {
  assert.equal(insertLines("a\nb\n", 1, "X").text, "a\nX\nb\n");
  assert.equal(insertLines("a\nb\n", 0, "X").text, "X\na\nb\n");
  assert.equal(insertLines("a\nb\n", -1, "X\n").text, "a\nb\nX\n");
  assert.equal(insertLines("", -1, "X").text, "X\n");
});
t("snippet numbered", () => { assert.match(snippet("a\nb\nc\nd\ne\nf\ng\nh", [[5, 5]], 1), /^4\td\n5\te\n6\tf$/); });
t("stripNumbers leaves real code alone", () => { assert.equal(stripNumbers("x = 1\n2\ty"), "x = 1\n2\ty"); });

t("slop: neon + orbitron + hype + emoji heading", () => {
  const html = `<style>body{font-family:'Orbitron',sans-serif;background:linear-gradient(90deg,#8b5cf6,#ec4899)} h1{text-shadow:0 0 20px #0ff}</style><h1>🚀 Welcome to TaskFlow</h1><p>Unleash seamless productivity!</p>`;
  const rules = new Set(slopLint(html, "html").map((i) => i.rule));
  for (const r of ["font", "gradient", "glow", "neon", "helper", "hype", "emoji"]) assert.ok(rules.has(r), "missing " + r + " in " + [...rules]);
});
t("slop: plain page is clean", () => {
  const html = `<style>body{font-family:system-ui,sans-serif;background:#f6f5f2;color:#222}</style><h1>Invoices</h1><table><tr><th>Client</th><th>Due</th></tr></table>`;
  assert.deepEqual(slopLint(html, "html"), []);
});
t("slop: jsx copy", () => {
  const jsx = `export default function App(){ return <main><h2>Supercharge your workflow</h2><button>Get started</button></main> }`;
  const rules = slopLint(jsx, "tsx").map((i) => i.rule);
  assert.ok(rules.includes("hype") && rules.includes("helper"));
});
t("blocks: unknown component", () => {
  const i = blocksLint(`<x-card><x-fancy-hero></x-fancy-hero></x-card>`, new Set(["x-card"]));
  assert.equal(i[0].rule, "blocks-unknown");
});
console.log(`\n${n} passed`);
