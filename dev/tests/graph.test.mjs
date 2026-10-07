// Run: node dev/tests/graph.test.mjs
// The Blocks graph engine (public/blocks/graph.js) is browser-facing but pure: parse + layout are plain
// functions, so they are tested here without a DOM. x-flow / x-tree in the browser are thin views over this.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const win = { Blocks: {} };
new Function("window", fs.readFileSync(path.join(root, "public/blocks/graph.js"), "utf8"))(win);
const B = win.Blocks;

let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };

t("our own syntax: declarations with kinds and labelled edges", () => {
  const g = B.parseFlow(`
    # a small study loop
    start "Start" :start
    read "Read the chapter"
    q "Understood?" :decision
    quiz "Take the quiz"
    done "Done" :end

    start -> read
    read -> q
    q -> quiz "yes"
    q -> read "no" dashed
    quiz -> done
  `);
  assert.deepEqual(g.nodes.map((x) => x.id), ["start", "read", "q", "quiz", "done"]);
  assert.equal(g.nodes.find((x) => x.id === "q").kind, "decision");
  assert.equal(g.nodes.find((x) => x.id === "read").label, "Read the chapter");
  assert.equal(g.edges.length, 5);
  assert.equal(g.edges.find((e) => e.label === "no").dashed, true);
  assert.equal(g.edges.find((e) => e.label === "yes").dashed, false);
});

t("mermaid flowcharts render natively (the habit a model falls back on)", () => {
  const g = B.parseFlow(`
flowchart LR
  A[Start] --> B{Is it valid?}
  B -->|yes| C(Process it)
  B -- no --> D[/Reject/]
  C --> E((Done))
  classDef big fill:#f00
`);
  assert.equal(g.nodes.length, 5);
  assert.equal(g.nodes.find((x) => x.id === "B").kind, "decision");
  assert.equal(g.nodes.find((x) => x.id === "A").kind, "start");
  assert.equal(g.nodes.find((x) => x.id === "E").kind, "end");
  assert.equal(g.nodes.find((x) => x.id === "D").label, "Reject");
  const yes = g.edges.find((e) => e.label === "yes");
  assert.equal(yes.from, "B");
  assert.equal(yes.to, "C");
  assert.equal(g.edges.find((e) => e.label === "no").to, "D");
});

t("bare labels, defaults and normalised kinds", () => {
  const g = B.parseFlow("a Collect input\nb Validate :input\nc Decide :question\nd Publish :output");
  assert.equal(g.nodes.find((x) => x.id === "a").label, "Collect input");
  assert.equal(g.nodes.find((x) => x.id === "b").kind, "io");
  assert.equal(g.nodes.find((x) => x.id === "c").kind, "decision");
  assert.equal(g.nodes.find((x) => x.id === "d").kind, "io");
  assert.equal(g.edges.length, 0);
});

t("a source with nothing coming in becomes the start, a sink becomes an end", () => {
  const g = B.parseFlow("a \"Open\"\nb \"Check\"\nc \"Close\"\na -> b\nb -> c");
  assert.equal(g.nodes.find((x) => x.id === "a").kind, "start");
  assert.equal(g.nodes.find((x) => x.id === "c").kind, "end");
  assert.equal(g.nodes.find((x) => x.id === "b").kind, "step");
});

t("loops are drawn, not dropped", () => {
  const g = B.parseFlow("a -> b\nb -> c\nc -> a\nc -> d");
  assert.equal(g.edges.length, 4);
  const layout = B.graphLayout(g.nodes, g.edges, "lr");
  assert.equal(layout.edges.filter((e) => e.back).length >= 1, true);
  assert.equal(layout.nodes.length, 4);
});

t("layout: ranks grow left to right, nothing overlaps", () => {
  const g = B.parseFlow("start \"Start\"\na \"One\"\nb \"Two\"\nc \"Three\"\nstart -> a\nstart -> b\na -> c\nb -> c");
  const L = B.graphLayout(g.nodes, g.edges, "lr");
  const at = (id) => L.nodes.find((x) => x.id === id);
  assert.equal(at("start").x < at("a").x, true);
  assert.equal(at("a").x === at("b").x, true);
  assert.equal(at("c").x > at("a").x, true);
  assert.notEqual(at("a").y, at("b").y, "siblings never sit on the same row");
  assert.equal(L.width > 0 && L.height > 0, true);
  for (const node of L.nodes) {
    for (const other of L.nodes) {
      if (node === other) continue;
      const overlap = node.x < other.x + other.w && other.x < node.x + node.w && node.y < other.y + other.h && other.y < node.y + node.h;
      assert.equal(overlap, false, `${node.id} overlaps ${other.id}`);
    }
  }
});

t("layout: bottom-to-top and right-to-left mirror the same drawing", () => {
  const g = B.parseFlow("a -> b -> c");
  const tb = B.graphLayout(g.nodes, g.edges, "tb");
  const bt = B.graphLayout(g.nodes, g.edges, "bt");
  const at = (L, id) => L.nodes.find((x) => x.id === id);
  assert.equal(at(tb, "a").y < at(tb, "c").y, true);
  assert.equal(at(bt, "a").y > at(bt, "c").y, true);
  assert.equal(tb.nodes.map((x) => x.id).join() === bt.nodes.map((x) => x.id).join(), true);
});

t("layout is deterministic", () => {
  const src = "a -> b\na -> c\nb -> d\nc -> d\nd -> e";
  const one = B.parseFlow(src), two = B.parseFlow(src);
  assert.deepEqual(B.graphLayout(one.nodes, one.edges, "lr").nodes.map((x) => [x.id, x.x, x.y]), B.graphLayout(two.nodes, two.edges, "lr").nodes.map((x) => [x.id, x.x, x.y]));
});

t("trees: indentation is the hierarchy, order is preserved", () => {
  const g = B.parseTree(`
    Institutions
      Government
        Ministry of Finance | budget
        Central Bank
      Households
        Workers
      Firms
  `);
  assert.equal(g.nodes.length, 7);
  assert.equal(g.nodes[0].label, "Institutions");
  assert.equal(g.nodes[0].kind, "root");
  assert.equal(g.nodes.find((x) => x.label === "Ministry of Finance").detail, "budget");
  assert.deepEqual(g.edges.map((e) => [e.from, e.to]), [["n0", "n1"], ["n1", "n2"], ["n1", "n3"], ["n0", "n4"], ["n4", "n5"], ["n0", "n6"]]);
  const L = B.graphLayout(g.nodes, g.edges, "tb", { order: "preserve" });
  const at = (id) => L.nodes.find((x) => x.id === id);
  assert.equal(at("n0").y < at("n1").y, true);
  assert.equal(at("n1").y === at("n4").y, true);
  assert.equal(at("n2").x < at("n3").x, true, "declaration order is kept");
  assert.equal(at("n4").x < at("n6").x, true);
});

t("empty and malformed sources never throw", () => {
  for (const src of ["", "   ", "->", "a ->", "--> b", "???", "a -> a", "garbage line with no meaning"]) {
    const g = B.parseFlow(src);
    const L = B.graphLayout(g.nodes, g.edges, "lr");
    assert.equal(Number.isFinite(L.width), true);
  }
  assert.equal(B.parseTree("").nodes.length, 0);
});

t("a feedback loop keeps the order and is drawn as a back edge", () => {
  const g = B.parseFlow(`start "Start" :start
read "Read the PDF"
q "Understood?" :decision
quiz "Take the quiz"
redo "Review the notes"
done "Done" :end
start -> read
read -> q
q -> quiz "yes"
q -> redo "no" dashed
redo -> read
quiz -> done`);
  const L = B.graphLayout(g.nodes, g.edges, "tb", { order: "preserve" });
  const at = (id) => L.nodes.find((n) => n.id === id).y;
  assert.ok(at("start") < at("read"), "start before read");
  assert.ok(at("read") < at("q"), "read before the question");
  assert.ok(at("q") < at("redo"), "a revision step follows what it revises, never precedes it");
  assert.ok(at("redo") > at("read"), "the loop goes forward, then back");
  const back = L.edges.filter((e) => e.back).map((e) => `${e.from}->${e.to}`);
  assert.deepEqual(back, ["redo->read"], "only the closing edge is a back edge: " + back.join(","));
  assert.equal(L.layers, 5, "start, read, question, {quiz, redo}, done — and no empty rank");
});

t("a cycle with no entry point still lays out and terminates", () => {
  const g = B.parseFlow("a -> b\nb -> a\nc -> a");
  const L = B.graphLayout(g.nodes, g.edges, "tb", {});
  assert.equal(L.nodes.length, 3);
  const ys = new Set(L.nodes.map((n) => n.y));
  assert.ok(ys.size >= 2, "the cycle is not collapsed onto one line: " + [...ys].join(","));
  assert.ok(L.edges.some((e) => e.back), "the loop edge closes the cycle");
});

t("spacing follows the layout axis, not the label length", () => {
  const wide = "A step with a very long label indeed";
  const g = B.parseFlow(`s0 "Start" :start\ns1 "${wide}"\ns2 "${wide}"\ns3 "End" :end\ns0 -> s1\ns1 -> s2\ns2 -> s3`);
  const est = (label, kind) => ({ w: 60 + String(label).length * 7, h: kind === "decision" ? 58 : 40 });
  const tb = B.graphLayout(g.nodes, g.edges, "tb", { estimate: est, order: "preserve" });
  const ys = g.nodes.map((n) => tb.nodes.find((x) => x.id === n.id).y).sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  assert.ok(Math.max(...gaps) < 110, "vertical gaps follow the node height: " + gaps.join(","));
  const lr = B.graphLayout(g.nodes, g.edges, "lr", { estimate: est, order: "preserve" });
  const xs = g.nodes.map((n) => lr.nodes.find((x) => x.id === n.id).x).sort((a, b) => a - b);
  const hgaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(Math.max(...hgaps) > 150, "horizontal gaps follow the label width: " + hgaps.join(","));
});

console.log(`\n${n} graph tests passed`);
