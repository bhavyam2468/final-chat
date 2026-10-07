"use client";
/* Canvas windows. Philosophy: the content IS the window. Bars float over it and stay out of the way
   (immersive by default, both floating and docked); hovering the top/bottom edge slides them in over
   the content; pinning turns them into real layout (content sits between them). Drag a window to the
   screen edge and it parks as a peek; click the peek to restore. Viewers contribute type-specific
   actions to the bottom bar, which scrolls inline instead of overflowing. */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pin, PinOff, Minus, X, PenLine, Eraser, NotebookPen, MessageSquareQuote, Download, Save, ExternalLink, PanelRight, PictureInPicture2, RotateCw, ZoomIn, ZoomOut, Code2, Eye, Scissors, Scan, FileText, Play } from "lucide-react";
import { CanvasSpec, fileUrl, useApp } from "./ctx";
import { Editor, langOf } from "./Editor";
import { RunDrawer, startRun, type RunState } from "./Runner";
import { runLangOf, runnablePath } from "@/lib/run-langs";
import { Block } from "./Block";
import { StreamMarkdown, CodeBlock } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "./Message";
import { SheetView, DocView, SlidesView, ArchiveView, MediaView, extOf } from "./viewers";
import { canvasPath } from "@/lib/shared";
import { MAX_PARALLEL_PDF_RENDERS, PDF_PREFETCH_RADIUS, PDF_TEXT_RADIUS, pdfPageRange, pdfRasterScale } from "@/lib/pdf-rendering";
import { createPdfRenderQueue, type PdfRenderJob } from "@/lib/pdf-render-queue";
import { ChatView } from "./ChatView";
import { TermView } from "./Terminal";
import { edgeAt, moveCanvasRect, peekCanvasRect, resizeCanvasRect, resizeEdgeAt, shouldDockCanvas, type CanvasRect, type PeekSide, type ResizeEdge } from "@/lib/canvas-layout";

export type Rect = CanvasRect;
export type Win = {
  id: string; spec: CanvasSpec; x: number; y: number; w: number; h: number; z: number;
  min: boolean; pinned: boolean; dock: boolean; peek?: Rect | null; peekSide?: PeekSide | null;
  /** the user moved the pin themselves: stop pinning the bars for them when they start editing */
  pinTouched?: boolean; autoPin?: boolean;
  peekFromDock?: boolean; dockPeek?: boolean; prevDockW?: number;
};

type Stroke = { c: string; w: number; p: [number, number][] };
const KINDS: [RegExp, string][] = [
  [/^(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/, "image"], [/^pdf$/, "pdf"], [/^html?$/, "html"], [/^ui$/, "ui"], [/^(md|markdown|mdx)$/, "md"],
  [/^(xlsx|xlsm|xls|ods|csv|tsv)$/, "sheet"], [/^(docx|doc|odt|rtf)$/, "doc"], [/^(pptx|ppt|odp|key)$/, "slides"],
  [/^(zip|jar|tar|tgz|tar\.gz|tar\.bz2|tar\.xz|whl|epub)$/, "archive"], [/^(mp4|webm|mov|mkv|m4v|ogv)$/, "video"], [/^(mp3|wav|ogg|m4a|flac|aac|opus)$/, "audio"],
  [/^(exe|bin|dmg|iso|so|dll|o|class|pyc|woff2?|ttf|otf|sqlite|db|gz|7z|rar|bz2|xz)$/, "binary"],
];
export const kindOf = (p: string) => { const e = extOf(p); return KINDS.find(([re]) => re.test(e))?.[1] || "text"; };
const baseName = (p: string) => p.split("/").pop() || p;
const notesPath = (p: string) => `notes/${baseName(p)}`;

/** Natural aspect ratio of the content, so a 16:9 image opens a ~16:9 window that hugs it. */
export function contentRatio(spec: CanvasSpec): Promise<{ ratio: number; pw?: number } | null> {
  return new Promise((res) => {
    const to = setTimeout(() => res(null), 1200);
    const done = (v: { ratio: number; pw?: number } | null) => { clearTimeout(to); res(v); };
    if (spec.kind === "youtube" || spec.kind === "web") return done({ ratio: 16 / 9 });
    if (spec.kind === "ui" || spec.kind === "md") return done({ ratio: 16 / 10 });
    if (spec.kind === "term") return done({ ratio: 1.72, pw: 780 });
    if (spec.kind !== "file") return done(null);
    const k = kindOf(spec.path);
    if (k === "video") return done({ ratio: 16 / 9 });
    if (k === "pdf" || k === "doc") return done({ ratio: 1 / 1.35 });
    if (k === "slides") return done({ ratio: 16 / 9 });
    if (k !== "image") return done(null);
    const im = new Image();
    im.onload = () => done(im.naturalWidth && im.naturalHeight ? { ratio: im.naturalWidth / im.naturalHeight, pw: im.naturalWidth } : null);
    im.onerror = () => done(null);
    im.src = fileUrl(spec.path);
  });
}

function Ink({ strokes, onChange, active }: { strokes: Stroke[]; onChange: (s: Stroke[]) => void; active: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const cur = useRef<Stroke | null>(null);
  const draw = useCallback(() => {
    const c = cv.current; if (!c) return;
    const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr); g.lineCap = "round"; g.lineJoin = "round";
    for (const s of [...strokes, ...(cur.current ? [cur.current] : [])]) {
      g.strokeStyle = s.c; g.lineWidth = s.w; g.globalAlpha = s.c.startsWith("rgba") ? 1 : 0.9; g.beginPath();
      s.p.forEach(([x, y], i) => (i ? g.lineTo(x * r.width, y * r.height) : g.moveTo(x * r.width, y * r.height)));
      g.stroke();
    }
  }, [strokes]);
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (cv.current) ro.observe(cv.current); return () => ro.disconnect(); }, [draw]);
  const pt = (e: React.PointerEvent): [number, number] => { const r = cv.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const accent = typeof window !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() : "#c07040";
  return <canvas ref={cv} className={"ink" + (active ? " on" : "")} style={{ width: "100%", height: "100%" }}
    onPointerDown={(e) => { if (!active) return; (e.target as Element).setPointerCapture(e.pointerId); cur.current = { c: e.shiftKey ? "rgba(214,170,88,.45)" : accent, w: e.shiftKey ? 14 : 2.2, p: [pt(e)] }; }}
    onPointerMove={(e) => { if (!cur.current) return; cur.current.p.push(pt(e)); draw(); }}
    onPointerUp={() => { if (cur.current && cur.current.p.length > 1) onChange([...strokes, cur.current]); cur.current = null; draw(); }} />;
}

type PdfViewportLike = {
  width: number;
  height: number;
  convertToViewportPoint?: (x: number, y: number) => [number, number];
};
type PdfRenderTask = { promise: Promise<void>; cancel?: () => void };
const pdfRenderQueue = createPdfRenderQueue(MAX_PARALLEL_PDF_RENDERS);
type PdfPageLike = {
  getViewport: (options: { scale: number }) => PdfViewportLike;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewportLike; canvas?: HTMLCanvasElement }) => PdfRenderTask;
  getTextContent?: () => Promise<{ items: unknown[] }>;
};
type PdfDocumentLike = { getPage: (n: number) => Promise<PdfPageLike>; numPages: number; destroy?: () => void };
type TxtItem = { s: string; x: number; y: number; w: number; h: number; angle: number };

function textBoxes(items: unknown[], viewport: PdfViewportLike): TxtItem[] {
  const point = (x: number, y: number): [number, number] => viewport.convertToViewportPoint
    ? viewport.convertToViewportPoint(x, y)
    : [x, viewport.height - y];
  return (items as { str?: string; transform?: number[]; width?: number; height?: number }[])
    .filter((item) => item.str && item.transform?.length === 6)
    .map((item) => {
      const m = item.transform!;
      const [a, b, c, d, e, f] = m;
      const baselineScale = Math.hypot(a, b) || 1;
      const ascentScale = Math.hypot(c, d) || Math.abs(d) || 1;
      const width = Math.max(0, item.width || 0);
      const height = Math.max(1, item.height || ascentScale);
      const p0 = point(e, f);
      const p1 = point(e + (a / baselineScale) * width, f + (b / baselineScale) * width);
      const p2 = point(e + (c / ascentScale) * height, f + (d / ascentScale) * height);
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const px = p2[0] - p0[0], py = p2[1] - p0[1];
      const screenWidth = Math.max(0.002, Math.hypot(dx, dy));
      const screenHeight = Math.max(0.002, Math.hypot(px, py));
      // Place each selectable run at its actual page-space baseline, including page/text rotation.
      const left = p2[0] / viewport.width;
      const top = p2[1] / viewport.height;
      return {
        s: item.str!, x: left, y: top,
        w: screenWidth / viewport.width, h: screenHeight / viewport.height,
        angle: Math.atan2(dy, dx),
      };
    })
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.w) && Number.isFinite(item.h));
}

function PdfPageSurface({
  doc, pageNumber, dimensions, zoom, currentPage, textEnabled, onError, children,
}: {
  doc: PdfDocumentLike; pageNumber: number; dimensions: { w: number; h: number }; zoom: number;
  currentPage: number; textEnabled: boolean; onError: () => void; children?: React.ReactNode;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderCycle = useRef(0);
  const renderTask = useRef<PdfRenderTask | null>(null);
  const renderPromise = useRef<Promise<void> | null>(null);
  const queuedRender = useRef<PdfRenderJob | null>(null);
  const priority = Math.abs(pageNumber - currentPage);
  const priorityRef = useRef(priority);
  const [textItems, setTextItems] = useState<TxtItem[] | null>(null);

  useEffect(() => {
    const outputCanvas = canvasRef.current;
    return () => { if (outputCanvas) { outputCanvas.width = 0; outputCanvas.height = 0; } };
  }, []);

  useLayoutEffect(() => {
    priorityRef.current = priority;
    pdfRenderQueue.reprioritize(queuedRender.current, priority);
  }, [priority]);

  // Keep text extraction to the nearest few pages; canvas raster prefetch is broader.
  useEffect(() => {
    if (!textEnabled || textItems !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent?.();
        if (!cancelled) setTextItems(content ? textBoxes(content.items, page.getViewport({ scale: 1 })) : []);
      } catch { if (!cancelled) setTextItems([]); }
    })();
    return () => { cancelled = true; };
  }, [doc, pageNumber, textEnabled, textItems]);

  useEffect(() => {
    const el = pageRef.current, canvas = canvasRef.current;
    if (!el || !canvas) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request = 0;
    const cycle = ++renderCycle.current;
    const render = async (requested: number) => {
      try {
        // Never reuse a canvas while an earlier PDF.js task still owns it.
        if (renderTask.current) {
          renderTask.current.cancel?.();
          try { await renderPromise.current; } catch { /* expected cancellation */ }
        }
        if (cancelled || cycle !== renderCycle.current || requested !== request) return;
        const cssWidth = el.clientWidth;
        if (cssWidth < 2) return;
        const page = await doc.getPage(pageNumber);
        if (cancelled || cycle !== renderCycle.current || requested !== request) return;
        const cssHeight = cssWidth * dimensions.h / dimensions.w;
        // Bound each backing bitmap and run at most two renders at once. A useful page buffer
        // then costs a predictable amount of memory instead of multiplying full-DPR canvases.
        const dpr = pdfRasterScale(cssWidth, cssHeight, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: (cssWidth / dimensions.w) * dpr });
        const buffer = document.createElement("canvas");
        buffer.width = Math.max(1, Math.ceil(viewport.width));
        buffer.height = Math.max(1, Math.ceil(viewport.height));
        const context = buffer.getContext("2d", { alpha: false });
        if (!context) { onError(); return; }
        context.fillStyle = "#fff";
        context.fillRect(0, 0, buffer.width, buffer.height);
        const task = page.render({ canvasContext: context, viewport, canvas: buffer });
        renderTask.current = task;
        renderPromise.current = task.promise;
        try {
          await task.promise;
          if (!cancelled && cycle === renderCycle.current && requested === request) {
            // Swap only after the new bitmap is complete; zoom/resize never flashes a blank page.
            canvas.width = buffer.width;
            canvas.height = buffer.height;
            const output = canvas.getContext("2d", { alpha: false });
            if (output) output.drawImage(buffer, 0, 0); else onError();
          }
        } finally {
          if (renderTask.current === task) { renderTask.current = null; renderPromise.current = null; }
        }
      } catch (error) {
        if (!cancelled && cycle === renderCycle.current && (error as { name?: string })?.name !== "RenderingCancelledException") {
          console.warn("PDF page render failed", error);
          onError();
        }
      }
    };
    const schedule = () => {
      request++;
      if (timer) clearTimeout(timer);
      pdfRenderQueue.cancel(queuedRender.current);
      queuedRender.current = null;
      renderTask.current?.cancel?.();
      const requested = request;
      const delay = Math.min(90, priorityRef.current * 14);
      timer = setTimeout(() => {
        if (cancelled || cycle !== renderCycle.current || requested !== request) return;
        queuedRender.current = pdfRenderQueue.enqueue(() => render(requested), priorityRef.current);
      }, delay);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      observer.disconnect();
      pdfRenderQueue.cancel(queuedRender.current);
      queuedRender.current = null;
      renderTask.current?.cancel?.();
    };
  }, [doc, pageNumber, dimensions.w, dimensions.h, zoom, onError]);

  return <div ref={pageRef} className="pdf-page" data-pdf-page={pageNumber}
    style={{ aspectRatio: `${dimensions.w}/${dimensions.h}`, width: `${zoom * 100}%` }}>
    <canvas ref={canvasRef} />
    {textEnabled && textItems?.length ? <div className="txtlayer" aria-label={`PDF page ${pageNumber} text`}>
      {textItems.map((item, itemIndex) => <span key={itemIndex} style={{
        left: `${item.x * 100}cqw`, top: `${item.y * 100}cqh`, width: `${item.w * 100}cqw`, height: `${item.h * 100}cqh`,
        fontSize: `${item.h * 100}cqh`, transform: `rotate(${item.angle}rad)`, transformOrigin: "left top",
      }}>{item.s}</span>)}
    </div> : null}
    {children}
  </div>;
}

/** Stable PDF canvas pages, a geometry-aligned selectable text layer, and keyboard navigation. */
function PdfView({ path, ink, setInk, pen, setBar, active }: { path: string; ink?: Record<string, Stroke[]>; setInk?: (k: string, s: Stroke[]) => void; pen?: boolean; setBar?: (n: React.ReactNode) => void; active: boolean }) {
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
  const [pdf, setPdf] = useState<PdfDocumentLike | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cur, setCur] = useState(1);
  const [pageEntry, setPageEntry] = useState("1");
  const curRef = useRef(cur);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    let loaded: PdfDocumentLike | null = null;
    const abort = new AbortController();
    (async () => {
      try {
        const { getDocumentProxy } = await import("unpdf");
        const response = await fetch(fileUrl(path), { signal: abort.signal });
        if (!response.ok) throw new Error(`Could not load PDF (${response.status})`);
        const buffer = new Uint8Array(await response.arrayBuffer());
        const document = await getDocumentProxy(buffer) as unknown as PdfDocumentLike;
        loaded = document;
        if (dead) { document.destroy?.(); return; }
        const dimensions: { w: number; h: number }[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          dimensions.push({ w: viewport.width, h: viewport.height });
        }
        if (dead) return;
        setPdf(document);
        setPages(dimensions);
      } catch (error) {
        if (!dead) { console.warn("PDF could not be opened", error); setFailed(true); }
      }
    })();
    return () => { dead = true; abort.abort(); loaded?.destroy?.(); };
  }, [path]);

  const onRenderError = useCallback(() => setFailed(true), []);
  const go = useCallback((pageNumber: number) => {
    const n = Math.max(1, Math.min(pages.length, pageNumber));
    const page = wrap.current?.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`);
    const behavior: ScrollBehavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    page?.scrollIntoView({ behavior, block: "start", inline: "nearest" });
    curRef.current = n;
    setCur(n); setPageEntry(String(n));
  }, [pages.length]);
  const zoomBy = useCallback((direction: number) => setZoom((current) => {
    let next = Math.max(0.5, Math.min(3, +(current + direction * 0.25).toFixed(2)));
    if (Math.abs(next - 1) < 0.13) next = 1;
    return next;
  }), []);
  const commitPage = useCallback(() => {
    const pageNumber = Number(pageEntry);
    if (Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= pages.length) go(pageNumber);
    else setPageEntry(String(cur));
  }, [pageEntry, pages.length, go, cur]);

  useEffect(() => {
    const body = wrap.current?.closest(".win-body");
    if (!body) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bodyRect = body.getBoundingClientRect();
        const midpointY = bodyRect.top + body.clientHeight * 0.34;
        const midpointX = bodyRect.left + body.clientWidth * 0.5;
        const page = document.elementFromPoint(midpointX, midpointY)?.closest<HTMLElement>("[data-pdf-page]");
        const best = Number(page?.dataset.pdfPage);
        if (best && curRef.current !== best) {
          curRef.current = best;
          setCur(best);
          setPageEntry(String(best));
        }
      });
    };
    body.addEventListener("scroll", update, { passive: true });
    update();
    return () => { body.removeEventListener("scroll", update); cancelAnimationFrame(frame); };
  }, [pages]);

  useEffect(() => {
    if (!setBar) return;
    setBar(pages.length ? <>
      <span className="v-meta num"><input className="v-page" type="number" min={1} max={pages.length} value={pageEntry}
        onChange={(event) => setPageEntry(event.target.value)} onBlur={commitPage}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitPage(); event.currentTarget.blur(); } }} aria-label="Page" /> / {pages.length}</span>
      <button className="ib sm" aria-label="Zoom out" title="Zoom out (-)" onClick={() => zoomBy(-1)}><ZoomOut /></button>
      <span className="v-meta num">{Math.round(zoom * 100)}%</span>
      <button className="ib sm" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1)}><ZoomIn /></button>
      <button className={"ib sm" + (zoom === 1 ? " on" : "")} aria-label="Fit to canvas" title="Fit page to canvas (0)" onClick={() => setZoom(1)}><Scan /></button>
    </> : null);
  }, [pages, pageEntry, zoom, setBar, go, zoomBy, commitPage]);

  useEffect(() => {
    const windowEl = wrap.current?.closest(".win");
    const body = wrap.current?.closest(".win-body") as HTMLElement | null;
    if (!windowEl || !body || !pages.length) return;
    let pointerInside = windowEl.matches(":hover");
    const enter = () => { pointerInside = true; };
    const leave = () => { pointerInside = false; };
    const onKey = (event: KeyboardEvent) => {
      if (windowEl.classList.contains("minimized") || windowEl.classList.contains("peek") || windowEl.classList.contains("dockpeek")) return;
      if ((!pointerInside && !windowEl.contains(document.activeElement)) || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, button, [contenteditable=true]")) return;
      const behavior: ScrollBehavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      if (event.key === "ArrowDown") body.scrollBy({ top: 96, behavior });
      else if (event.key === "ArrowUp") body.scrollBy({ top: -96, behavior });
      else if (event.key === "ArrowRight") body.scrollBy({ left: Math.max(80, body.clientWidth * 0.12), behavior });
      else if (event.key === "ArrowLeft") body.scrollBy({ left: -Math.max(80, body.clientWidth * 0.12), behavior });
      else if (event.key === "PageDown" || (event.key === " " && !event.shiftKey)) { go(curRef.current + 1); }
      else if (event.key === "PageUp" || (event.key === " " && event.shiftKey)) { go(curRef.current - 1); }
      else if (event.key === "Home") { go(1); }
      else if (event.key === "End") { go(pages.length); }
      else if (event.key === "+" || event.key === "=") zoomBy(1);
      else if (event.key === "-" || event.key === "_") zoomBy(-1);
      else if (event.key === "0") setZoom(1);
      else return;
      event.preventDefault();
    };
    windowEl.addEventListener("mouseenter", enter);
    windowEl.addEventListener("mouseleave", leave);
    addEventListener("keydown", onKey);
    return () => {
      windowEl.removeEventListener("mouseenter", enter);
      windowEl.removeEventListener("mouseleave", leave);
      removeEventListener("keydown", onKey);
    };
  }, [pages.length, go, zoomBy]);

  if (failed) return <iframe className="full" src={fileUrl(path)} title={path} />;
  if (!pdf || !pages.length) return <div className="pdf-loading" role="status">Loading PDF…</div>;
  const prefetchRange = pdfPageRange(cur, pages.length, PDF_PREFETCH_RADIUS);
  return <div ref={wrap} className="pdfwrap">{pages.map((dimensions, index) => {
    const pageNumber = index + 1;
    const distance = Math.abs(pageNumber - cur);
    const pageStyle = { aspectRatio: `${dimensions.w}/${dimensions.h}`, width: `${zoom * 100}%` };
    if (!active || pageNumber < prefetchRange.start || pageNumber > prefetchRange.end) {
      return <div key={pageNumber} className="pdf-page" data-pdf-page={pageNumber} aria-hidden="true" style={pageStyle} />;
    }
    return <PdfPageSurface key={pageNumber} doc={pdf} pageNumber={pageNumber} dimensions={dimensions} zoom={zoom}
      currentPage={cur} textEnabled={distance <= PDF_TEXT_RADIUS} onError={onRenderError}>
      {setInk && <Ink strokes={ink?.[pageNumber] || []} onChange={(strokes) => setInk(String(pageNumber), strokes)} active={!!pen} />}
    </PdfPageSurface>;
  })}</div>;
}

/** Drag a rectangle over the rendered content; the region is composited from the visible
    canvases/images/video frames and handed back as a PNG (pasted into the input bar). */
function SnipLayer({ winId, onDone }: { winId: string; onDone: (b: Blob) => void }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const finish = (r: Rect) => {
    const body = document.querySelector(`[data-win="${winId}"] .win-body`);
    if (!body || r.w < 8 || r.h < 8) return;
    const dpr = devicePixelRatio || 1;
    const out = document.createElement("canvas");
    out.width = Math.round(r.w * dpr); out.height = Math.round(r.h * dpr);
    const g = out.getContext("2d")!; g.scale(dpr, dpr);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#fff";
    g.fillRect(0, 0, r.w, r.h);
    for (const el of [...body.querySelectorAll("canvas, img, video")] as (HTMLCanvasElement | HTMLImageElement | HTMLVideoElement)[]) {
      const er = el.getBoundingClientRect();
      const L = Math.max(r.x, er.left), T = Math.max(r.y, er.top);
      const R = Math.min(r.x + r.w, er.right), B = Math.min(r.y + r.h, er.bottom);
      const iw = R - L, ih = B - T; if (iw <= 0 || ih <= 0) continue;
      const sw = el instanceof HTMLCanvasElement ? el.width : el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
      const sh = el instanceof HTMLCanvasElement ? el.height : el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
      if (!sw || !sh) continue;
      try { g.drawImage(el, ((L - er.left) / er.width) * sw, ((T - er.top) / er.height) * sh, (iw / er.width) * sw, (ih / er.height) * sh, L - r.x, T - r.y, iw, ih); } catch { /* tainted or undecoded */ }
    }
    out.toBlob((b) => b && onDone(b), "image/png");
  };
  const updateRect = (x: number, y: number) => {
    const origin = start.current;
    if (!origin) return null;
    const next = { x: Math.min(origin.x, x), y: Math.min(origin.y, y), w: Math.abs(x - origin.x), h: Math.abs(y - origin.y) };
    setRect(next);
    return next;
  };
  return <>
    <div className="snip" role="application" aria-label="Snip region"
      onPointerDown={(event) => {
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, y: event.clientY };
        setRect({ x: event.clientX, y: event.clientY, w: 0, h: 0 });
      }}
      onPointerMove={(event) => { updateRect(event.clientX, event.clientY); }}
      onPointerUp={(event) => {
        const finalRect = updateRect(event.clientX, event.clientY);
        if (finalRect) finish(finalRect);
        start.current = null; setRect(null);
      }}
      onPointerCancel={() => { start.current = null; setRect(null); }}>
      <span className="snip-hint">drag to snip · esc to cancel</span>
    </div>
    {rect && rect.w > 2 && createPortal(
      <div className="snip-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />,
      document.body,
    )}
  </>;
}

const Viewer = memo(function Viewer({ spec, winId, dock, active, onDock, onEdit }: { spec: CanvasSpec; winId: string; dock: boolean; active: boolean; onDock: (id: string, dock: boolean) => void; onEdit: (id: string, editing: boolean) => void }) {
  const app = useApp();
  const md = useMdHandlers();
  const path = spec.kind === "file" ? spec.path : spec.kind === "ui" ? spec.path : undefined;
  const k = spec.kind === "file" ? kindOf(spec.path) : spec.kind;
  const [mode, setMode] = useState<"a" | "b">("a");
  const [src, setSrc] = useState<string>(spec.kind === "ui" ? spec.source : "");
  const [dirty, setDirty] = useState(false);
  const [pen, setPen] = useState(false);
  const [snip, setSnip] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [ink, setInkAll] = useState<Record<string, Stroke[]>>({});
  const [rev, setRev] = useState(0);
  const [bar, setBar] = useState<React.ReactNode>(null);
  const [run, setRun] = useState<RunState | null>(null);
  // auto = re-run on save (the "compile while I edit" loop); compiled languages default to it, and the
  // user's toggle sticks per file. Read during render: it is a synchronous preference, not state to sync.
  const [autoPref, setAutoPref] = useState<boolean | null>(null);
  const runStop = useRef<(() => void) | null>(null);
  const runnable = spec.kind === "file" && k === "text" && runnablePath(spec.path);
  const auto = autoPref ?? (() => { if (!path) return false; try { const saved = localStorage.getItem("run:auto:" + path); return saved !== null ? saved === "1" : !!runLangOf(path)?.compile; } catch { return !!runLangOf(path)?.compile; } })();
  const lang = k === "ui" ? langOf("canvas.ui") : langOf(path);
  const editing = mode === "b" && ["ui", "html", "md", "text"].includes(k);
  const annot = k === "pdf" || k === "image" || k === "html";
  const snippable = k === "pdf" || k === "image" || k === "video";
  const notable = !!path && ["pdf", "image", "html", "doc", "slides", "sheet", "video", "audio", "md", "text"].includes(k);

  // `loaded` gates Run/Save: before the file body arrives the buffer is empty, and saving it then would
  // wipe the file on disk (a slow fetch plus a fast Ctrl+S used to do exactly that).
  const [loaded, setLoaded] = useState(spec.kind === "ui" && !!spec.source);
  useEffect(() => {
    if (!path || !["text", "md", "html", "ui"].includes(k) || (spec.kind === "ui" && spec.source)) return;
    let dead = false;
    fetch(fileUrl(path), { cache: "no-store" }).then((r) => r.text()).then((text) => { if (!dead) { setSrc(text); setLoaded(true); } });
    return () => { dead = true; };
  }, [path, k, spec, rev]);
  useEffect(() => {
    if (!path || !annot) return;
    fetch(fileUrl(notesPath(path) + ".ink.json"), { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then((j: { pages?: Record<string, Stroke[]> }) => setInkAll(j.pages || {})).catch(() => {});
  }, [path, annot]);
  const save = useCallback(async () => {
    if (!path || !loaded) return;
    await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path, content: src }) });
    setDirty(false); app.refreshTree();
  }, [loaded, path, src, app]);
  // an editing canvas keeps its bars in the layout: a floating header over a file being typed in is noise
  useEffect(() => { onEdit(winId, editing); return () => onEdit(winId, false); }, [editing, onEdit, winId]);
  useEffect(() => () => { runStop.current?.(); }, []);

  const doRun = useCallback(() => {
    if (!path || !runnable || !loaded) return;
    runStop.current?.();
    setRun({ phase: "running", out: "", lang: lang.label });
    runStop.current = startRun(path, src, {
      start: (i) => setRun((r) => (r ? { ...r, compile: i.compile, lang: i.lang || r.lang } : r)),
      chunk: (chunk) => setRun((r) => (r ? { ...r, out: (r.out + chunk).slice(-200_000) } : r)),
      done: (res) => setRun((r) => (r ? { ...r, phase: "done", code: res.code, ms: res.ms, out: (res.out || r.out).slice(-200_000), cmd: res.cmd || r.cmd } : r)),
    });
  }, [lang.label, loaded, path, runnable, src]);
  const askAboutRun = useCallback(() => {
    if (!path) return;
    app.sendText(`My run of \`${path}\` failed (exit ${run?.code ?? "?"}). Read the last run output and fix the code.`);
  }, [app, path, run?.code]);
  const saveAndRun = useCallback(async () => { await save(); if (auto && runnable) doRun(); }, [auto, doRun, runnable, save]);
  const setAuto = useCallback((v: boolean) => { setAutoPref(v); try { if (path) localStorage.setItem("run:auto:" + path, v ? "1" : "0"); } catch { /* private mode */ } }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSnip(false); if ((e.metaKey || e.ctrlKey) && e.key === "s" && dirty && document.activeElement?.closest(`[data-win="${winId}"]`)) { e.preventDefault(); saveAndRun(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saveAndRun, winId]);
  const saveNotes = useCallback(async (nextInk = ink, text = notes) => {
    if (!path) return;
    const counts = Object.entries(nextInk).filter(([, s]) => s.length).map(([pg, s]) => `- ${k === "pdf" ? "page " + pg : "view"}: ${s.length} mark${s.length > 1 ? "s" : ""}`).join("\n");
    if (annot) await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: notesPath(path) + ".ink.json", content: JSON.stringify({ file: path, pages: nextInk }) }) });
    if (text !== null) await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: notesPath(path) + ".md", content: `# Notes: ${path}\n\n${text}\n\n## Annotations\n${counts || "- none"}\n` }) });
    app.refreshTree();
  }, [path, ink, notes, k, app, annot]);
  const setInk = (key: string, s: Stroke[]) => { const n = { ...ink, [key]: s }; setInkAll(n); saveNotes(n); };
  const openNotes = async () => {
    if (notes !== null) { await saveNotes(); setNotes(null); return; }
    const r = await fetch(fileUrl(notesPath(path!) + ".md"), { cache: "no-store" });
    const t = r.ok ? await r.text() : "";
    setNotes(t.replace(/^# Notes:.*\n\n/, "").replace(/\n\n## Annotations[\s\S]*$/, ""));
  };
  const onSnip = (b: Blob) => {
    setSnip(false);
    const f = new File([b], `snip-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.png`, { type: "image/png" });
    app.addFiles([f]); // lands in the input bar as an attachment, ready to send
  };

  const editor = <Editor value={src} path={path} lang={lang} onChange={(next) => { setSrc(next); setDirty(true); }} onSave={saveAndRun} onRun={runnable ? doRun : undefined} />;
  const Pdf = useCallback((p: { path: string }) => <PdfView key={p.path} path={p.path} active={active} />, [active]);
  let body: React.ReactNode = null;
  if (spec.kind === "youtube") body = <iframe className="full black" src={`https://www.youtube-nocookie.com/embed/${spec.id}?autoplay=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title="YouTube" />;
  else if (spec.kind === "web") body = <iframe key={rev} className="full" src={spec.url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" title={spec.title} />;
  else if (spec.kind === "md") body = <div className="reader"><StreamMarkdown text={spec.body} {...md} /></div>;
  else if (spec.kind === "chat") body = <ChatView id={spec.id} setBar={setBar} />;
  else if (spec.kind === "term") body = <TermView spec={spec} setBar={setBar} />;
  else if (k === "ui") body = mode === "a" ? <Block key={rev + ":" + src.length} source={src} done fill /> : editor;
  else if (k === "image") body = <div className="imgview">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={fileUrl(path!)} alt="" /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} active={pen} /></div>;
  else if (k === "pdf") body = <PdfView key={path} path={path!} ink={ink} setInk={setInk} pen={pen} setBar={setBar} active={active} />;
  else if (k === "html") body = mode === "a" ? <div style={{ position: "relative", height: "100%" }}><iframe key={rev} className="full" src={fileUrl(path!)} sandbox="allow-scripts allow-forms allow-popups allow-modals" title={path} /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} active={pen} /></div> : editor;
  else if (k === "md") body = mode === "a" ? <div className="reader"><StreamMarkdown text={src} {...md} /></div> : editor;
  else if (k === "text") body = mode === "a" ? <div className="reader code"><CodeBlock code={src} lang={extOf(path!)} done /></div> : editor;
  else if (k === "sheet") body = <SheetView path={path!} setBar={setBar} />;
  else if (k === "doc") body = <DocView path={path!} setBar={setBar} Pdf={Pdf} />;
  else if (k === "slides") body = <SlidesView path={path!} setBar={setBar} Pdf={Pdf} />;
  else if (k === "archive") body = <ArchiveView path={path!} setBar={setBar} />;
  else if (k === "video" || k === "audio") body = <MediaView src={fileUrl(path!)} video={k === "video"} setBar={setBar} />;
  else body = <div className="v-msg"><a className="txt-btn solid" href={fileUrl(path!)} download>Download {baseName(path!)}</a></div>;

  const toggle: Record<string, [string, string]> = { ui: ["Preview", "Code"], html: ["Preview", "Code"], md: ["Read", "Edit"], text: ["Read", "Edit"] };
  const drawer = run ? <RunDrawer run={run} path={path || spec.title} auto={auto} setAuto={setAuto} onRun={doRun}
    onStop={() => { runStop.current?.(); setRun((r) => (r ? { ...r, phase: "done", code: 130 } : r)); }}
    onClose={() => { runStop.current?.(); setRun(null); }} onAsk={askAboutRun} /> : null;
  const external = spec.kind === "web" ? spec.url : spec.kind === "youtube" ? `https://youtu.be/${spec.id}` : null;
  return <>
    <div className={"win-body k-" + k + (editing ? " editing" : "")}>{drawer ? <div className="ed-wrap">{body}{drawer}</div> : body}</div>
    {snip && <SnipLayer winId={winId} onDone={onSnip} />}
    {notes !== null && <div className="notes"><textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => saveNotes()} aria-label="Notes" /></div>}
    <div className="win-bar bot">
      {toggle[k] && <div className="seg"><button className={mode === "a" ? "on" : ""} onClick={() => setMode("a")} aria-label={toggle[k][0]}>{mode === "a" ? <Eye /> : null}{toggle[k][0]}</button><button className={mode === "b" ? "on" : ""} onClick={() => setMode("b")} aria-label={toggle[k][1]}>{mode === "b" ? <Code2 /> : null}{toggle[k][1]}</button></div>}
      {dirty && path && <button className="ib sm" aria-label="Save" title="Save (Ctrl+S)" onClick={saveAndRun}><Save /></button>}
      {runnable && <button className={"ib sm" + (run?.phase === "running" ? " on" : "")} aria-label="Run" title="Run this file in the sandbox (Ctrl+Enter)" onClick={doRun}><Play /></button>}
      {spec.kind === "ui" && !spec.path && <button className="ib sm" aria-label="Save to artifacts" title="Save to artifacts" onClick={async () => { const p = canvasPath(spec.title, "<ui>", app.convId || undefined); await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: p, content: src }) }); app.refreshTree(); }}><Save /></button>}
      {bar}
      {!bar && <span className="sp" />}
      {snippable && <button className={"ib sm" + (snip ? " on" : "")} aria-label="Snip to input" title="Snip a region into the input bar" onClick={() => setSnip(!snip)}><Scissors /></button>}
      {(k === "ui" || spec.kind === "web" || k === "html") && <button className="ib sm" aria-label="Reload" title="Reload" onClick={() => setRev((r) => r + 1)}><RotateCw /></button>}
      {annot && (k !== "html" || mode === "a") && <>
        <button className={"ib sm" + (pen ? " on" : "")} aria-label="Annotate" title="Pen (hold Shift to highlight)" onClick={() => setPen(!pen)}><PenLine /></button>
        {pen && <button className="ib sm" aria-label="Clear marks" title="Clear marks" onClick={() => { setInkAll({}); saveNotes({}); }}><Eraser /></button>}
      </>}
      {notable && <button className={"ib sm" + (notes !== null ? " on" : "")} aria-label="Notes" title="Notes (saved to notes/)" onClick={openNotes}><NotebookPen /></button>}
      {path && <button className="ib sm" aria-label="Ask about this" title="Ask about this" onClick={() => app.mention(path)}><MessageSquareQuote /></button>}
      {path && <a className="ib sm" aria-label="Download" title="Download" href={fileUrl(path)} download><Download /></a>}
      {external && <a className="ib sm" aria-label="Open in browser" title="Open in browser" href={external} target="_blank" rel="noreferrer"><ExternalLink /></a>}
      <span className="bar-sep" />
      <button className="ib sm" aria-label={dock ? "Float" : "Dock beside chat"} title={dock ? "Float canvas" : "Dock beside chat"}
        onClick={() => onDock(winId, !dock)}>{dock ? <PictureInPicture2 /> : <PanelRight />}</button>
    </div>
  </>;
});

export function CanvasLayer({ wins, setWins, dockW, setDockW }: { wins: Win[]; setWins: React.Dispatch<React.SetStateAction<Win[]>>; dockW: number; setDockW: (w: number) => void }) {
  const [show, setShow] = useState<Record<string, { t: boolean; b: boolean }>>({});
  const [resizeHover, setResizeHover] = useState<Record<string, ResizeEdge | null>>({});
  const [ghost, setGhost] = useState<{ id: string; rect: CanvasRect; mode: "resize" | "undock"; title: string } | null>(null);
  const [dockPreviewW, setDockPreviewW] = useState<number | null>(null);
  const winsRef = useRef(wins);
  useLayoutEffect(() => { winsRef.current = wins; }, [wins]);
  const dragEnd = useRef<{ id: string; at: number } | null>(null);
  const stopDragRef = useRef<(() => void) | null>(null);

  const reveal = (id: string, zone: "t" | "b" | null) => {
    setShow((state) => {
      const current = state[id] || { t: false, b: false };
      const next = zone === null ? { t: false, b: false } : { ...current, [zone]: true };
      return next.t === current.t && next.b === current.b ? state : { ...state, [id]: next };
    });
  };
  const updateResizeHover = (id: string, edge: ResizeEdge | null) => setResizeHover((state) =>
    state[id] === edge ? state : { ...state, [id]: edge },
  );
  const upd = (id: string, patch: Partial<Win>) => setWins((state) => state.map((win) => win.id === id ? { ...win, ...patch } : win));
  const front = (id: string) => setWins((state) => {
    const top = Math.max(0, ...state.map((win) => win.z));
    const current = state.find((win) => win.id === id);
    if (!current || current.z === top) return state;
    return state.map((win) => win.id === id ? { ...win, z: top + 1 } : win);
  });

  const restore = (id: string) => {
    const win = wins.find((item) => item.id === id);
    if (!win) return;
    const wasDocked = !!win.peekFromDock || (!!win.min && win.dock) || !!win.dockPeek;
    const occupied = wins.some((item) => item.id !== id && item.dock && !item.min && !item.peek && !item.dockPeek);
    const dock = wasDocked && innerWidth >= 760 && shouldDockCanvas(true, occupied);
    if (dock && win.prevDockW) setDockW(win.prevDockW);
    const top = Math.max(0, ...wins.map((item) => item.z)) + 1;
    upd(id, {
      ...(win.peek || {}), z: top, min: false, dock,
      peek: null, peekSide: null, peekFromDock: false, dockPeek: false,
    });
  };

  /** An editing canvas pins its bars (header/footer in the layout) unless the user unpinned them by hand. */
  const setEdit = useCallback((id: string, editing: boolean) => setWins((state) => state.map((win) => {
    if (win.id !== id || win.pinTouched) return win;
    if (editing) return win.pinned ? { ...win, autoPin: true } : { ...win, pinned: true, autoPin: true };
    return win.autoPin && win.pinned ? { ...win, pinned: false, autoPin: false } : win;
  })), [setWins]);

  const setDock = useCallback((id: string, dock: boolean) => {
    const occupied = winsRef.current.some((win) => win.id !== id && win.dock && !win.min && !win.peek && !win.dockPeek);
    const nextDock = dock && innerWidth >= 760 && shouldDockCanvas(true, occupied);
    setWins((state) => state.map((win) => win.id === id ? {
      ...win, dock: nextDock, min: false, peek: null, peekSide: null, peekFromDock: false, dockPeek: false,
    } : win));
  }, [setWins]);

  useEffect(() => () => { stopDragRef.current?.(); }, []);

  const drag = (event: React.PointerEvent, win: Win, kind: "move" | "resize" | "dock", edge?: ResizeEdge) => {
    if ((event.target as HTMLElement).closest("button") && kind === "move") return;
    if (win.min || win.peek || win.dockPeek || (kind === "resize" && win.dock)) return;
    event.preventDefault();
    stopDragRef.current?.();
    setGhost(null); setDockPreviewW(null);
    front(win.id);
    const cursorClass = kind === "move" ? "dragging-cursor-move" : kind === "dock" ? "dragging-cursor-dock" : `dragging-cursor-${edge || "se"}`;
    document.body.classList.add("dragging", cursorClass);

    const startX = event.clientX, startY = event.clientY;
    const viewport = { width: innerWidth, height: innerHeight };
    const origin: CanvasRect = { x: win.x, y: win.y, w: win.w, h: win.h };
    const fromDock = kind === "move" && win.dock;
    const originalDockW = dockW;
    const dockLeft = Math.max(8, viewport.width - originalDockW - 8);
    const floatOrigin: CanvasRect = fromDock ? {
      x: dockLeft,
      y: Math.max(0, Math.min(viewport.height - Math.max(180, win.h), startY - 14)),
      w: Math.max(320, Math.min(viewport.width - 48, win.w || originalDockW)),
      h: Math.max(180, Math.min(viewport.height - 24, win.h || viewport.height * 0.72)),
    } : origin;
    let moved = false;
    let liveDockW = originalDockW;
    let finalRect = fromDock ? floatOrigin : origin;
    let raf = 0;
    let currentPointer = { x: startX, y: startY };
    const pointerId = event.pointerId;
    let blurCancel = () => {};

    if (kind === "resize") setGhost({ id: win.id, rect: origin, mode: "resize", title: win.spec.title });
    else if (fromDock) setGhost({ id: win.id, rect: floatOrigin, mode: "undock", title: win.spec.title });
    else if (kind === "dock") setDockPreviewW(originalDockW);

    const rectFor = (x: number, y: number): CanvasRect => {
      const dx = x - startX, dy = y - startY;
      if (kind === "resize") return resizeCanvasRect(origin, dx, dy, edge || "se", viewport);
      return moveCanvasRect(fromDock ? floatOrigin : origin, dx, dy, viewport);
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      currentPointer = { x: pointer.clientX, y: pointer.clientY };
      const dx = pointer.clientX - startX, dy = pointer.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      if (kind === "dock") {
        liveDockW = Math.max(320, Math.min(viewport.width - 300, Math.round(originalDockW - dx)));
        setDockPreviewW(liveDockW);
        return;
      }
      finalRect = rectFor(pointer.clientX, pointer.clientY);
      if (kind === "resize" || fromDock) {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setGhost({
          id: win.id, rect: finalRect, mode: kind === "resize" ? "resize" : "undock", title: win.spec.title,
        }));
      } else {
        upd(win.id, { x: finalRect.x, y: finalRect.y, peek: null, peekSide: null, peekFromDock: false });
      }
    };
    const detach = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("blur", blurCancel);
      document.body.classList.remove("dragging", cursorClass);
      if (stopDragRef.current === detach) stopDragRef.current = null;
    };
    const finish = (pointer: PointerEvent, cancelled: boolean) => {
      if (pointer.pointerId !== pointerId) return;
      if (!cancelled) {
        currentPointer = { x: pointer.clientX, y: pointer.clientY };
        if (Math.abs(pointer.clientX - startX) + Math.abs(pointer.clientY - startY) > 4) moved = true;
        if (kind === "dock" && moved) liveDockW = Math.max(320, Math.min(viewport.width - 300, Math.round(originalDockW - (pointer.clientX - startX))));
      }
      if (raf) cancelAnimationFrame(raf);
      detach();
      setGhost(null);
      setDockPreviewW(null);
      if (cancelled) {
        if (kind === "move" && !fromDock) upd(win.id, { x: origin.x, y: origin.y });
        return;
      }
      if (moved) dragEnd.current = { id: win.id, at: Date.now() };
      if (kind === "dock") {
        if (moved) setDockW(liveDockW);
        return;
      }
      if (!moved) return;
      finalRect = rectFor(currentPointer.x, currentPointer.y);
      if (kind === "resize") {
        upd(win.id, { ...finalRect });
        return;
      }
      const side = edgeAt(currentPointer.x, currentPointer.y, viewport);
      if (side) {
        const tab = peekCanvasRect(finalRect, side, viewport);
        upd(win.id, {
          ...tab, dock: false, min: false, peek: finalRect, peekSide: side,
          peekFromDock: !!fromDock, prevDockW: fromDock ? originalDockW : win.prevDockW, dockPeek: false,
        });
      } else if (fromDock) {
        upd(win.id, {
          ...finalRect, dock: false, min: false, peek: null, peekSide: null,
          peekFromDock: false, dockPeek: false,
        });
      } else {
        upd(win.id, { ...finalRect, peek: null, peekSide: null, peekFromDock: false });
      }
    };
    const up = (pointer: PointerEvent) => finish(pointer, false);
    const cancel = (pointer: PointerEvent) => finish(pointer, true);
    blurCancel = () => finish({ pointerId, clientX: currentPointer.x, clientY: currentPointer.y } as PointerEvent, true);
    stopDragRef.current = detach;
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
    addEventListener("blur", blurCancel);
  };

  const minimized = wins.filter((win) => win.min).sort((a, b) => b.z - a.z);
  // Keep each Viewer mounted while shelved so drafts, notes, annotations, and media state survive.
  const shelfIcon = (win: Win) => {
    if (win.spec.kind === "chat") return <MessageSquareQuote />;
    if (win.spec.kind === "web" || win.spec.kind === "youtube") return <Eye />;
    if (win.spec.kind === "ui") return <Code2 />;
    if (win.spec.kind === "file" && kindOf(win.spec.path) === "image") return <Scan />;
    return <FileText />;
  };

  return <>
    {minimized.length > 0 && <aside className="canvas-shelf" aria-label="Minimized canvases">
      {minimized.map((win) => <div className="canvas-shelf-item" key={win.id}>
        <button className="canvas-shelf-restore" title={`Restore ${win.spec.title}`} aria-label={`Restore ${win.spec.title}`} onClick={() => restore(win.id)}>
          {shelfIcon(win)}
        </button>
        <button className="canvas-shelf-close" title={`Close ${win.spec.title}`} aria-label={`Close ${win.spec.title}`}
          onClick={() => setWins((state) => state.filter((item) => item.id !== win.id))}><X /></button>
      </div>)}
    </aside>}

    {wins.map((win) => {
      const parked = !!win.peek || !!win.dockPeek;
      const parkedSide = win.peekSide || (win.peek ? (win.x > win.peek.x ? "right" : "left") : "right");
      const docked = win.dock && !win.min && !parked;
      const legacyDockPeekRect = win.dockPeek && !win.peek
        ? { x: innerWidth - 18, y: Math.max(24, Math.min(innerHeight - 168, win.y || 24)), w: 18, h: 144 }
        : null;
      const parkedRect = win.peek ? { x: win.x, y: win.y, w: win.w, h: win.h } : legacyDockPeekRect;
      const className = `win${win.min ? " minimized" : ""}${win.pinned ? " pinned" : ""}${docked ? " docked" : ""}${parked ? ` peek peek-${parkedSide}` : ""}${win.dockPeek ? " dockpeek" : ""}${show[win.id]?.t ? " show-t" : ""}${show[win.id]?.b ? " show-b" : ""}${resizeHover[win.id] ? ` resize-hover-${resizeHover[win.id]}` : ""}`;
      const dockStyle: React.CSSProperties = { left: "calc(100vw - var(--dockw) - 8px)", top: 8, width: "var(--dockw)", height: "calc(100vh - 16px)", zIndex: 30 };
      const floatStyle: React.CSSProperties = parkedRect
        ? { left: parkedRect.x, top: parkedRect.y, width: parkedRect.w, height: parkedRect.h, zIndex: 40 + win.z }
        : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: 40 + win.z };
      const style: React.CSSProperties = win.min
        ? { ...(win.dock ? dockStyle : floatStyle), zIndex: -1, visibility: "hidden", pointerEvents: "none" }
        : docked ? dockStyle : floatStyle;
      return <div key={win.id} data-win={win.id} data-title={win.spec.title}
        data-source={win.spec.kind === "file" ? win.spec.path : undefined}
        className={className} style={style} aria-hidden={win.min || undefined} inert={win.min || undefined}
        role={parked ? "button" : undefined} tabIndex={parked ? 0 : undefined} aria-label={parked ? `Restore ${win.spec.title}` : undefined}
        title={parked ? `Restore ${win.spec.title}` : undefined}
        onPointerDown={() => front(win.id)}
        onClick={() => { if (dragEnd.current?.id === win.id && Date.now() - dragEnd.current.at < 400) return; if (parked || win.dockPeek) restore(win.id); }}
        onKeyDown={(event) => { if (parked && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); restore(win.id); } }}
        onPointerMove={(pointer) => {
          const bounds = pointer.currentTarget.getBoundingClientRect();
          const edge = !win.dock && !win.min && !parked
            ? resizeEdgeAt({ x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height }, pointer.clientX, pointer.clientY)
            : null;
          updateResizeHover(win.id, edge);
          if (win.pinned || parked || win.dockPeek) return;
          const offset = pointer.clientY - bounds.top;
          reveal(win.id, offset < 52 ? "t" : bounds.height - offset < 52 ? "b" : null);
        }}
        onPointerLeave={() => { updateResizeHover(win.id, null); if (!win.pinned) reveal(win.id, null); }}>
        {parked && <span className="peek-tab-handle" aria-hidden="true" />}
        <div className="win-bar top" onPointerDown={(pointer) => {
          const target = pointer.target as HTMLElement;
          const bounds = pointer.currentTarget.parentElement?.getBoundingClientRect();
          const edge = !win.dock && !target.closest("button, a, input, textarea") && bounds
            ? resizeEdgeAt({ x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height }, pointer.clientX, pointer.clientY)
            : null;
          drag(pointer, win, edge ? "resize" : "move", edge || undefined);
        }} onClick={(pointer) => { if (!(pointer.target as HTMLElement).closest("button")) pointer.stopPropagation(); }}>
          <span className="title">{win.spec.title}</span>
          <button className="ib sm" aria-label={win.pinned ? "Unpin bars" : "Pin bars"}
            title={win.pinned ? "Unpin bars (bars float over content)" : "Pin bars (part of the layout)"}
            onClick={(pointer) => { pointer.stopPropagation(); upd(win.id, { pinned: !win.pinned, pinTouched: true, autoPin: false }); }}>{win.pinned ? <PinOff /> : <Pin />}</button>
          <button className="ib sm" aria-label="Minimize" title="Minimize to shelf"
            onClick={(pointer) => { pointer.stopPropagation(); pointer.currentTarget.blur(); upd(win.id, { min: true, z: Math.max(0, ...wins.map((item) => item.z)) + 1 }); }}><Minus /></button>
          <button className="ib sm" aria-label="Close" title="Close canvas"
            onClick={(pointer) => { pointer.stopPropagation(); setWins((state) => state.filter((item) => item.id !== win.id)); }}><X /></button>
        </div>
        <Viewer spec={win.spec} winId={win.id} dock={win.dock} active={!win.min && !parked} onDock={setDock} onEdit={setEdit} />
        {docked
          ? <div className="win-dockresize" onPointerDown={(pointer) => drag(pointer, win, "dock")}
              aria-label="Resize sidebar" role="separator" aria-orientation="vertical" />
          : !parked && <div className="win-resize-handles" aria-hidden="false">{(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeEdge[]).map((edge) =>
              <div key={edge} className={`win-resize-handle edge-${edge}`} role="separator" aria-orientation={edge === "e" || edge === "w" ? "vertical" : "horizontal"}
                aria-label={`Resize ${win.spec.title} ${edge}`} onPointerDown={(pointer) => drag(pointer, win, "resize", edge)} />)}</div>}
      </div>;
    })}

    {ghost && <div className={`canvas-ghost ${ghost.mode === "undock" ? "undock" : "resize"}`} aria-hidden="true"
      style={{ left: ghost.rect.x, top: ghost.rect.y, width: ghost.rect.w, height: ghost.rect.h }}>
      {ghost.mode === "undock" && <span>{ghost.title}</span>}
    </div>}
    {dockPreviewW !== null && <div className="dock-resize-preview" aria-hidden="true" style={{ width: dockPreviewW }} />}
  </>;
}
