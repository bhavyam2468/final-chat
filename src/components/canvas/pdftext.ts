/* Pure PDF text-layer geometry and quote composition — no imports, unit-testable in node.
   Items are fractions of the page box: x = left, by = baseline from top, w = advance, h = font size. */
export type TxtItem = { s: string; x: number; by: number; w: number; h: number };
export type RectF = { x: number; y: number; w: number; h: number };

export const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Reading order: by baseline, then x (same-line groups within ~0.4% of page height). */
export const reading = (items: TxtItem[]): TxtItem[] =>
  [...items].sort((a, b) => (Math.abs(a.by - b.by) > 0.004 ? a.by - b.by : a.x - b.x));

/** pdf.js-style span metrics: the box top sits one ascent above the baseline; line box = font size. */
export const spanTop = (by: number, h: number) => Math.max(0, by - 0.8 * h);
export const spanLine = (h: number) => h * 1.14;

/** Reading-order page text, used for quote context and highlight anchors. */
export const pageText = (items: TxtItem[]): string => reading(items).map((t) => t.s).join(" ");

/** Locate a marked passage inside a page's items → per-line highlight rects (fractions of the page). */
export function markRects(items: TxtItem[], mark: { text: string; pre?: string }): RectF[] {
  const n = norm(mark.text);
  if (!n) return [];
  const sorted = reading(items);
  const acc = sorted.map((t) => t.s).join(" ");
  let idx = -1;
  if (mark.pre) {
    const a = norm(mark.pre).slice(-36);
    const ai = acc.lastIndexOf(a);
    if (ai >= 0) idx = acc.indexOf(n, Math.max(0, ai - 4));
  }
  if (idx < 0) idx = acc.indexOf(n);
  if (idx < 0) return [];
  const end = idx + n.length;
  const out: RectF[] = [];
  let pos = 0;
  for (const it of sorted) {
    const t = norm(it.s);
    const s = pos, e = pos + t.length; // this item's character span inside `acc`
    pos = e + 1;
    if (e <= idx || s >= end || !t) continue;
    const len = Math.max(1, t.length);
    const f0 = Math.max(0, (idx - s) / len), f1 = Math.min(1, (end - s) / len);
    out.push({ x: it.x + it.w * f0, y: spanTop(it.by, it.h), w: it.w * (f1 - f0), h: spanLine(it.h) });
  }
  return out.filter((r) => r.w > 0.002);
}

/** Quote for the model: the selection, its source (file + page) and the text around it. */
export function buildPdfQuote(sel: string, file: string, page: number, text: string, span = 320): string {
  const at = norm(text).indexOf(norm(sel));
  const ctx = at >= 0 ? `Around it: …${slice(text, at - span, at)}【${sel}】${slice(text, at + norm(sel).length, at + norm(sel).length + span)}…` : "";
  return [sel, `— quoted from ${file}, page ${page}`, ctx].filter(Boolean).join("\n");
}

/** index in the whitespace-normalized text → index in the original (approximate; context only). */
function slice(text: string, ni: number, nj: number): string {
  // normalized = runs of whitespace collapsed to one space, ends trimmed: each run counts once
  const at = (n: number) => {
    let k = 0, i = 0, started = false, prevSpace = false;
    while (i < text.length && k < n) {
      const sp = /\s/.test(text[i]);
      if (!sp) { k++; started = true; }
      else if (started && !prevSpace) k++;
      prevSpace = sp;
      i++;
    }
    return Math.min(text.length, i);
  };
  const a = at(Math.max(0, ni)), b = Math.max(a, at(nj));
  return text.slice(a, b).replace(/\s+/g, " ").trim();
}
