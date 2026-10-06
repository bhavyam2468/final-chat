"use client";
/* Canvas windows. Philosophy: the content IS the window. Bars float over it and stay out of the way
   (immersive by default, both floating and docked); hovering the top/bottom edge slides them in over
   the content; pinning turns them into real layout (content sits between them). Edge snapping keeps
   the whole window visible, and minimized items stay grouped in a restore tray. Viewers contribute
   type-specific actions to the bottom bar, which scrolls inline instead of overflowing. */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pin, PinOff, Minus, X, PenLine, Eraser, NotebookPen, MessageSquareQuote, Download, Save, ExternalLink, PanelRight, PictureInPicture2, RotateCw, ZoomIn, ZoomOut, Code2, Eye, Scissors, Scan, ScanText, LoaderCircle, Highlighter, Undo2, AppWindow, FileText } from "lucide-react";
import { CanvasSpec, fileUrl, useApp } from "./ctx";
import { Block } from "./Block";
import { StreamMarkdown, CodeBlock } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "./Message";
import { SheetView, DocView, SlidesView, ArchiveView, MediaView, extOf } from "./viewers";
import { canvasPath } from "@/lib/shared";
import { ChatView } from "./ChatView";

export type Rect = { x: number; y: number; w: number; h: number };
export type Win = { id: string; spec: CanvasSpec; x: number; y: number; w: number; h: number; z: number; min: boolean; pinned: boolean; dock: boolean; entering?: boolean; minimizing?: boolean; closing?: boolean; snap?: "left" | "right" };

type Stroke = { c: string; w: number; p: [number, number][]; kind?: "pen" | "highlight"; unit?: "page" };
const EMPTY_STROKES: Stroke[] = [];
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

function Ink({ strokes, onChange, mode }: { strokes: Stroke[]; onChange: (s: Stroke[]) => void; mode: "pen" | "highlight" | null }) {
  const mark = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const cur = useRef<Stroke | null>(null);
  const draw = useCallback(() => {
    const paint = (canvas: HTMLCanvasElement | null, kind: "pen" | "highlight") => {
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const g = canvas.getContext("2d"); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
      g.lineCap = "round"; g.lineJoin = "round";
      for (const s of [...strokes, ...(cur.current ? [cur.current] : [])]) {
        const strokeKind = s.kind || (s.w >= 10 && s.c.startsWith("rgba(") ? "highlight" : "pen");
        if (strokeKind !== kind || !s.p.length) continue;
        g.strokeStyle = s.c; g.globalAlpha = 1;
        g.lineWidth = Math.max(kind === "highlight" ? 8 : 1, s.unit === "page" ? s.w * r.width : s.w);
        g.beginPath();
        const x = (pt: [number, number]) => pt[0] * r.width;
        const y = (pt: [number, number]) => pt[1] * r.height;
        g.moveTo(x(s.p[0]), y(s.p[0]));
        if (s.p.length === 2) g.lineTo(x(s.p[1]), y(s.p[1]));
        else for (let i = 1; i < s.p.length - 1; i++) {
          const a = s.p[i], b = s.p[i + 1];
          g.quadraticCurveTo(x(a), y(a), (x(a) + x(b)) / 2, (y(a) + y(b)) / 2);
        }
        if (s.p.length > 2) g.lineTo(x(s.p.at(-1)!), y(s.p.at(-1)!));
        g.stroke();
      }
      g.globalAlpha = 1;
    };
    paint(mark.current, "highlight"); paint(ink.current, "pen");
  }, [strokes]);
  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    const parent = ink.current?.parentElement;
    if (parent) ro.observe(parent);
    window.addEventListener("resize", draw);
    return () => { ro.disconnect(); window.removeEventListener("resize", draw); };
  }, [draw]);
  const accent = typeof window !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() : "#c07040";
  const pt = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => { const r = e.currentTarget.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const finish = () => {
    if (!cur.current) return;
    const stroke = cur.current; cur.current = null;
    if (stroke.p.length === 1) stroke.p.push(stroke.p[0]);
    onChange([...strokes, stroke]); draw();
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!mode) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    cur.current = mode === "highlight"
      ? { c: "rgba(246, 202, 84, .36)", w: 16 / Math.max(r.width, 1), unit: "page", kind: "highlight", p: [pt(e)] }
      : { c: accent || "#c07040", w: 2.2 / Math.max(r.width, 1), unit: "page", kind: "pen", p: [pt(e)] };
    draw();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!cur.current) return; cur.current.p.push(pt(e)); draw(); };
  return <>
    <canvas ref={mark} className="ink ink-mark" aria-hidden="true" />
    <canvas ref={ink} className={"ink ink-pen" + (mode ? " active" : "")} aria-label={mode === "highlight" ? "Draw a PDF highlight" : "Draw an annotation"}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} />
  </>;
}

type TxtItem = { s: string; x: number; y: number; w: number; h: number; angle: number; ocr?: boolean };
type PdfViewport = { width: number; height: number; transform?: number[] };
type PdfPageProxy = {
  getViewport: (o: { scale: number }) => PdfViewport;
  getTextContent?: () => Promise<{ items: unknown[] }>;
  render: (o: unknown) => { promise: Promise<void>; cancel?: () => void };
};
type PdfDocumentProxy = { numPages: number; getPage: (n: number) => Promise<PdfPageProxy>; destroy?: () => Promise<void> | void };
type RenderOp = { token: number; task?: { promise: Promise<void>; cancel?: () => void } };
type OcrStatus = { stage: string; progress: number; done?: boolean; error?: string };
type TesseractModule = typeof import("tesseract.js");
type TesseractWorker = Awaited<ReturnType<TesseractModule["createWorker"]>>;

const multiplyTransform = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * A small, virtualised PDF reader. Only visible and nearby pages are rasterised. Rendering into a
 * staging canvas and swapping on success means zoom/resize never clears the last good page, while
 * per-page render tokens prevent a late task from overwriting a newer size or rotation.
 */
function PdfView({ path, ink, setInk, setBar }: { path: string; ink?: Record<string, Stroke[]>; setInk?: (k: string, s: Stroke[]) => void; setBar?: (n: React.ReactNode) => void }) {
  const [pages, setPages] = useState<{ w: number; h: number; transform: number[] }[]>([]);
  const [texts, setTexts] = useState<Record<number, TxtItem[]>>({});
  const [ocrTexts, setOcrTexts] = useState<Record<number, TxtItem[]>>({});
  const [ocrPlain, setOcrPlain] = useState<Record<number, string>>({});
  const [ocrStatus, setOcrStatus] = useState<Record<number, OcrStatus>>({});
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrBusyPage, setOcrBusyPage] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [rendered, setRendered] = useState<Record<number, boolean>>({});
  const [visible, setVisible] = useState<Record<number, boolean>>({});
  const [zoom, setZoom] = useState(1);
  const [cur, setCur] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [tool, setTool] = useState<"pen" | "highlight" | null>(null);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const doc = useRef<PdfDocumentProxy | null>(null);
  const ocrWorker = useRef<TesseractWorker | null>(null);
  const ocrWorkerLanguage = useRef("");
  const ocrGeneration = useRef(0);
  const ocrRun = useRef(false);
  const ocrActivePage = useRef<number | null>(null);
  const ocrRenderTask = useRef<{ cancel?: () => void } | null>(null);
  const activePdfPath = useRef(path); activePdfPath.current = path;
  const renderOps = useRef<Map<number, RenderOp>>(new Map());
  const resizeTimers = useRef<Map<number, number>>(new Map());
  const renderKeys = useRef<Map<number, string>>(new Map());
  const textLoaded = useRef<Set<number>>(new Set());
  const visiblePages = useRef<Set<number>>(new Set());
  const nextToken = useRef(0);
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const zoomAnchor = useRef<{ page: number; top: number } | null>(null);

  const renderPage = useCallback(async (i: number, force = false) => {
    const pdf = doc.current, canvas = refs.current[i], pageEl = pageEls.current[i], dims = pagesRef.current[i];
    if (!pdf || !canvas || !pageEl || !dims || pageEl.clientWidth < 1) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${Math.round(pageEl.clientWidth)}:${dpr}`;
    if (!force && renderKeys.current.get(i) === key) return;
    const old = renderOps.current.get(i); old?.task?.cancel?.();
    const token = ++nextToken.current;
    const op: RenderOp = { token }; renderOps.current.set(i, op);
    try {
      const page = await pdf.getPage(i + 1);
      if (renderOps.current.get(i)?.token !== token) return;
      const scale = (pageEl.clientWidth / dims.w) * dpr;
      const viewport = page.getViewport({ scale });
      const staging = document.createElement("canvas");
      staging.width = Math.max(1, Math.ceil(viewport.width)); staging.height = Math.max(1, Math.ceil(viewport.height));
      const context = staging.getContext("2d", { alpha: false });
      if (!context) throw new Error("Could not allocate a PDF canvas.");
      const task = page.render({ canvasContext: context, viewport, canvas: staging });
      op.task = task;
      await task.promise;
      if (renderOps.current.get(i)?.token !== token || !canvas.isConnected) return;
      canvas.width = staging.width; canvas.height = staging.height;
      const visible = canvas.getContext("2d", { alpha: false });
      if (!visible) throw new Error("Could not display this PDF page.");
      visible.drawImage(staging, 0, 0);
      renderKeys.current.set(i, key);
      setRendered((oldRendered) => oldRendered[i] ? oldRendered : { ...oldRendered, [i]: true });
      setPageErrors((oldErrors) => { if (!oldErrors[i]) return oldErrors; const next = { ...oldErrors }; delete next[i]; return next; });
    } catch (e) {
      const name = (e as { name?: string })?.name || "";
      if (name !== "RenderingCancelledException" && renderOps.current.get(i)?.token === token) {
        setPageErrors((oldErrors) => ({ ...oldErrors, [i]: String((e as Error)?.message || "Page render failed").slice(0, 140) }));
      }
    } finally {
      if (renderOps.current.get(i)?.token === token) renderOps.current.delete(i);
    }
  }, []);
  const loadText = useCallback(async (i: number) => {
    if (textLoaded.current.has(i)) return;
    const pdf = doc.current, v = pagesRef.current[i];
    if (!pdf || !v) return;
    textLoaded.current.add(i);
    try {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent?.();
      if (doc.current !== pdf) return;
      const matrix = v.transform;
      const raw = content?.items as { str?: string; transform?: number[]; width?: number; height?: number }[] | undefined;
      const items = (raw || []).filter((it) => typeof it.str === "string" && it.str.length > 0 && it.transform?.length === 6).map((it) => {
        const t = multiplyTransform(matrix, it.transform!);
        const h = Math.max(1, Math.hypot(t[2], t[3]) || Math.abs(it.height || 10));
        const scale = Math.hypot(matrix[0], matrix[1]) || 1;
        const w = Math.max(1, (it.width || it.str!.length * h * 0.45) * scale);
        return { s: it.str!, x: t[4] / v.w, y: Math.max(0, (t[5] - h) / v.h), w: w / v.w, h: h / v.h, angle: Math.atan2(t[1], t[0]) * 180 / Math.PI };
      });
      setTexts((old) => ({ ...old, [i]: items }));
    } catch {
      if (doc.current === pdf) setTexts((old) => ({ ...old, [i]: [] }));
    }
  }, []);

  useEffect(() => {
    let dead = false;
    ocrGeneration.current += 1;
    const oldWorker = ocrWorker.current;
    ocrWorker.current = null; ocrWorkerLanguage.current = ""; ocrRun.current = false; ocrActivePage.current = null;
    ocrRenderTask.current?.cancel?.(); ocrRenderTask.current = null;
    void oldWorker?.terminate().catch(() => {});
    let loaded: PdfDocumentProxy | null = null;
    const ops = renderOps.current;
    for (const op of ops.values()) op.task?.cancel?.();
    ops.clear(); renderKeys.current.clear(); doc.current = null;
    setPages([]); setTexts({}); setOcrTexts({}); setOcrPlain({}); setOcrStatus({}); setOcrBusy(false); setOcrBusyPage(null); setRendered({}); setVisible({}); textLoaded.current.clear(); visiblePages.current.clear(); setFailed(false); setLoading(true); setPageErrors({}); setCur(1); setZoom(1); setPageInput("1"); setTool(null);
    (async () => {
      try {
        const { getDocumentProxy } = await import("unpdf");
        const response = await fetch(fileUrl(path), { cache: "no-store" });
        if (!response.ok) throw new Error(`Could not load PDF (${response.status}).`);
        const buf = new Uint8Array(await response.arrayBuffer());
        const pdf = await getDocumentProxy(buf) as unknown as PdfDocumentProxy;
        if (dead) { await pdf.destroy?.(); return; }
        loaded = pdf; doc.current = pdf;
        const dims: { w: number; h: number; transform: number[] }[] = Array.from({ length: pdf.numPages });
        let cursor = 1;
        await Promise.all(Array.from({ length: Math.min(4, pdf.numPages) }, async () => {
          while (!dead) {
            const i = cursor++; if (i > pdf.numPages) return;
            const page = await pdf.getPage(i);
            const v = page.getViewport({ scale: 1 });
            dims[i - 1] = { w: v.width, h: v.height, transform: v.transform || [1, 0, 0, -1, 0, v.height] };
          }
        }));
        if (dead) return;
        setPages(dims); setLoading(false);
      } catch (e) {
        console.warn("PDF preview failed", e);
        if (!dead) { setLoading(false); setFailed(true); }
      }
    })();
    return () => {
      dead = true; ocrGeneration.current += 1; ocrRun.current = false; ocrActivePage.current = null;
      ocrRenderTask.current?.cancel?.(); ocrRenderTask.current = null;
      const worker = ocrWorker.current; ocrWorker.current = null; ocrWorkerLanguage.current = "";
      void worker?.terminate().catch(() => {});
      for (const op of ops.values()) op.task?.cancel?.();
      ops.clear();
      if (doc.current === loaded) doc.current = null;
      void loaded?.destroy?.();
    };
  }, [path]);

  useEffect(() => {
    if (!pages.length || !wrap.current) return;
    const body = wrap.current.closest(".win-body") as HTMLElement | null;
    const shown = visiblePages.current, timers = resizeTimers.current;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const i = Number((entry.target as HTMLElement).dataset.index);
        if (entry.isIntersecting) {
          shown.add(i); setVisible((old) => old[i] ? old : { ...old, [i]: true });
          void renderPage(i); void loadText(i);
        } else {
          shown.delete(i);
          setVisible((old) => { if (!old[i]) return old; const next = { ...old }; delete next[i]; return next; });
          const timer = timers.get(i); if (timer) clearTimeout(timer); timers.delete(i);
          const op = renderOps.current.get(i); op?.task?.cancel?.(); renderOps.current.delete(i);
          renderKeys.current.delete(i);
          const canvas = refs.current[i];
          if (canvas?.width) { canvas.width = 0; canvas.height = 0; }
          setRendered((oldRendered) => { if (!oldRendered[i]) return oldRendered; const next = { ...oldRendered }; delete next[i]; return next; });
        }
      }
    }, { root: body, rootMargin: "720px 0px", threshold: 0.01 });
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const i = Number((entry.target as HTMLElement).dataset.index);
        if (!shown.has(i)) continue;
        window.clearTimeout(timers.get(i));
        const timer = window.setTimeout(() => void renderPage(i), 100);
        timers.set(i, timer);
      }
    });
    pageEls.current.forEach((el) => { if (el) { io.observe(el); ro.observe(el); } });
    return () => { io.disconnect(); ro.disconnect(); shown.clear(); for (const t of timers.values()) clearTimeout(t); timers.clear(); };
  }, [pages, renderPage, loadText]);

  useEffect(() => {
    const body = wrap.current?.closest(".win-body") as HTMLElement | null;
    if (!body || !pages.length) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const pivot = body.getBoundingClientRect().top + body.clientHeight * 0.38;
        let lo = 0, hi = pageEls.current.length - 1, best = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, page = pageEls.current[mid];
          if (!page) break;
          const r = page.getBoundingClientRect();
          if (pivot < r.top) hi = mid - 1;
          else if (pivot > r.bottom) lo = mid + 1;
          else { best = mid; break; }
        }
        if (best < 0) {
          let score = Infinity;
          for (const i of [Math.max(0, Math.min(pageEls.current.length - 1, lo - 1)), Math.max(0, Math.min(pageEls.current.length - 1, lo))]) {
            const page = pageEls.current[i]; if (!page) continue;
            const r = page.getBoundingClientRect(), d = pivot < r.top ? r.top - pivot : pivot - r.bottom;
            if (d < score) { score = d; best = i; }
          }
        }
        const pageNo = Math.max(1, best + 1);
        setCur((old) => old === pageNo ? old : pageNo);
      });
    };
    body.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    return () => { body.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [pages]);

  const go = useCallback((n: number) => {
    const body = wrap.current?.closest(".win-body") as HTMLElement | null, page = pageEls.current[n - 1];
    if (!body || !page) return;
    const top = body.scrollTop + page.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);
  useEffect(() => setPageInput(String(cur)), [cur]);
  const commitPage = useCallback((value = pageInput) => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= pages.length) go(n);
    else setPageInput(String(cur));
  }, [cur, go, pageInput, pages.length]);
  const setZoomAnchored = useCallback((n: number) => {
    if (n === zoom) return;
    const body = wrap.current?.closest(".win-body") as HTMLElement | null, page = pageEls.current[cur - 1];
    if (body && page) zoomAnchor.current = { page: cur, top: page.getBoundingClientRect().top };
    setZoom(n);
  }, [cur, zoom]);
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (!a) return;
    const body = wrap.current?.closest(".win-body") as HTMLElement | null, page = pageEls.current[a.page - 1];
    if (body && page) body.scrollTop += page.getBoundingClientRect().top - a.top;
    zoomAnchor.current = null;
  }, [zoom]);
  const zoomBy = useCallback((d: number) => {
    let n = Math.max(0.5, Math.min(3, +(zoom + d * 0.25).toFixed(2)));
    if (Math.abs(n - 1) < 0.13) n = 1;
    setZoomAnchored(n);
  }, [setZoomAnchored, zoom]);

  const recognizePage = useCallback(async (i: number) => {
    if (ocrRun.current) return;
    const generation = ocrGeneration.current, sourcePath = path, language = ocrLanguage;
    const pdf = doc.current;
    if (!pdf || !pagesRef.current[i]) return;
    const isCurrent = () => generation === ocrGeneration.current && activePdfPath.current === sourcePath;
    ocrRun.current = true; ocrActivePage.current = i;
    setOcrBusy(true); setOcrBusyPage(i);
    setOcrStatus((old) => ({ ...old, [i]: { stage: "Preparing page", progress: 0 } }));
    let canvas: HTMLCanvasElement | null = null;
    let renderTask: { promise: Promise<void>; cancel?: () => void } | null = null;
    try {
      const page = await pdf.getPage(i + 1);
      if (!isCurrent()) return;
      const base = page.getViewport({ scale: 1 });
      const area = Math.max(1, base.width * base.height), side = Math.max(base.width, base.height);
      const scale = Math.min(2, 2600 / side, Math.sqrt(4_500_000 / area));
      const viewport = page.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Could not prepare this page for text recognition.");
      renderTask = page.render({ canvasContext: context, viewport, canvas });
      ocrRenderTask.current = renderTask;
      await renderTask.promise;
      if (!isCurrent()) return;
      setOcrStatus((old) => ({ ...old, [i]: { stage: "Loading OCR engine", progress: 0 } }));

      let worker = ocrWorker.current;
      if (worker && ocrWorkerLanguage.current !== language) {
        ocrWorker.current = null; ocrWorkerLanguage.current = "";
        await worker.terminate().catch(() => {});
        if (!isCurrent()) return;
        worker = null;
      }
      if (!worker) {
        const { createWorker } = await import("tesseract.js");
        let lastLogAt = 0, lastStage = "";
        const created = await createWorker(language.split("+"), 1, {
          workerPath: new URL("/vendor/tesseract/worker.min.js", window.location.origin).href,
          corePath: new URL("/vendor/tesseract-core", window.location.origin).href,
          langPath: new URL("/vendor/tessdata/4.0.0_best_int", window.location.origin).href,
          workerBlobURL: false,
          cacheMethod: "write",
          gzip: true,
          logger: (message) => {
            const pageIndex = ocrActivePage.current;
            if (!isCurrent() || pageIndex === null) return;
            const stage = message.status === "loading tesseract core" ? "Loading OCR engine"
              : message.status === "loading language traineddata" ? "Loading language data"
                : message.status === "recognizing text" ? "Recognizing text" : "Starting OCR";
            const now = Date.now();
            if (stage === lastStage && now - lastLogAt < 140 && message.progress < 1) return;
            lastLogAt = now; lastStage = stage;
            setOcrStatus((old) => ({ ...old, [pageIndex]: { stage, progress: Math.max(0, Math.min(1, message.progress)) } }));
          },
          errorHandler: (error: unknown) => console.warn("OCR worker error", error),
        });
        if (!isCurrent()) { await created.terminate().catch(() => {}); return; }
        worker = created; ocrWorker.current = created; ocrWorkerLanguage.current = language;
      }
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      if (!isCurrent()) return;
      const words = (data.blocks || []).flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => (paragraph.lines || []).flatMap((line) => line.words || [])));
      const items: TxtItem[] = [];
      for (const word of words) {
        const text = word.text.trim();
        if (!text || word.confidence < 8) continue;
        const x0 = Math.max(0, Math.min(canvas.width, word.bbox.x0)), y0 = Math.max(0, Math.min(canvas.height, word.bbox.y0));
        const x1 = Math.max(x0, Math.min(canvas.width, word.bbox.x1)), y1 = Math.max(y0, Math.min(canvas.height, word.bbox.y1));
        if (x1 - x0 < 1 || y1 - y0 < 1) continue;
        items.push({ s: text, x: x0 / canvas.width, y: y0 / canvas.height, w: (x1 - x0) / canvas.width, h: (y1 - y0) / canvas.height, angle: 0, ocr: true });
      }
      const recognized = data.text.trim();
      setOcrTexts((old) => ({ ...old, [i]: items }));
      setOcrPlain((old) => ({ ...old, [i]: recognized }));
      setOcrStatus((old) => ({ ...old, [i]: { stage: items.length || recognized ? "Text ready" : "No text found", progress: 1, done: true } }));
    } catch (error) {
      if (isCurrent()) setOcrStatus((old) => ({ ...old, [i]: { stage: "OCR failed", progress: 0, error: String((error as Error)?.message || "Could not recognize this page.").slice(0, 180) } }));
    } finally {
      if (ocrRenderTask.current === renderTask) ocrRenderTask.current = null;
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (isCurrent() && ocrActivePage.current === i) {
        ocrRun.current = false; ocrActivePage.current = null; setOcrBusy(false); setOcrBusyPage(null);
      }
    }
  }, [ocrLanguage, path]);

  useEffect(() => {
    const winEl = wrap.current?.closest(".win"), body = wrap.current?.closest(".win-body") as HTMLElement | null;
    if (!winEl || !body || !pages.length) return;
    let hot = false;
    const en = () => { hot = true; }, ex = () => { hot = false; };
    winEl.addEventListener("mouseenter", en); winEl.addEventListener("mouseleave", ex);
    const onKey = (e: KeyboardEvent) => {
      if (!hot || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true],button,[role=button]")) return;
      const step = Math.max(72, body.clientHeight * 0.14);
      if (e.key === "ArrowDown") body.scrollBy({ top: step, behavior: "smooth" });
      else if (e.key === "ArrowUp") body.scrollBy({ top: -step, behavior: "smooth" });
      else if (e.key === "ArrowRight") body.scrollBy({ left: step, behavior: "smooth" });
      else if (e.key === "ArrowLeft") body.scrollBy({ left: -step, behavior: "smooth" });
      else if (e.key === "PageDown" || e.key === " ") go(Math.min(pages.length, cur + 1));
      else if (e.key === "PageUp") go(Math.max(1, cur - 1));
      else if (e.key === "Home") go(1);
      else if (e.key === "End") go(pages.length);
      else if (e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "-" || e.key === "_") zoomBy(-1);
      else if (e.key === "0") setZoomAnchored(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => { winEl.removeEventListener("mouseenter", en); winEl.removeEventListener("mouseleave", ex); window.removeEventListener("keydown", onKey); };
  }, [pages, cur, zoomBy, go, setZoomAnchored]);

  useEffect(() => {
    if (!setBar) return;
    const key = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { commitPage((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } };
    const currentMarks = ink?.[String(cur)] || [];
    const ocrPage = ocrBusyPage ?? cur - 1, currentOcr = ocrStatus[ocrBusy ? ocrPage : cur - 1];
    const ocrMessage = ocrBusy
      ? ocrBusyPage === cur - 1 ? `${currentOcr?.stage || "Recognizing text"} ${Math.round((currentOcr?.progress || 0) * 100)}%` : `OCR · page ${ocrPage + 1}`
      : currentOcr?.error ? "OCR failed" : currentOcr?.stage || "";
    setBar(pages.length ? <>
      <span className="v-meta num"><input className="v-page" type="text" inputMode="numeric" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))} onBlur={() => commitPage()} onKeyDown={key} aria-label="Go to page" title="Go to page" /> / {pages.length}</span>
      <button className="ib sm" aria-label="Zoom out" title="Zoom out (-)" disabled={zoom <= 0.5} onClick={() => zoomBy(-1)}><ZoomOut /></button>
      <span className="v-meta num">{Math.round(zoom * 100)}%</span>
      <button className="ib sm" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= 3} onClick={() => zoomBy(1)}><ZoomIn /></button>
      <button className={"ib sm" + (zoom === 1 ? " on" : "")} aria-label="Fit to canvas" title="Fit width (0)" onClick={() => setZoomAnchored(1)}><Scan /></button>
      {setInk && <>
        <span className="bar-sep" />
        <button className={"ib sm" + (tool === "pen" ? " on" : "")} aria-label="Pen annotation" title="Draw with pen" onClick={() => setTool(tool === "pen" ? null : "pen")}><PenLine /></button>
        <button className={"ib sm" + (tool === "highlight" ? " on" : "")} aria-label="Highlight annotation" title="Highlight text" onClick={() => setTool(tool === "highlight" ? null : "highlight")}><Highlighter /></button>
        {tool && <>
          <button className="ib sm" aria-label="Undo last annotation on this page" title="Undo last annotation" disabled={!currentMarks.length} onClick={() => setInk(String(cur), currentMarks.slice(0, -1))}><Undo2 /></button>
          <button className="ib sm" aria-label="Clear annotations on this page" title="Clear marks on this page" disabled={!currentMarks.length} onClick={() => setInk(String(cur), [])}><Eraser /></button>
        </>}
      </>}
      <span className="bar-sep" />
      <select className="v-ocr-lang" value={ocrLanguage} onChange={(e) => setOcrLanguage(e.target.value)} disabled={ocrBusy} aria-label="OCR language" title="OCR language">
        <option value="eng">English</option><option value="hin">Hindi</option><option value="pan">Punjabi</option>
        <option value="eng+hin">English + Hindi</option><option value="eng+pan">English + Punjabi</option>
      </select>
      <button className={"ib sm" + (ocrStatus[cur - 1]?.done ? " on" : "")} aria-label={`Recognize text on page ${cur}`} title={`Recognize text on page ${cur} · Runs locally in your browser`} disabled={ocrBusy} onClick={() => void recognizePage(cur - 1)}>
        {ocrBusy ? <LoaderCircle className="ocr-spin" /> : <ScanText />}
      </button>
      {ocrMessage && <span className={"v-meta v-ocr-status" + (currentOcr?.error ? " error" : "")} title={currentOcr?.error || ocrMessage} aria-live="polite">{ocrMessage}</span>}
    </> : null);
  }, [pages, cur, pageInput, commitPage, zoom, tool, ink, setInk, setBar, zoomBy, setZoomAnchored, go, ocrStatus, ocrBusy, ocrBusyPage, ocrLanguage, recognizePage]);

  if (failed) return <iframe className="full" src={fileUrl(path)} title={path} />;
  return <div ref={wrap} className="pdfwrap" aria-busy={loading}>
    {loading && <div className="pdf-loading"><span className="spin" />Loading document</div>}
    {!loading && !pages.length && <div className="pdf-loading">This PDF has no pages.</div>}
    {pages.map((d, i) => {
      const nativeText = texts[i] || [];
      const textItems = nativeText.length ? nativeText : ocrTexts[i] || nativeText;
      const pageText = ocrPlain[i] || textItems.map((t) => t.s).join(" ");
      return <div key={`${path}:${i}`} ref={(el) => { pageEls.current[i] = el; }} data-index={i} className="pdf-page" style={{ aspectRatio: `${d.w}/${d.h}`, width: `${zoom * 100}%` }}>
        <canvas ref={(el) => { refs.current[i] = el; }} className="pdf-canvas" />
        {setInk && visible[i] && (tool !== null || (ink?.[i + 1]?.length || 0) > 0) && <Ink strokes={ink?.[i + 1] || EMPTY_STROKES} onChange={(s) => setInk(String(i + 1), s)} mode={tool} />}
        {visible[i] && (textItems.length > 0 || !!pageText) && <div className="txtlayer" data-pdf-path={path} data-pdf-page={i + 1} data-pdf-text={pageText} aria-label={`Text from page ${i + 1}`}>
          {textItems.map((t, k) => <span key={k} style={{ left: `${t.x * 100}cqw`, top: `${t.y * 100}cqh`, width: `${t.w * 100}cqw`, fontSize: `${t.h * 100}cqh`, lineHeight: `${t.h * 100}cqh`, transform: `rotate(${t.angle}deg)` }}>{t.s}{t.ocr ? " " : ""}</span>)}
        </div>}
        {visible[i] && !rendered[i] && !pageErrors[i] && <div className="pdf-page-skeleton" aria-hidden="true"><span className="spin" />Preparing page {i + 1}</div>}
        {visible[i] && pageErrors[i] && <button className="pdf-page-error" onClick={() => { renderKeys.current.delete(i); void renderPage(i, true); }} title={pageErrors[i]}>Retry page render</button>}
      </div>;
    })}
  </div>;
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
  return <div className="snip" role="application" aria-label="Snip region"
    onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY }; setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 }); }}
    onPointerMove={(e) => { if (!start.current) return; const s = start.current; setRect({ x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY), w: Math.abs(e.clientX - s.x), h: Math.abs(e.clientY - s.y) }); }}
    onPointerUp={() => { if (start.current && rect) finish(rect); start.current = null; setRect(null); }}>
    {rect && rect.w > 2 && <div className="snip-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
    <span className="snip-hint">drag to snip · esc to cancel</span>
  </div>;
}

/* eslint-disable @next/next/no-img-element -- natural dimensions are measured for precise annotation alignment */
function ImageView({ path, strokes, onChange, mode }: { path: string; strokes: Stroke[]; onChange: (s: Stroke[]) => void; mode: "pen" | "highlight" | null }) {
  const host = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const fit = useCallback(() => {
    const box = host.current, img = image.current;
    if (!box || !img?.naturalWidth || !img.naturalHeight) return;
    const maxW = Math.max(1, box.clientWidth - 20), maxH = Math.max(1, box.clientHeight - 20);
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const next = { w: Math.max(1, Math.round(img.naturalWidth * scale)), h: Math.max(1, Math.round(img.naturalHeight * scale)) };
    setSize((old) => old?.w === next.w && old.h === next.h ? old : next);
  }, []);
  useLayoutEffect(fit, [fit]);
  useEffect(() => {
    const box = host.current; if (!box) return;
    const ro = new ResizeObserver(fit); ro.observe(box); return () => ro.disconnect();
  }, [fit]);
  return <div ref={host} className="imgview">
    <div className="imgstage" style={{ width: size?.w || 1, height: size?.h || 1, visibility: size ? "visible" : "hidden" }}>
      <img ref={image} src={fileUrl(path)} alt="" onLoad={fit} />
      <Ink strokes={strokes} onChange={onChange} mode={mode} />
    </div>
  </div>;
}
/* eslint-enable @next/next/no-img-element */

const Viewer = memo(function Viewer({ spec, winId, ctl }: { spec: CanvasSpec; winId: string; ctl?: React.ReactNode }) {
  const app = useApp();
  const md = useMdHandlers();
  const path = spec.kind === "file" ? spec.path : spec.kind === "ui" ? spec.path : undefined;
  const k = spec.kind === "file" ? kindOf(spec.path) : spec.kind;
  const [mode, setMode] = useState<"a" | "b">("a");
  const [src, setSrc] = useState<string>(spec.kind === "ui" ? spec.source : "");
  const [dirty, setDirty] = useState(false);
  const [inkTool, setInkTool] = useState<"pen" | "highlight" | null>(null);
  const pen = inkTool !== null;
  const [snip, setSnip] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [ink, setInkAll] = useState<Record<string, Stroke[]>>({});
  const [rev, setRev] = useState(0);
  const [bar, setBar] = useState<React.ReactNode>(null);
  const annot = k === "pdf" || k === "image" || k === "html";
  const snippable = k === "pdf" || k === "image" || k === "video";
  const notable = !!path && ["pdf", "image", "html", "doc", "slides", "sheet", "video", "audio", "md", "text"].includes(k);

  useEffect(() => {
    if (!path || !["text", "md", "html", "ui"].includes(k) || (spec.kind === "ui" && spec.source)) return;
    fetch(fileUrl(path), { cache: "no-store" }).then((r) => r.text()).then(setSrc);
  }, [path, k, spec, rev]);
  useEffect(() => {
    if (!path || !annot) return;
    fetch(fileUrl(notesPath(path) + ".ink.json"), { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then((j: { pages?: Record<string, Stroke[]> }) => setInkAll(j.pages || {})).catch(() => {});
  }, [path, annot]);
  const save = useCallback(async () => {
    if (!path) return;
    await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path, content: src }) });
    setDirty(false); app.refreshTree();
  }, [path, src, app]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSnip(false); if ((e.metaKey || e.ctrlKey) && e.key === "s" && dirty && document.activeElement?.closest(`[data-win="${winId}"]`)) { e.preventDefault(); save(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save, winId]);
  const saveNotes = useCallback(async (nextInk = ink, text = notes) => {
    if (!path) return;
    const counts = Object.entries(nextInk).filter(([, s]) => s.length).map(([pg, s]) => `- ${k === "pdf" ? "page " + pg : "view"}: ${s.length} mark${s.length > 1 ? "s" : ""}`).join("\n");
    if (annot) await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: notesPath(path) + ".ink.json", content: JSON.stringify({ file: path, pages: nextInk }) }) });
    if (text !== null) await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: notesPath(path) + ".md", content: `# Notes: ${path}\n\n${text}\n\n## Annotations\n${counts || "- none"}\n` }) });
    app.refreshTree();
  }, [path, ink, notes, k, app, annot]);
  const setInk = useCallback((key: string, s: Stroke[]) => { const n = { ...ink, [key]: s }; setInkAll(n); void saveNotes(n); }, [ink, saveNotes]);
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

  const editor = <textarea className="editor" value={src} spellCheck={false} onChange={(e) => { setSrc(e.target.value); setDirty(true); }} aria-label="Source" />;
  const Pdf = useCallback((p: { path: string }) => <PdfView path={p.path} ink={ink} setInk={setInk} />, [ink, setInk]);
  let body: React.ReactNode = null;
  if (spec.kind === "youtube") body = <iframe className="full black" src={`https://www.youtube-nocookie.com/embed/${spec.id}?autoplay=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title="YouTube" />;
  else if (spec.kind === "web") body = <iframe key={rev} className="full" src={spec.url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" title={spec.title} />;
  else if (spec.kind === "md") body = <div className="reader"><StreamMarkdown text={spec.body} {...md} /></div>;
  else if (spec.kind === "chat") body = <ChatView id={spec.id} setBar={setBar} />;
  else if (k === "ui") body = mode === "a" ? <Block key={rev + ":" + src.length} source={src} done fill /> : editor;
  else if (k === "image") body = <ImageView path={path!} strokes={ink.view || []} onChange={(s) => setInk("view", s)} mode={inkTool} />;
  else if (k === "pdf") body = <PdfView path={path!} ink={ink} setInk={setInk} setBar={setBar} />;
  else if (k === "html") body = mode === "a" ? <div style={{ position: "relative", height: "100%" }}><iframe key={rev} className="full" src={fileUrl(path!)} sandbox="allow-scripts allow-forms allow-popups allow-modals" title={path} /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} mode={inkTool} /></div> : editor;
  else if (k === "md") body = mode === "a" ? <div className="reader"><StreamMarkdown text={src} {...md} /></div> : editor;
  else if (k === "text") body = mode === "a" ? <div className="reader code"><CodeBlock code={src} lang={extOf(path!)} done /></div> : editor;
  else if (k === "sheet") body = <SheetView path={path!} setBar={setBar} />;
  else if (k === "doc") body = <DocView path={path!} setBar={setBar} Pdf={Pdf} />;
  else if (k === "slides") body = <SlidesView path={path!} setBar={setBar} Pdf={Pdf} />;
  else if (k === "archive") body = <ArchiveView path={path!} setBar={setBar} />;
  else if (k === "video" || k === "audio") body = <MediaView src={fileUrl(path!)} video={k === "video"} setBar={setBar} />;
  else body = <div className="v-msg"><a className="txt-btn solid" href={fileUrl(path!)} download>Download {baseName(path!)}</a></div>;

  const toggle: Record<string, [string, string]> = { ui: ["Preview", "Code"], html: ["Preview", "Code"], md: ["Read", "Write"], text: ["Read", "Write"] };
  const external = spec.kind === "web" ? spec.url : spec.kind === "youtube" ? `https://youtu.be/${spec.id}` : null;
  return <>
    <div className={"win-body k-" + k}>{body}</div>
    {snip && <SnipLayer winId={winId} onDone={onSnip} />}
    {notes !== null && <div className="notes"><textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => saveNotes()} aria-label="Notes" /></div>}
    <div className="win-bar bot">
      {toggle[k] && <div className="seg"><button className={mode === "a" ? "on" : ""} onClick={() => setMode("a")} aria-label={toggle[k][0]}>{mode === "a" ? <Eye /> : null}{toggle[k][0]}</button><button className={mode === "b" ? "on" : ""} onClick={() => setMode("b")} aria-label={toggle[k][1]}>{mode === "b" ? <Code2 /> : null}{toggle[k][1]}</button></div>}
      {dirty && path && <button className="ib sm" aria-label="Save" title="Save (Ctrl+S)" onClick={save}><Save /></button>}
      {spec.kind === "ui" && !spec.path && <button className="ib sm" aria-label="Save to artifacts" title="Save to artifacts" onClick={async () => { const p = canvasPath(spec.title, "<ui>", app.convId || undefined); await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: p, content: src }) }); app.refreshTree(); }}><Save /></button>}
      {bar}
      {!bar && <span className="sp" />}
      {snippable && <button className={"ib sm" + (snip ? " on" : "")} aria-label="Snip to input" title="Snip a region into the input bar" onClick={() => setSnip(!snip)}><Scissors /></button>}
      {(k === "ui" || spec.kind === "web" || k === "html") && <button className="ib sm" aria-label="Reload" title="Reload" onClick={() => setRev((r) => r + 1)}><RotateCw /></button>}
      {annot && k !== "pdf" && (k !== "html" || mode === "a") && <>
        <button className={"ib sm" + (inkTool === "pen" ? " on" : "")} aria-label="Pen annotation" title="Draw with pen" onClick={() => setInkTool(inkTool === "pen" ? null : "pen")}><PenLine /></button>
        <button className={"ib sm" + (inkTool === "highlight" ? " on" : "")} aria-label="Highlight annotation" title="Highlight text" onClick={() => setInkTool(inkTool === "highlight" ? null : "highlight")}><Highlighter /></button>
        {pen && <>
          <button className="ib sm" aria-label="Undo last mark" title="Undo last mark" disabled={!ink.view?.length} onClick={() => setInk("view", (ink.view || []).slice(0, -1))}><Undo2 /></button>
          <button className="ib sm" aria-label="Clear marks" title="Clear marks" disabled={!ink.view?.length} onClick={() => setInk("view", [])}><Eraser /></button>
        </>}
      </>}
      {notable && <button className={"ib sm" + (notes !== null ? " on" : "")} aria-label="Notes" title="Notes (saved to notes/)" onClick={openNotes}><NotebookPen /></button>}
      {path && <button className="ib sm" aria-label="Ask about this" title="Ask about this" onClick={() => app.mention(path)}><MessageSquareQuote /></button>}
      {path && <a className="ib sm" aria-label="Download" title="Download" href={fileUrl(path)} download><Download /></a>}
      {external && <a className="ib sm" aria-label="Open in browser" title="Open in browser" href={external} target="_blank" rel="noreferrer"><ExternalLink /></a>}
      {ctl}
    </div>
  </>;
});

export function CanvasLayer({ wins, setWins, dockW, setDockW }: { wins: Win[]; setWins: React.Dispatch<React.SetStateAction<Win[]>>; dockW: number; setDockW: (w: number) => void }) {
  const [show, setShow] = useState<Record<string, { t: boolean; b: boolean }>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dragEnd = useRef(0);
  const reveal = (id: string, zone: "t" | "b" | null) => {
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
    setShow((s) => { const c = s[id] || { t: false, b: false }; const n = zone === null ? { t: false, b: false } : { ...c, [zone]: true }; if (n.t === c.t && n.b === c.b) return s; return { ...s, [id]: n }; });
    if (zone) timers.current[id] = setTimeout(() => setShow((s) => ({ ...s, [id]: { t: false, b: false } })), 1100);
  };
  useEffect(() => () => { for (const timer of Object.values(timers.current)) clearTimeout(timer); }, []);
  useEffect(() => {
    const ids = new Set(wins.filter((w) => w.entering).map((w) => w.id));
    if (!ids.size) return;
    const timer = window.setTimeout(() => setWins((ws) => ws.map((w) => ids.has(w.id) ? { ...w, entering: false } : w)), 480);
    return () => clearTimeout(timer);
  }, [wins, setWins]);
  const front = (id: string) => setWins((ws) => {
    const top = Math.max(0, ...ws.map((w) => w.z));
    return ws.map((w) => w.id === id ? { ...w, z: top + 1 } : w);
  });
  const minimize = (id: string) => {
    setWins((ws) => ws.map((w) => w.id === id ? { ...w, minimizing: true } : w));
    window.setTimeout(() => setWins((ws) => ws.map((w) => w.id === id && w.minimizing ? { ...w, min: true, minimizing: false, entering: false, snap: undefined } : w)), 190);
  };
  const close = (id: string) => {
    setWins((ws) => ws.map((w) => w.id === id ? { ...w, closing: true, minimizing: false } : w));
    window.setTimeout(() => setWins((ws) => ws.filter((w) => w.id !== id || !w.closing)), 150);
  };
  const restore = (id: string) => setWins((ws) => {
    const top = Math.max(0, ...ws.map((w) => w.z));
    const otherDock = ws.some((w) => w.id !== id && w.dock && !w.min);
    return ws.map((w) => w.id === id ? { ...w, min: false, dock: w.dock && !otherDock, z: top + 1, entering: true } : w);
  });
  const setDock = (id: string, dock: boolean) => setWins((ws) => {
    if (dock && ws.some((w) => w.id !== id && w.dock && !w.min)) return ws;
    const top = Math.max(0, ...ws.map((w) => w.z));
    return ws.map((w) => w.id === id ? { ...w, dock, min: false, z: top + 1, snap: undefined, entering: true } : w);
  });
  const findEl = (id: string) => document.querySelector(`[data-win="${CSS.escape(id)}"]`) as HTMLElement | null;
  const rectFor = (w: Win, dir: string, dx: number, dy: number) => {
    const minW = Math.min(260, Math.max(80, innerWidth - 16)), minH = Math.min(160, Math.max(80, innerHeight - 16));
    const maxW = Math.max(minW, innerWidth - 16), maxH = Math.max(minH, innerHeight - 16);
    const width = Math.max(minW, Math.min(maxW, w.w + (dir.includes("e") ? dx : dir.includes("w") ? -dx : 0)));
    const height = Math.max(minH, Math.min(maxH, w.h + (dir.includes("s") ? dy : dir.includes("n") ? -dy : 0)));
    const x = Math.max(8, Math.min(innerWidth - width - 8, dir.includes("w") ? w.x + w.w - width : w.x));
    const y = Math.max(8, Math.min(innerHeight - height - 8, dir.includes("n") ? w.y + w.h - height : w.y));
    return { x, y, w: width, h: height };
  };
  const startDockResize = (e: React.PointerEvent, w: Win) => {
    e.preventDefault(); e.stopPropagation(); front(w.id);
    const sx = e.clientX, start = dockW, pid = e.pointerId;
    const shell = document.querySelector(".shell") as HTMLElement | null;
    document.body.classList.add("canvas-gesture", "dock-gesture");
    findEl(w.id)?.classList.add("gesture");
    let live = start;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const max = Math.max(280, innerWidth - 360), min = Math.min(320, max);
      live = Math.round(Math.max(min, Math.min(max, start + sx - ev.clientX)));
      shell?.style.setProperty("--dockw", `${live}px`);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      document.body.classList.remove("canvas-gesture", "dock-gesture"); findEl(w.id)?.classList.remove("gesture");
      setDockW(live);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  };
  const startMove = (e: React.PointerEvent, w: Win) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault(); e.stopPropagation(); front(w.id);
    const el = findEl(w.id); if (!el) return;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const start = { x: w.x, y: w.y }, activeDock = wins.some((x) => x.id !== w.id && x.dock && !x.min);
    let moved = false, last = start;
    document.body.classList.add("canvas-gesture"); el.classList.add("gesture", "moving");
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      const x = Math.max(8, Math.min(innerWidth - w.w - 8, start.x + dx));
      const y = Math.max(8, Math.min(innerHeight - w.h - 8, start.y + dy));
      last = { x, y }; el.style.left = `${x}px`; el.style.top = `${y}px`;
      const edge = ev.clientX < 24 ? "left" : ev.clientX > innerWidth - 24 ? "right" : "";
      el.classList.toggle("edge-ready", !!edge); el.dataset.snap = edge;
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      move(ev);
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      document.body.classList.remove("canvas-gesture"); el.classList.remove("gesture", "moving", "edge-ready");
      el.removeAttribute("data-snap");
      if (!moved) return;
      dragEnd.current = Date.now();
      let snap: "left" | "right" | undefined;
      const edge = ev.clientX < 24 ? "left" : ev.clientX > innerWidth - 24 ? "right" : "";
      if (edge) {
        const avail = innerWidth - (activeDock ? dockW + 24 : 0) - 32;
        if (avail >= 260) {
          snap = edge;
          const width = Math.min(w.w, avail), height = Math.min(w.h, innerHeight - 32);
          last = { x: edge === "left" ? 16 : innerWidth - (activeDock ? dockW + 24 : 0) - width - 16, y: Math.max(16, Math.min(innerHeight - height - 16, last.y)), };
          el.classList.add("snap-settle"); el.style.left = `${last.x}px`; el.style.top = `${last.y}px`; el.style.width = `${width}px`; el.style.height = `${height}px`;
          requestAnimationFrame(() => window.setTimeout(() => el.classList.remove("snap-settle"), 450));
          setWins((ws) => ws.map((x) => x.id === w.id ? { ...x, ...last, w: width, h: height, snap } : x));
          return;
        }
      }
      setWins((ws) => ws.map((x) => x.id === w.id ? { ...x, ...last, snap: undefined } : x));
    };
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  };
  const startResize = (e: React.PointerEvent, w: Win, dir: string) => {
    e.preventDefault(); e.stopPropagation(); front(w.id);
    const el = findEl(w.id); if (!el) return;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    let last = { x: w.x, y: w.y, w: w.w, h: w.h };
    document.body.classList.add("canvas-gesture"); el.classList.add("gesture", "resizing");
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      last = rectFor(w, dir, ev.clientX - sx, ev.clientY - sy);
      el.style.left = `${last.x}px`; el.style.top = `${last.y}px`; el.style.width = `${last.w}px`; el.style.height = `${last.h}px`;
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      move(ev); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      document.body.classList.remove("canvas-gesture"); el.classList.remove("gesture", "resizing");
      setWins((ws) => ws.map((x) => x.id === w.id ? { ...x, ...last, snap: undefined } : x));
    };
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  };
  const resizeByKey = (e: React.KeyboardEvent<HTMLDivElement>, w: Win, dir: string) => {
    const delta = e.shiftKey ? 40 : 12, horizontal = dir.includes("e") || dir.includes("w"), vertical = dir.includes("n") || dir.includes("s");
    const dx = horizontal ? (e.key === "ArrowRight" ? delta : e.key === "ArrowLeft" ? -delta : 0) : 0;
    const dy = vertical ? (e.key === "ArrowDown" ? delta : e.key === "ArrowUp" ? -delta : 0) : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const next = rectFor(w, dir, dx, dy);
    setWins((ws) => ws.map((x) => x.id === w.id ? { ...x, ...next, snap: undefined } : x));
  };

  const minimized = wins.filter((w) => w.min);
  const [trayBottom, setTrayBottom] = useState(88);
  useEffect(() => {
    if (!minimized.length) return;
    const stack = document.querySelector(".dock-stack") as HTMLElement | null;
    if (!stack) return;
    const update = () => {
      const next = Math.max(80, Math.round(window.innerHeight - stack.getBoundingClientRect().top + 12));
      setTrayBottom((old) => old === next ? old : next);
    };
    update();
    const ro = new ResizeObserver(update); ro.observe(stack);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, [minimized.length, wins]);
  const grips = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  return <>
    {wins.filter((w) => !w.min).map((w) => {
      const canDock = !wins.some((other) => other.id !== w.id && other.dock && !other.min);
      return <div key={w.id} data-win={w.id} className={`win${w.pinned ? " pinned" : ""}${w.dock ? " docked" : ""}${w.entering ? " entering" : ""}${w.minimizing ? " minimizing" : ""}${w.closing ? " closing" : ""}${w.snap ? ` edge-snapped snap-${w.snap}` : ""}${show[w.id]?.t ? " show-t" : ""}${show[w.id]?.b ? " show-b" : ""}`}
        style={w.dock ? { zIndex: 30 } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 40 + w.z }}
        onPointerDown={() => front(w.id)}
        onPointerMove={(e) => {
          if (w.pinned) return;
          const r = e.currentTarget.getBoundingClientRect(), y = e.clientY - r.top;
          reveal(w.id, y < 48 ? "t" : r.height - y < 48 ? "b" : null);
        }}
        onPointerLeave={() => { if (!w.pinned) reveal(w.id, null); }}>
        <div className="win-bar top" onPointerDown={(e) => !w.dock && startMove(e, w)} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) minimize(w.id); }}>
          <span className="title">{w.spec.title}</span>
          <button className="ib sm" aria-label={w.pinned ? "Unpin bars" : "Pin bars"} title={w.pinned ? "Unpin bars" : "Pin bars"} onClick={() => setWins((ws) => ws.map((x) => x.id === w.id ? { ...x, pinned: !x.pinned } : x))}>{w.pinned ? <PinOff /> : <Pin />}</button>
          <button className="ib sm" aria-label="Close canvas" title="Close canvas" onClick={() => close(w.id)}><X /></button>
        </div>
        <Viewer spec={w.spec} winId={w.id} ctl={<>
          <span className="bar-sep" />
          <button className="ib sm" aria-label={w.dock ? "Float canvas" : "Dock beside chat"} title={w.dock ? "Float canvas" : canDock ? "Dock beside chat" : "Sidebar in use; minimize or float that canvas first"} disabled={!w.dock && !canDock} onClick={() => setDock(w.id, !w.dock)}>{w.dock ? <PictureInPicture2 /> : <PanelRight />}</button>
          <button className="ib sm" aria-label="Minimize canvas" title="Minimize" onClick={() => minimize(w.id)}><Minus /></button>
        </>} />
        {w.dock ? <div className="win-dockresize" onPointerDown={(e) => startDockResize(e, w)} aria-label="Resize sidebar" title="Drag to resize sidebar" role="separator" aria-orientation="vertical" /> : <>
          {grips.map((dir) => <div key={dir} className={`win-grip grip-${dir}`} role="separator" tabIndex={0} aria-label={`Resize window ${dir}`} aria-orientation={dir === "n" || dir === "s" ? "horizontal" : "vertical"}
            onPointerDown={(e) => startResize(e, w, dir)} onKeyDown={(e) => resizeByKey(e, w, dir)} />)}
        </>}
      </div>;
    })}
    {minimized.length > 0 && <div className="canvas-tray" style={{ bottom: `calc(${trayBottom}px + env(safe-area-inset-bottom))` }} role="toolbar" aria-label="Minimized canvases">
      <div className="canvas-tray-head"><AppWindow /><span>Minimized</span><small>{minimized.length}</small></div>
      <div className="canvas-tray-list">{minimized.map((w) => <div key={w.id} className={"canvas-task" + (w.closing ? " closing" : "")}>
        <button className="canvas-task-restore" onClick={() => restore(w.id)} aria-label={`Restore ${w.spec.title}`} title={`Restore ${w.spec.title}`}>
          {w.spec.kind === "file" ? <FileText /> : <AppWindow />}<span>{w.spec.title}</span>
        </button>
        <button className="canvas-task-close" onClick={() => close(w.id)} aria-label={`Close ${w.spec.title}`} title="Close"><X /></button>
      </div>)}</div>
    </div>}
  </>;
}
