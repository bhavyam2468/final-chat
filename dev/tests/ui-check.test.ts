// Run: node --experimental-strip-types dev/tests/ui-check.test.ts
import assert from "node:assert/strict";
import { uiIssues, liftFences } from "../../src/lib/ui-check.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };

t("unknown components are reported", () => {
  const out = uiIssues("<ui><x-nonsense>A</x-nonsense></ui>");
  assert.ok(out.some((i) => /x-nonsense/.test(i)), JSON.stringify(out));
});

t("the new structure tags are known", () => {
  assert.deepEqual(uiIssues("<ui><x-steps>One | two | done</x-steps><x-tree>Root</x-tree><x-list>Row | sub</x-list></ui>"), []);
});

t("a fenced ui block is lifted and reported", () => {
  const out = uiIssues("```html\n<ui><x-stat label=\"a\" value=\"1\"></x-stat></ui>\n```");
  assert.ok(out.some((i) => /fence/i.test(i)), JSON.stringify(out));
  assert.ok(liftFences("```html\n<ui>a</ui>\n```").includes("<ui>"));
});

t("a well-formed flow passes", () => {
  const src = `<ui><x-flow dir="LR" open="2">
start[round]: Open
check[decision]: Signed in?
ok
start -> check
check -> ok: yes
check -.-> start: retry
a => b: strong
</x-flow></ui>`;
  assert.deepEqual(uiIssues(src), []);
});

t("a rambling flow line is reported", () => {
  const out = uiIssues("<ui><x-flow>\nstart -> ok\nthis is not a statement\n</x-flow></ui>");
  assert.ok(out.some((i) => /x-flow line/.test(i)), JSON.stringify(out));
});

t("a flow with nodes but no edges is reported", () => {
  const out = uiIssues("<ui><x-flow>\nfirst[round]: A\nsecond: B\n</x-flow></ui>");
  assert.ok(out.some((i) => /no edges/.test(i)), JSON.stringify(out));
});

t("strong-only flows are not mistaken for edgeless", () => {
  assert.deepEqual(uiIssues("<ui><x-flow>\na => b: fast\nb ==> c: faster\n</x-flow></ui>"), []);
});

t("empty steps and trees are reported", () => {
  const out = uiIssues("<ui><x-steps>\n \n</x-steps><x-tree>\n\t\n</x-tree></ui>");
  assert.ok(out.some((i) => /x-steps is empty/.test(i)) && out.some((i) => /x-tree is empty/.test(i)), JSON.stringify(out));
});

t("unclosed containers are still caught", () => {
  assert.ok(uiIssues("<ui><x-card title=\"a\"><p>x</p></ui>").some((i) => /x-card/.test(i)));
});

t("matplotlib is redirected to x-chart", () => {
  assert.ok(uiIssues("<ui><script>import matplotlib</script></ui>").some((i) => /x-chart/.test(i)));
});

console.log(`\n${n} ui-check tests passed`);
