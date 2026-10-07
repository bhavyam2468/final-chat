// Structure blocks (x-flow / x-tree / x-list) against the real runtime.
// linkedom has no layout engine, so this checks wiring, parsing, DOM shape and state — not pixels;
// the pixels are covered by dev/blocks-e2e.mjs in a real browser.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseHTML } from "linkedom";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = ["public/blocks/runtime.js", "public/blocks/graph.js", "public/blocks/elements.js"]
  .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"))
  .join("\n;\n");

let errors = [];
function makeWindow() {
  const { window, document } = parseHTML(`<!doctype html><html><head></head><body class="fill"><div id="root"></div></body></html>`);
  window.BLOCKS_ORIGIN = "http://x";
  window.parent = window; window.top = window; window.self = window;
  window.postMessage = (m) => { if (m && m.type === "error") errors.push(String(m.text)); };
  window.addEventListener = window.addEventListener || (() => {});
  window.removeEventListener = window.removeEventListener || (() => {});
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const raf = (f) => setTimeout(() => { try { f(Date.now()); } catch (e) { errors.push(String(e && e.stack || e)); } }, 0);
  window.requestAnimationFrame = raf; window.cancelAnimationFrame = clearTimeout;
  window.MutationObserver = window.MutationObserver || class { observe() {} disconnect() {} takeRecords() { return []; } };
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.CSS = { escape: (s) => String(s) };
  window.getComputedStyle = () => ({ getPropertyValue: (n) => (n === "--r" ? "12px" : n === "--accent" ? "#d97757" : ""), fontFamily: "Geist, sans-serif", fontSize: "15px" });
  const origCreate = document.createElement.bind(document);
  document.createElement = (tag, ...rest) => (String(tag).toLowerCase() === "canvas" ? { getContext: () => ({ font: "", measureText: (t) => ({ width: String(t).length * 7.4 }) }) } : origCreate(tag, ...rest));
  const origNS = document.createElementNS.bind(document);
  document.createElementNS = (ns, tag, ...rest) => { const el = origNS(ns, tag, ...rest); if (!el.style) el.style = { setProperty() {}, removeProperty() {} }; return el; };
  const SB = {
    window, document, self: window, top: window, parent: window,
    navigator: window.navigator, location: undefined, history: undefined,
    getComputedStyle: window.getComputedStyle, requestAnimationFrame: raf, cancelAnimationFrame: clearTimeout,
    matchMedia: window.matchMedia, CSS: window.CSS, localStorage: undefined, sessionStorage: undefined,
    addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window), innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, NodeList: window.NodeList,
    DocumentFragment: window.DocumentFragment, SVGElement: window.SVGElement, EventTarget: window.EventTarget,
    MutationObserver: window.MutationObserver, ResizeObserver: window.ResizeObserver,
    Event: window.Event, CustomEvent: window.CustomEvent, InputEvent: window.InputEvent,
    MouseEvent: window.MouseEvent || window.Event, KeyboardEvent: window.KeyboardEvent || window.Event,
    PointerEvent: window.PointerEvent || window.Event, WheelEvent: window.WheelEvent || window.Event,
    FocusEvent: window.FocusEvent || window.Event, HTMLInputElement: window.HTMLInputElement,
    HTMLCanvasElement: window.HTMLCanvasElement, customElements: window.customElements,
  };
  new Function(...Object.keys(SB), BUNDLE + "\n//# sourceURL=blocks-bundle.js")(...Object.values(SB));
  return window;
}

let n = 0, bad = 0;
const t = (name, f) => { try { f(); n++; console.log("ok  ", name); } catch (e) { bad++; console.log("FAIL", name, "->", e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || "assertion"); };
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
// the list parser lives in elements.js, not graph.js; mirror its shape here for the doc check
const xlRows = (src) => String(src || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const API = makeWindow().Blocks; // parsing/layout API, from the real bundle

async function mount(src, { stream = false } = {}) {
  errors = [];
  const w = makeWindow();
  if (stream) { for (let i = 37; i < src.length; i += 37) w.Blocks.feed(src.slice(0, i), false); }
  w.Blocks.feed(src, true);
  await tick(stream ? 120 : 60);
  return { w, root: w.document.getElementById("root") };
}

const FLOW = `start "Start" :start
read "Read the PDF"
q "Understood?" :decision
quiz "Take the quiz"
done "Done" :end
start -> read
read -> q
q -> quiz "yes"
q -> read "no" dashed
quiz -> done`;

{
  const { root } = await mount(`<ui><x-flow caption="How the lesson flows">${FLOW}</x-flow></ui>`);
  t("x-flow draws every node and edge once", () => {
    assert(root.querySelectorAll("x-flow .xgn").length === 5, "nodes=" + root.querySelectorAll("x-flow .xgn").length);
    assert(root.querySelectorAll("x-flow .xge").length === 5, "edges=" + root.querySelectorAll("x-flow .xge").length);
    assert(root.querySelector("x-flow .xgn .xgn-t").textContent === "Start", "first label");
    assert(root.querySelectorAll("x-flow .xge.dashed").length === 1, "dashed loop edge");
    assert(root.querySelector("x-flow .xgwrap").getAttribute("aria-label") === "How the lesson flows", "aria from caption");
  });
  t("x-flow gives each kind its own shape", () => {
    assert(root.querySelectorAll('x-flow .xgn[data-kind="decision"] polygon').length === 1, "one diamond");
    assert(root.querySelectorAll('x-flow .xgn[data-kind="start"] rect.solid').length === 1, "start filled");
    assert(root.querySelectorAll("x-flow .xghud button").length === 3, "zoom controls");
    assert(root.querySelectorAll("x-flow .xgl").length === 2, "edge labels yes/no");
  });
}

{
  const { root } = await mount(`<ui><x-tree collapse>
Company | 1,200 people
  Engineering | 400
    Platform
    Mobile
  Design
  Sales | 90
</x-tree></ui>`);
  t("x-tree lays out the hierarchy and marks parents", () => {
    assert(root.querySelectorAll("x-tree .xgn").length === 6, "nodes=" + root.querySelectorAll("x-tree .xgn").length);
    assert(root.querySelectorAll("x-tree .xgn-chev").length === 2, "collapsible parents are marked, found " + root.querySelectorAll("x-tree .xgn-chev").length);
    assert(/1,200 people/.test(root.querySelector("x-tree .xgn-d").textContent), "detail line");
    assert(root.querySelectorAll("x-tree .box.root").length === 1, "one root");
  });
}

{
  const { root } = await mount(`<ui><x-list name="plan" markers="number" select="single">
Week 1 | kinematics
  Read ch. 2 | 40 pages | Mon
  Problems 1-10 | | Tue
Week 2 | dynamics
  Lab report | draft | Fri
</x-list></ui>`);
  t("x-list builds nested rows with detail and meta", () => {
    assert(root.querySelectorAll("x-list .xl-i").length === 5, "rows=" + root.querySelectorAll("x-list .xl-i").length);
    assert(root.querySelectorAll("x-list .xl-i > .xl").length === 2, "children live inside their parent item");
    assert(root.querySelector("x-list .xl-meta").textContent === "Mon", "meta column");
    assert(root.querySelector("x-list .xl-tx small").textContent === "kinematics", "row detail");
    assert(root.querySelector("x-list .xl-i .xl-i .xl-tx small").textContent === "40 pages", "nested detail");
    assert(root.querySelectorAll("x-list .xl-chev").length === 2, "collapsible parents");
    assert([...root.querySelectorAll("x-list .xl-mk")].map((e) => e.textContent).join(" ") === "1. 1.1 1.2 2. 2.1", "outline numbering follows the nesting: " + [...root.querySelectorAll("x-list .xl-mk")].map((e) => e.textContent).join(" "));
    assert(root.querySelector("x-list .xl-i .xl-i .xl-row .xl-tx").textContent.startsWith("Read ch. 2"), "nested row");
    const empty = [...root.querySelectorAll("x-list .xl-tx")].find((e) => /Problems/.test(e.textContent));
    assert(empty && !/\|/.test(empty.textContent), "an empty detail column leaves no stray bar: " + (empty && empty.textContent));
    assert([...root.querySelectorAll("x-list .xl-meta")].map((e) => e.textContent).join(",") === "Mon,Tue,Fri", "meta cells line up");
  });
}

{
  const { w, root } = await mount(`<ui><x-flow>${FLOW}</x-flow></ui>`, { stream: true });
  t("streaming a flowchart in 37-char chunks stays clean", () => {
    assert(errors.length === 0, "errors: " + errors.join(" | "));
    assert(root.querySelectorAll("x-flow .xgn").length === 5, "nodes after streaming");
  });
  const flow = root.querySelector("x-flow");
  const z0 = flow._view.state.z;
  flow.zoomBy(1.25);
  const z1 = flow._view.state.z;
  // exactly what the runtime does for a live source (text="{{…}}" binding): new source, then refresh
  flow._src = FLOW + `\nextra "One more step" :step\nquiz -> extra`;
  await (async () => { flow.refresh(true); await tick(80); })();
  t("a live re-render keeps the reader's pan and zoom", () => {
    assert(z1 > z0, "zoom applied");
    assert(Math.abs(flow._view.state.z - z1) < 1e-9, `z stayed ${flow._view.state.z} vs ${z1}`);
    assert(root.querySelectorAll("x-flow .xgn").length === 6, "new node drawn, old viewport kept");
    assert(errors.length === 0, "errors: " + errors.join(" | "));
  });
}

{
  const { root, w } = await mount(`<ui><x-list name="plan" select="multi" markers="dash">Alpha\nBeta\nGamma</x-list><x-flow name="flow">a "One" :start\nb "Two" :end\na -> b</x-flow></ui>`);
  t("a named list and flow answer form() and the reactive scope", () => {
    const list = root.querySelector("x-list");
    w.document.getElementById("root").querySelectorAll("x-list .xl-row")[1].click();
    assert(JSON.stringify(list.value) === '["Beta"]', "value after a pick: " + JSON.stringify(list.value));
    assert(JSON.stringify(w.form()) === '{"plan":["Beta"],"flow":null}', "form() carries the pick: " + JSON.stringify(w.form()));
    const flow = root.querySelector("x-flow");
    assert(flow.value === null, "an untouched flow contributes nothing to a form");
    flow.setAttribute("active", "b");
    assert(flow.value === "b", "flow exposes its chosen node");
    assert(JSON.stringify(w.form()) === '{"plan":["Beta"],"flow":"b"}', "form() carries the pick and the node: " + JSON.stringify(w.form()));
    assert(flow.nodes.join(",") === "a,b", "flow lists its node ids: " + flow.nodes.join(","));
  });
}

{
  const { root, w } = await mount(`<ui><x-table sortable select total="time,memory" caption="Benchmark">run,size,time,memory,change,notes
1,"Sorted, ascending",12.4,18 MB,+3%,warm
2,Sorted descending,12.9,18 MB,-1%,
3,**Shuffled**,15.6,19 MB,+12%,"cache, miss path"
</x-table></ui>`);
  t("x-table reads quoted fields, aligns numbers and totals by column", () => {
    const tb = root.querySelector("x-table");
    assert(tb.querySelectorAll("tbody tr").length === 3, "rows: " + tb.querySelectorAll("tbody tr").length);
    const cells = [...tb.querySelectorAll("tbody tr")[0].querySelectorAll("td")].map((c) => c.textContent);
    assert(cells[1] === "Sorted, ascending", "a quoted field keeps its comma: " + cells[1]);
    assert([...tb.querySelectorAll("th")].map((h) => h.className).join(",") === "num,,num,num,num,", "numbers align right: " + [...tb.querySelectorAll("th")].map((h) => h.className).join(","));
    assert(tb.querySelector("tfoot").textContent.replace(/\s+/g, " ").trim() === "Total40.955 MB", "totals: " + tb.querySelector("tfoot").textContent);
    assert(tb.querySelector("tbody .b-up") && tb.querySelector("tbody .b-down"), "a signed column is coloured");
    assert(tb.querySelector("td b"), "**bold** inside a cell renders");
  });
  t("x-table sorts on click and reports the selected row", () => {
    const tb = root.querySelector("x-table");
    tb.querySelectorAll("th")[2].click();
    const first = tb.querySelector("tbody tr td").textContent;
    assert(first === "1", "ascending sort put run 1 first, got " + first);
    tb.querySelectorAll("th")[2].click();
    assert(tb.querySelector("tbody tr td").textContent === "3", "second click reverses");
    tb.querySelectorAll("tbody tr")[1].click();
    assert(JSON.stringify(tb.value) === '{"run":"2","size":"Sorted descending","time":"12.9","memory":"18 MB","change":"-1%","notes":""}', "value is the row as an object: " + JSON.stringify(tb.value));
    assert(JSON.stringify(w.form()) === "{}", "an unnamed table stays out of form(): " + JSON.stringify(w.form()));
  });
}

// Every flowchart/tree/outline example the model is taught must parse and draw: the docs are the prompt,
// and a broken example is exactly how the model gets it wrong.
for (const doc of ["workspace-template/system/SYSTEM.md", "workspace-template/system/skills/blocks/SKILL.md"]) {
  const text = fs.readFileSync(path.join(ROOT, doc), "utf8");
  const flows = [...text.matchAll(/<x-flow[^>]*>([\s\S]*?)<\/x-flow>/g)].map((m) => m[1]);
  const trees = [...text.matchAll(/<x-tree[^>]*>([\s\S]*?)<\/x-tree>/g)].map((m) => m[1]);
  const lists = [...text.matchAll(/<x-list[^>]*>([\s\S]*?)<\/x-list>/g)].map((m) => m[1]);
  t(`${path.basename(doc)}: every taught example parses`, () => {
    // SYSTEM.md teaches by example, so it must contain at least one; the skill teaches by grammar.
    if (/SYSTEM\.md$/.test(doc)) assert(flows.length + trees.length + lists.length > 0, "no examples found");
    for (const f of flows) { const g = API.parseFlow(f); assert(g.nodes.length >= 2 && g.edges.length >= 1, "flow: " + JSON.stringify(g).slice(0, 160)); }
    for (const tr of trees) { const g = API.parseTree(tr); assert(g.nodes.length >= 2 && g.edges.length >= 1, "tree: " + JSON.stringify(g).slice(0, 160)); }
    for (const l of lists) { assert(xlRows(l).length >= 2, "list"); }
  });
}

// The flowchart SYSTEM.md teaches must also draw: parsing right and rendering wrong is the same bug to the user.
{
  const text = fs.readFileSync(path.join(ROOT, "workspace-template/system/SYSTEM.md"), "utf8");
  const flows = [...text.matchAll(/<x-flow[^>]*>([\s\S]*?)<\/x-flow>/g)].map((m) => m[1]);
  for (const [i, f] of flows.entries()) {
    try {
      const { root } = await mount(`<ui><x-flow>${f}</x-flow></ui>`);
      const want = API.parseFlow(f).nodes.length;
      const got = root.querySelectorAll("x-flow .xgn").length;
      assert(got === want, `drew ${got} of ${want} nodes`);
      assert(root.querySelector('x-flow .xgn[data-kind="start"]'), "no start node");
      assert(root.querySelector('x-flow .xgn[data-kind="decision"]'), "no decision node");
      assert(root.querySelector('x-flow .xgn[data-kind="end"]'), "no end node");
      assert(errors.length === 0, "errors: " + errors.join(" | "));
      n++; console.log("ok  ", `SYSTEM.md flowchart example ${i + 1} draws`);
    } catch (e) { bad++; console.log("FAIL", `SYSTEM.md flowchart example ${i + 1} draws ->`, e.message); }
  }
}

// The model writes what the docs and catalog teach. A component named there but missing from the library is a
// blank box for the user and an unfixable-looking bug for the model, so the two lists are checked against each other.
{
  const { w } = await mount("<ui><p>warm up</p></ui>");
  const defined = new Set([...BUNDLE.matchAll(/define\("([a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const [file, pat] of [["src/lib/blocks/catalog.ts", /tag: "([^"]+)"/g], ["docs/BLOCKS.md", /`(x-[a-z][a-z0-9-]*)`/g], ["workspace-template/system/skills/blocks/SKILL.md", /\b(x-[a-z][a-z0-9-]*)\b/g], ["workspace-template/system/SYSTEM.md", /\b(x-[a-z][a-z0-9-]*)\b/g]]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const names = new Set([...text.matchAll(pat)].flatMap((m) => m[1].split("/").filter((x) => x.startsWith("x-"))));
    const missing = [...names].filter((t) => !defined.has(t) && t !== "x-labels" && t !== "x-label" && t !== "x-icon-name");
    t(`${path.basename(file)} names only components that exist`, () => assert(missing.length === 0, "missing: " + missing.join(", ")));
  }
}

console.log(bad ? `\n${bad} failed / ${n} passed` : `\n${n} structure tests passed`);
process.exit(bad ? 1 : 0);
