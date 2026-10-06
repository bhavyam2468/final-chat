"use client";
/* Facade: the canvas implementation lives in ./canvas (types + geometry, WindowFrame, MinRail,
   Viewer + PdfView/Ink/Snip, CanvasLayer orchestration). Kept as one import site for App. */
export { CanvasLayer } from "./canvas/CanvasLayer";
export type { Win, Rect } from "./canvas/types";
export { contentRatio } from "./canvas/types";
