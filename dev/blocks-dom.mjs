/**
 * Blocks component smoke test — runs the real runtime (runtime.js + elements.js + flow.js) inside a
 * happy-dom window and feeds real block sources through the real entry point (`Blocks.feed`).
 * Usage: npm i --no-save happy-dom && node dev/blocks-dom.mjs
 */
import fs from "fs";
import { Window } from "happy-dom";

const SCRIPTS = ["public/blocks/runtime.js", "public/blocks/elements.js", "public/blocks/flow.js"].map((f) => fs.readFileSync(f, "utf8"));
const GLOBALS = ["document", "customElements", "HTMLElement", "SVGElement", "Event", "CustomEvent", "MutationObserver", "ResizeObserver", "DOMParser", "Node", "NodeFilter", "getComputedStyle", "CSS", "localStorage", "navigator", "history", "Image", "Blob", "URL", "FileReader", "location"];

function boot() {
  const win = new Window({ url: "https://blocks.test/" });
  win.document.body.innerHTML = '<div id="root"></div>';
  const posted = [];
  win.BLOCKS_ORIGIN = "https://app.test";
  win.parent = win;
  win.addEventListener("message", (e) => posted.push(e.data));
  win.postMessage = (m) => posted.push(m);
  const g = globalThis;
  const bind = (n, v) => { try { g[n] = v; } catch { Object.defineProperty(g, n, { value: v, configurable: true, writable: true }); } };
  g.window = win;
  for (const n of GLOBALS) if (win[n] !== undefined) bind(n, win[n]);
  for (const n of ["addEventListener", "removeEventListener", "dispatchEvent", "postMessage", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "fetch", "matchMedia"]) {
    const fn = win[n];
    if (typeof fn === "function") bind(n, fn.bind(win));
  }
  try { bind("innerWidth", 900); bind("innerHeight", 700); } catch {}
  bind("parent", win); bind("top", win); // runtime posts through the bare global `parent`
  for (const src of SCRIPTS) new Function("window", "document", "customElements", src).call(win, win, win.document, win.customElements);
  win.B = win.Blocks;
  win.posted = posted;
  win.render = (source, done = true) => win.B.feed(source, done);
  win.root = () => win.document.getElementById("root");
  return win;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, cases = 0;
const check = (label, cond, extra = "") => { cases++; if (!cond) { fails++; console.log("   FAIL " + label + (extra ? "  → " + String(extra).slice(0, 200) : "")); } else console.log("   ok   " + label); };
const group = (name) => console.log("\n" + name);

// ------------------------------------------------------------------ x-steps
{
  group("x-steps");
  const w = boot();
  w.render(`<x-steps>
Collect sources | 5 papers | done
Draft outline | three sections | now
Write draft | long form | todo
! Check numbers | unverified | warn
x Publish | blocked on review | fail
</x-steps>`);
  const s = w.root().querySelector("x-steps");
  const rows = s.querySelectorAll(".xst");
  check("renders 5 rows", rows.length === 5, s.innerHTML);
  check("state classes", [...rows].map((r) => [...r.classList].filter((c) => !c.startsWith("xst") && c !== "plain-marks").join("")).join(",") === "done,now,todo,warn,fail", [...rows].map((r) => r.className).join("|"));
  check("value shape", s.value.length === 5 && s.value[1].state === "now" && s.value[3].detail === "unverified", JSON.stringify(s.value));
  check(".done / .total", s.done === 1 && s.total === 5, `${s.done}/${s.total}`);
  let clicked = null;
  s.addEventListener("stepclick", (e) => (clicked = e.detail));
  rows[2].dispatchEvent(new w.Event("click", { bubbles: true }));
  check("stepclick event", clicked && clicked.index === 2 && clicked.title === "Write draft", JSON.stringify(clicked));

  const w2 = boot();
  w2.render("<x-steps>\n+ One\n- Two\n> Three\n</x-steps>");
  const s2 = w2.root().querySelector("x-steps");
  check("shorthand states", s2.value.map((v) => v.state).join(",") === "done,todo,now", JSON.stringify(s2.value));
}

// ------------------------------------------------------------------ x-tree
{
  group("x-tree");
  const w = boot();
  w.render(`<x-tree open="2">
Math
  Algebra
    Linear | matrices
  Calculus
Java
</x-tree>`);
  const t = w.root().querySelector("x-tree");
  check("nodes rendered", t.querySelectorAll(".xtr-row").length === 5, t.innerHTML);
  const v = t.value;
  check("tree structure", v.length === 2 && v[0].children.length === 2 && v[0].children[0].children[0].title === "Linear", JSON.stringify(v).slice(0, 220));
  check("note captured", v[0].children[0].children[0].note === "matrices", JSON.stringify(v[0].children[0].children[0]));
  check("open=2 shows 2 levels (Algebra folded)", t.querySelectorAll(".xtr-k[hidden]").length === 1, t.querySelectorAll(".xtr-k[hidden]").length);
  check("fold marker is +", t.querySelector(".xtr-k[hidden]")?.previousElementSibling?.textContent?.includes("+"), t.innerHTML.slice(0, 300));
  const btn = t.querySelector(".xtr-t");
  btn.dispatchEvent(new w.Event("click", { bubbles: true }));
  check("toggle expands", t.querySelectorAll(".xtr-k[hidden]").length >= 1);
}

// ------------------------------------------------------------------ x-list
{
  group("x-list");
  const w = boot();
  w.render(`<x-list ordered dense>
First law | inertia | 1687
! Second law | force equals mass times acceleration | 1687
? Third law | action and reaction | 1687
* Conservation | energy is never lost | -
</x-list>`);
  const l = w.root().querySelector("x-list");
  check("4 rows", l.querySelectorAll(".xls li").length === 4, l.innerHTML);
  check("ordered markup", !!l.querySelector("ol.xls"), l.innerHTML.slice(0, 160));
  check("tones + trailing", l.value.map((v) => v.tone).join(",") === ",danger,warning,accent" && l.value[0].right === "1687", JSON.stringify(l.value));
  check("tone class on row", !!l.querySelector("ol.xls li.tone-danger"), l.innerHTML.slice(0, 200));
  check("dense class applied", !!l.querySelector("ol.xls.dense"));
}

// ------------------------------------------------------------------ x-flow
{
  group("x-flow");
  const w = boot();
  w.render(`<x-flow dir="TB" height="420" title="Sign-in flow">
start[round]: Open the app
check[decision]: Signed in?
ok: Dashboard
signup: Create account
bad[decision,danger]: Attempts > 3?
lock: Locked for 15 min
start -> check
check -> ok: yes
check -> signup: no
signup => check: again
check -.-> bad
bad -> lock: yes
bad -> ok: no
lock -> check
</x-flow>`);
  const f = w.root().querySelector("x-flow");
  check("node count", f.querySelectorAll(".xf-node").length === 6, f.querySelectorAll(".xf-node").length);
  check("edge count", f.querySelectorAll(".xf-edge").length === 8, f.querySelectorAll(".xf-edge").length);
  check("pan layer + stage", !!f.querySelector(".xf-stage") && !!f.querySelector(".xf-pan"), f.innerHTML.slice(0, 160));
  check("svg sized", (() => { const s = f.querySelector("svg"); return s && +s.getAttribute("width") > 0 && +s.getAttribute("height") > 0; })(), f.querySelector("svg")?.outerHTML?.slice(0, 160));
  check("one arrowhead marker reused by every edge", f.querySelectorAll(".xf-arrowhead").length === 1 && [...f.querySelectorAll(".xf-edge")].every((p) => /url\(#xfa/.test(p.getAttribute("marker-end") || "")), [...f.querySelectorAll(".xf-edge")].map((p) => p.getAttribute("marker-end")).join("|"));
  check("edge labels (empty ones omitted)", [...f.querySelectorAll(".xf-edge-l")].map((e) => e.textContent).join(",") === "yes,no,again,yes,no", [...f.querySelectorAll(".xf-edge-l")].map((e) => e.textContent).join(","));
  check("shapes + tones", !!f.querySelector(".xf-node.xf-round") && !!f.querySelector(".xf-node.xf-decision") && !!f.querySelector(".xf-node.tone-danger"), [...f.querySelectorAll(".xf-node")].map((n) => n.className).join("|"));
  check("strong + dashed edges", !!f.querySelector(".xf-edge.strong") && !!f.querySelector(".xf-edge.dashed"), [...f.querySelectorAll(".xf-edge")].map((p) => p.className).join("|"));
  check("value = {nodes,edges}", f.value && f.value.nodes.length === 6 && f.value.edges.length === 8, JSON.stringify(f.value).slice(0, 120));
  let ev = null;
  f.addEventListener("nodeclick", (e) => (ev = e.detail));
  f.querySelector(".xf-node").dispatchEvent(new w.Event("click", { bubbles: true }));
  check("nodeclick", ev && typeof ev.id === "string" && !!ev.label, JSON.stringify(ev));
  const before = f.querySelector(".xf-pan").style.transform;
  const chained = f.zoomBy(1.4) === f && f.fit() === f && f.center("check") === f;
  check("zoom / fit / center are chainable", chained, before);
  check("center marks the node", !!f.querySelector(".xf-node.on"), f.querySelector(".xf-node.on")?.getAttribute("data-id"));
  check("no issues reported", !w.posted.some((m) => m.type === "issues"), JSON.stringify(w.posted));

  const w2 = boot();
  w2.render("<x-flow>\nA -> B -> C: end\n</x-flow>");
  const f2 = w2.root().querySelector("x-flow");
  check("undeclared endpoints become nodes", f2.value.nodes.length === 3 && f2.value.edges.length === 2, JSON.stringify(f2.value).slice(0, 200));

  const w3 = boot();
  w3.render("<x-flow>\nnot a statement !!\n</x-flow>");
  const f3 = w3.root().querySelector("x-flow");
  await wait(20);
  check("broken line still renders", !!f3.querySelector(".xf-stage"), f3.innerHTML.slice(0, 120));
  check("broken line reports an issue", w3.posted.some((m) => m.type === "issues" && /cannot read/.test(String(m.issues))), JSON.stringify(w3.posted));
}

// ------------------------------------------------------------------ streaming feed
{
  group("streaming");
  const w = boot();
  w.render("<x-stack>\n<x-steps>\nOne\nTwo", false);
  check("in-flight elements show skeletons", w.root().querySelectorAll(".b-skel").length >= 1, w.root().innerHTML.slice(0, 200));
  check("open x-steps is not mounted empty", !w.root().querySelector("x-steps"), w.root().innerHTML.slice(0, 200));
  w.render("<x-stack>\n<x-steps>\nOne | first\nTwo | second\n</x-steps>\n</x-stack>", true);
  const st = w.root().querySelector("x-steps");
  check("completes with content", st && st.value.length === 2 && st.value[0].title === "One", st ? JSON.stringify(st.value) : "missing");
  check("x-stack keeps children", w.root().querySelector("x-stack").children.length === 1);

  // x-flow must not be treated as a container: streaming shows a skeleton, completion parses the text
  const w2 = boot();
  w2.render("<x-flow>\nstart -> check", false);
  check("x-flow streams as a skeleton", !w2.root().querySelector("x-flow") && w2.root().querySelectorAll(".b-skel").length === 1, w2.root().innerHTML.slice(0, 200));
  w2.render("<x-flow>\nstart[round]: Open\ncheck[decision]: Signed in?\nstart -> check\n</x-flow>", true);
  const fl = w2.root().querySelector("x-flow");
  check("x-flow parses after completion", fl && fl.value.nodes.length === 2, fl ? JSON.stringify(fl.value).slice(0, 120) : "missing");
}

// ------------------------------------------------------------------ bindings + host bridge
{
  group("bindings & bridge");
  const w = boot();
  w.render(`<script type="data" name="rows">[["a",1],["b",2],["c",3]]</script>
<x-steps each="r in rows">+ {{r[0]}}</x-steps>
<x-stat label="Total" value="{{rows.length}}"></x-stat>`);
  await wait(30);
  check("each binding renders", w.root().querySelectorAll("x-steps .xst").length === 3, w.root().innerHTML.slice(0, 300));
  await wait(900);
  check("attr binding", /3/.test(w.root().querySelector("x-stat")?.textContent || ""), w.root().querySelector("x-stat")?.textContent);
  check("B.issue posts to host", (() => { w.B.issue("smoke"); return w.posted.some((m) => m.type === "issues" && /smoke/.test(String(m.issues))); })(), JSON.stringify(w.posted));
  await wait(950); // selfCheck runs at 900ms
  check("no self-check complaints", !w.posted.some((m) => m.type === "issues" && !/smoke/.test(String(m.issues))), JSON.stringify(w.posted));
}

console.log(`\n${cases - fails}/${cases} checks passed`);
process.exit(fails ? 1 : 0);
