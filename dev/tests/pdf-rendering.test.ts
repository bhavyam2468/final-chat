// Run: node --experimental-strip-types dev/tests/pdf-rendering.test.ts
import assert from "node:assert/strict";
import { MAX_PARALLEL_PDF_RENDERS, PDF_PAGE_PIXEL_BUDGET, PDF_PREFETCH_RADIUS, PDF_TEXT_RADIUS, pdfPageRange, pdfRasterScale } from "../../src/lib/pdf-rendering.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };

t("page prefetch buffers both directions and clamps at document ends", () => {
  assert.deepEqual(pdfPageRange(10, 50), { start: 7, end: 13 });
  assert.deepEqual(pdfPageRange(1, 50), { start: 1, end: 4 });
  assert.deepEqual(pdfPageRange(50, 50), { start: 47, end: 50 });
  assert.deepEqual(pdfPageRange(0, 0), { start: 1, end: 0 });
  assert.deepEqual(pdfPageRange(8, 20, 0), { start: 8, end: 8 });
  assert.equal(pdfPageRange(10, 50).end - pdfPageRange(10, 50).start + 1, PDF_PREFETCH_RADIUS * 2 + 1);
});
t("raster scale honors the per-page pixel budget without undersampling smaller pages", () => {
  const scale = pdfRasterScale(1200, 1600, 2);
  assert.ok(scale > 0 && scale < 2);
  assert.ok(1200 * 1600 * scale * scale <= PDF_PAGE_PIXEL_BUDGET + 1);
  assert.equal(pdfRasterScale(500, 700, 2), 2);
  assert.equal(pdfRasterScale(500, 700, 0), 1);
});
t("page buffer, text extraction, and render concurrency stay bounded", () => {
  assert.equal(PDF_PREFETCH_RADIUS, 3);
  assert.equal(PDF_TEXT_RADIUS, 2);
  assert.equal(MAX_PARALLEL_PDF_RENDERS, 2);
  assert.ok(PDF_PAGE_PIXEL_BUDGET <= 2_000_000);
});

console.log(`\npdf-rendering.test: ${n} assertions ok`);
