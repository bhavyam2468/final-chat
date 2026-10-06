// Run: node --experimental-strip-types dev/tests/canvas.test.ts
import assert from "node:assert/strict";
import { applyZone, cascadeRect, clampRect, dockRect, extOf, inDockZone, kindOf, peekEdges, peekOutRect, peekRect, snapEdge, zoneFor, PEEK, DOCK_PAD } from "../../src/components/canvas/geometry.ts";
import { buildPdfQuote, markRects, norm, pageText, reading, spanLine, spanTop } from "../../src/components/canvas/pdftext.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };
const VP = { w: 1440, h: 900 };
const R = { x: 200, y: 150, w: 600, h: 400 };

/* ---------- kinds ---------- */
t("file kinds", () => {
  assert.equal(kindOf("a/b/paper.pdf"), "pdf");
  assert.equal(kindOf("shots/pic.PNG"), "image");
  assert.equal(kindOf("x/data.tar.gz"), "archive");
  assert.equal(kindOf("noext"), "text");
  assert.equal(extOf("a/b/c.TAR.XZ"), "tar.xz");
});

/* ---------- resize zones ---------- */
t("zoneFor: interior and far away are null", () => {
  assert.equal(zoneFor(R, 500, 350), null);
  assert.equal(zoneFor(R, 100, 100), null);
});
t("zoneFor: edges inside and just outside the window", () => {
  assert.equal(zoneFor(R, 205, 350), "l");
  assert.equal(zoneFor(R, 795, 350), "r");
  assert.equal(zoneFor(R, 500, 155), "t");
  assert.equal(zoneFor(R, 500, 545), "b");
  assert.equal(zoneFor(R, 194, 350), "l");  // outer band: the pill lives just outside the edge
  assert.equal(zoneFor(R, 180, 350), null); // beyond the outer band
});
t("zoneFor: corners win within the corner radius", () => {
  assert.equal(zoneFor(R, 210, 160), "tl");
  assert.equal(zoneFor(R, 790, 540), "br");
  assert.equal(zoneFor(R, 210, 540), "bl");
  assert.equal(zoneFor(R, 790, 160), "tr");
});

/* ---------- resize application ---------- */
t("applyZone: right edge grows, left edge keeps the right side fixed", () => {
  const r = applyZone(R, "r", 100, 0, VP);
  assert.equal(r.w, 700); assert.equal(r.x, 200);
  const l = applyZone(R, "l", -100, 0, VP);
  assert.equal(l.x, 100); assert.equal(l.w, 700); // moved left, grew right
});
t("applyZone: minimums and the never-offscreen top", () => {
  const tiny = applyZone(R, "r", -100000, 0, VP);
  assert.equal(tiny.w, 340);
  const up = applyZone(R, "t", 0, -100000, VP);
  assert.equal(up.y, 0); assert.ok(up.h >= 220);
});
t("applyZone: corners move x and y together", () => {
  const c = applyZone(R, "br", 60, 40, VP);
  assert.equal(c.w, 660); assert.equal(c.h, 440);
});

/* ---------- park / peek / dock geometry ---------- */
t("peekRect: only the tab sliver stays onscreen", () => {
  const p = peekRect("r", R, VP);
  assert.equal(p.x, VP.w - PEEK); assert.equal(p.w, R.w); assert.equal(p.h, R.h);
  const l = peekRect("l", R, VP);
  assert.equal(l.x, PEEK - R.w);
  const b = peekRect("b", R, VP);
  assert.equal(b.y, VP.h - PEEK);
});
t("peekOutRect: slides out but never covers the screen", () => {
  const o = peekOutRect("r", R, VP);
  assert.ok(o.x < VP.w - PEEK && o.x + o.w <= VP.w); // moves out, stays flush with the edge
  assert.ok(VP.w - o.x <= Math.round(VP.w * 0.62) + 1); // exposed width ≤ 62% of the screen
  const wide = peekOutRect("r", { x: 100, y: 100, w: 1200, h: 800 }, VP);
  assert.ok(VP.w - wide.x <= Math.round(VP.w * 0.62) + 1); // a big window exposes at most 62%
});
t("dockRect hugs the right side with padding", () => {
  const d = dockRect(520, VP);
  assert.equal(d.x, VP.w - 520 - DOCK_PAD); assert.equal(d.y, DOCK_PAD); assert.equal(d.h, VP.h - 2 * DOCK_PAD);
});
t("snap + dock drop zones", () => {
  assert.equal(snapEdge(10, 400, VP), "l");
  assert.equal(snapEdge(700, 400, VP), null);
  assert.equal(snapEdge(1435, 400, VP), null); // right edge is the dock's, not a park edge, on desktop
  assert.equal(snapEdge(1435, 400, { w: 600, h: 900 }), "r"); // narrow screens park on all edges
  assert.equal(peekEdges(VP).includes("r"), false);
  assert.equal(peekEdges({ w: 600, h: 900 }).includes("r"), true);
  assert.equal(inDockZone(1440 - 40, VP), true);
  assert.equal(inDockZone(800, VP), false);
});

/* ---------- clamps + cascade ---------- */
t("clampRect keeps a grip on the viewport", () => {
  const c = clampRect({ x: -5000, y: -3000, w: 500, h: 300 }, VP);
  assert.ok(c.x >= 16 - 500); assert.equal(c.y, 0);
  const c2 = clampRect({ x: 99999, y: 99999, w: 500, h: 300 }, VP);
  assert.ok(c2.x <= VP.w - 80); assert.ok(c2.y <= VP.h - 60);
});
t("cascadeRect: content ratio centers and hugs", () => {
  const c = cascadeRect(16 / 9, undefined, 0, VP);
  assert.ok(Math.abs(c.w / c.h - 16 / 9) < 0.02); // hugs the ratio
  assert.ok(Math.abs(2 * c.x + c.w - VP.w) < 3); // centred
  const f = cascadeRect(null, undefined, 3, VP);
  assert.ok(f.x < VP.w - f.w - 20); // cascades left-down-ish per floating count
});

/* ---------- pdf text layer ---------- */
const items = [
  { s: "The quick brown", x: 0.1, by: 0.2, w: 0.3, h: 0.02 },
  { s: "fox jumps over", x: 0.45, by: 0.2, w: 0.3, h: 0.02 },
  { s: "the lazy dog", x: 0.1, by: 0.24, w: 0.25, h: 0.02 },
  { s: "and sleeps.", x: 0.1, by: 0.28, w: 0.2, h: 0.02 },
];
t("reading order sorts by baseline then x", () => {
  const r = reading([{ s: "b", x: 0.5, by: 0.3, w: 0.1, h: 0.02 }, { s: "a", x: 0.1, by: 0.3, w: 0.1, h: 0.02 }, { s: "top", x: 0.4, by: 0.1, w: 0.1, h: 0.02 }]);
  assert.deepEqual(r.map((i) => i.s), ["top", "a", "b"]);
  assert.equal(pageText(items), "The quick brown fox jumps over the lazy dog and sleeps.");
});
t("span geometry: ascent above the baseline", () => {
  assert.equal(spanTop(0.2, 0.02), 0.2 - 0.016);
  assert.equal(spanTop(0.001, 0.02), 0); // never above the page
  assert.ok(spanLine(0.02) > 0.02);
});
t("markRects: one item, one rect", () => {
  const r = markRects(items, { text: "the lazy dog" });
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].y - spanTop(0.24, 0.02)) < 1e-9);
  assert.ok(r[0].w > 0.2);
});
t("markRects: a passage spanning lines yields a rect per line, partial width at the cut", () => {
  const r = markRects(items, { text: "over the lazy dog" });
  assert.equal(r.length, 2);
  assert.ok(r[0].w < 0.29 && r[0].x > 0.45); // "over" — the tail of the first item only
  assert.ok(Math.abs(r[1].w - 0.25) < 1e-9); // "the lazy dog" fully covered
});
t("markRects: anchor text disambiguates repeats", () => {
  const rep = [
    { s: "value 42", x: 0.1, by: 0.2, w: 0.2, h: 0.02 },
    { s: "value 42", x: 0.1, by: 0.4, w: 0.2, h: 0.02 },
  ];
  assert.equal(markRects(rep, { text: "value 42" }).length, 1); // first occurrence by default
  const second = markRects(rep, { text: "value 42", pre: "value 42" }); // anchored after the first
  assert.equal(second.length, 1);
  assert.ok(Math.abs(second[0].y - spanTop(0.4, 0.02)) < 1e-9); // anchored to the later occurrence
});
t("markRects: no match, no rects", () => {
  assert.deepEqual(markRects(items, { text: "unicorn" }), []);
  assert.deepEqual(markRects(items, { text: "" }), []);
});
t("buildPdfQuote cites file + page and carries context", () => {
  const text = "Alpha beta gamma delta epsilon zeta eta theta iota kappa. The quick brown fox jumps over the lazy dog. Lambda mu nu xi omicron pi.";
  const q = buildPdfQuote("The quick brown fox jumps over the lazy dog", "paper.pdf", 7, text, 20);
  assert.ok(q.startsWith("The quick brown fox"));
  assert.ok(q.includes("quoted from paper.pdf, page 7"));
  assert.ok(q.includes("Around it:"));
  assert.ok(q.includes("【The quick brown fox jumps over the lazy dog】"));
  assert.ok(q.includes("theta iota kappa")); // context before
  assert.ok(q.includes("Lambda mu")); // context after
});
t("buildPdfQuote without a match still cites the source", () => {
  const q = buildPdfQuote("missing passage", "x.pdf", 2, "unrelated text");
  assert.ok(q.includes("page 2")); assert.ok(!q.includes("Around it"));
});
t("norm collapses whitespace case-insensitively", () => {
  assert.equal(norm("  A\tB\n c  "), "a b c");
});

console.log(`\ncanvas.test: ${n} assertions ok`);
