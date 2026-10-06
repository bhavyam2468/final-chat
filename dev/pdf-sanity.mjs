// End-to-end sanity: hand-built PDF → unpdf → the exact mapping PdfView uses → pdftext helpers.
// Run: node --experimental-strip-types --no-warnings dev/pdf-sanity.mjs
import { writeFileSync } from "node:fs";
import { markRects, buildPdfQuote, pageText, spanTop } from "../src/components/canvas/pdftext.ts";

// --- minimal but valid PDF with two lines of text ---
const content = `BT /F1 24 Tf 72 720 Td (The quick brown fox) Tj 0 -30 Td (jumps over the lazy dog) Tj ET`;
const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let pdf = "%PDF-1.4\n";
const offs = [];
objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
writeFileSync("/tmp/t.pdf", pdf, "latin1");

const { getDocumentProxy } = await import("unpdf");
const doc = await getDocumentProxy(new Uint8Array(await (await import("node:fs")).readFileSync("/tmp/t.pdf")));
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 1 });
console.log("viewport:", vp.width, "x", vp.height, "rotation:", vp.rotation);
const tc = await page.getTextContent();
const items = tc.items.filter((it) => it.str && it.transform).map((it) => {
  const size = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 10;
  const cvp = vp.convertToViewportPoint ? vp.convertToViewportPoint(it.transform[4], it.transform[5]) : [it.transform[4], vp.height - it.transform[5]];
  return { s: it.str, x: cvp[0] / vp.width, by: cvp[1] / vp.height, w: (it.width || 0) / vp.width, h: size / vp.height };
});
console.log("items:", JSON.stringify(items, null, 1));

const assert = (await import("node:assert/strict")).default;
assert.equal(items.length, 2);
assert.ok(Math.abs(items[0].h - 24 / 792) < 0.001, "font size maps to fraction of page height");
assert.ok(Math.abs(items[0].x - 72 / 612) < 0.001, "x maps from left margin");
assert.ok(Math.abs(items[0].by - (792 - 720) / 792) < 0.001, "baseline maps from top (y-flip)");
assert.ok(items[0].w > 0.2 && items[0].w < 0.5, "advance width is a plausible fraction");
assert.equal(pageText(items), "The quick brown fox jumps over the lazy dog");

const r = markRects(items, { text: "brown fox" });
assert.equal(r.length, 1);
assert.ok(r[0].x > items[0].x && r[0].w < items[0].w, "partial-width rect inside the item");
assert.ok(Math.abs(r[0].y - spanTop(items[0].by, items[0].h)) < 1e-9, "rect sits an ascent above the baseline");

const q = buildPdfQuote("quick brown", "t.pdf", 1, pageText(items), 4);
assert.ok(q.includes("page 1") && q.includes("The") && q.includes("【quick brown】"));
console.log("\nquote:\n" + q);
console.log("\npdf-sanity: all assertions ok");
