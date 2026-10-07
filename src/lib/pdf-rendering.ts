/** Keep a small, direction-agnostic page buffer around the current PDF page. */
export const PDF_PREFETCH_RADIUS = 3;
export const PDF_TEXT_RADIUS = 2;
export const PDF_PAGE_PIXEL_BUDGET = 2_000_000;
export const MAX_PARALLEL_PDF_RENDERS = 2;

export type PdfPageRange = { start: number; end: number };

export function pdfPageRange(currentPage: number, totalPages: number, radius = PDF_PREFETCH_RADIUS): PdfPageRange {
  if (totalPages < 1) return { start: 1, end: 0 };
  const total = Math.max(1, Math.trunc(totalPages));
  const current = Math.min(total, Math.max(1, Math.trunc(currentPage)));
  const buffer = Math.max(0, Math.trunc(radius));
  return { start: Math.max(1, current - buffer), end: Math.min(total, current + buffer) };
}

/** Choose a capped device-pixel scale while preserving full CSS-size rendering where possible. */
export function pdfRasterScale(cssWidth: number, cssHeight: number, devicePixelRatio: number): number {
  const area = Math.max(1, cssWidth * cssHeight);
  const requestedScale = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(requestedScale, 2, Math.sqrt(PDF_PAGE_PIXEL_BUDGET / area));
}
