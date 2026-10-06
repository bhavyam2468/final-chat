"use client";
/* PDF viewer. Pages rasterize virtually (only near the viewport, into a detached canvas swapped
   in atomically — a page is never half-drawn, blank or torn), the text layer is aligned the way
   pdf.js does it (baseline + ascent positioning, then a measured scaleX per span so the selection
   hugs the glyphs beneath it), selecting text offers Quote (file + page + surrounding context
   attached for the model) or Highlight, and keyboard navigation glides with eased tweens. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, Copy, MessageSquareQuote, Scan, X, ZoomIn, ZoomOut } from "lucide-react";
import { fileUrl, useApp } from "../ctx";
import { Ink, Stroke } from "./Ink";
import { notesPath } from "./types";
import { buildPdfQuote, markRects, norm, pageText, spanTop, type RectF, type TxtItem } from "./pdftext";

/** A saved highlight: page + text + a little anchor text before it (disambiguation). */
type Mark = { id: string; page: number; text: string; pre: string };

/* ---------- viewer ---------- */

type Page = {
  getViewport: (o: { scale: number }) => { width: number; height: number; rotation: number; convertToViewportPoint?: (x: number, y: number) => number[] };
  render: (o: unknown) => { promise: Promise<void>; cancel: () => void };
  getTextContent: () => Promise<{ items: unknown[] }>;
};
type Doc = { getPage: (n: number) => Promise<Page>; numPages: number };

const docCache = new Map<string, Promise<Doc>>();
async function loadDoc(path: string): Promise<Doc> {
  let d = docCache.get(path);
  if (!d) {
    d = (async () => {
      const { getDocumentProxy } = await import("unpdf");
      const buf = new Uint8Array(await (await fetch(fileUrl(path))).arrayBuffer());
      return (await getDocumentProxy(buf)) as unknown as Doc;
    })();
    docCache.set(path, d);
    if (docCache.size > 3) docCache.delete(docCache.keys().next().value as string);
  }
  return d;
}

export function PdfView({ path, ink, setInk, pen, setBar }: { path: string; ink?: Record<string, Stroke[]>; setInk?: (k: string, s: Stroke[]) => void; pen?: boolean; setBar?: (n: React.ReactNode) => void }) {
  const app = useApp();
  const [dims, setDims] = useState<{ w: number; h: number }[]>([]);
  const [texts, setTexts] = useState<TxtItem[][] | null>(null);
  const [ready, setReady] = useState<Set<number>>(new Set()); // pages rasterized at the current scale
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cur, setCur] = useState(1);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [hl, setHl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; text: string; page: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement | null>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const canvi = useRef<(HTMLCanvasElement | null)[]>([]);
  const doc = useRef<Doc | null>(null);
  const rendered = useRef<Set<number>>(new Set());
  const visible = useRef<Set<number>>(new Set());
  const inFlight = useRef<Map<number, { cancel: () => void }>>(new Map());
  const cwRef = useRef(0);
  const tween = useRef(0);

  /* ---- document + text layer ---- */
  /* eslint-disable react-hooks/set-state-in-effect -- resetting per-path state before the async load */
  useEffect(() => {
    let dead = false;
    setDims([]); setTexts(null); setFailed(false); setCur(1); setReady(new Set());
    rendered.current.clear(); visible.current.clear();
    (async () => {
      try {
        const pdf = await loadDoc(path);
        if (dead) return;
        doc.current = pdf;
        const ds: { w: number; h: number }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) ds.push(await pdf.getPage(i).then((p) => { const vp = p.getViewport({ scale: 1 }); return { w: vp.width, h: vp.height }; }));
        if (dead) return;
        setDims(ds);
        const all: TxtItem[][] = [];
        for (let i = 1; i <= Math.min(ds.length, 120) && !dead; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const rot = ((vp.rotation % 360) + 360) % 360;
          const swap = rot === 90 || rot === 270;
          const tc = await page.getTextContent().catch(() => ({ items: [] as unknown[] }));
          all.push((tc.items as { str?: string; transform?: number[]; width?: number }[])
            .filter((it) => it.str && it.transform)
            .map((it) => {
              const size = Math.hypot(it.transform![2] || 0, it.transform![3] || 0) || 10;
              const cvp = vp.convertToViewportPoint ? vp.convertToViewportPoint(it.transform![4], it.transform![5]) : [it.transform![4], ds[i - 1].h - it.transform![5]];
              const adv = it.width || 0;
              return { s: it.str!, x: (swap ? cvp[0] - adv : cvp[0]) / vp.width, by: (swap ? cvp[1] - adv / 2 : cvp[1]) / vp.height, w: (swap ? size : adv) / vp.width, h: size / vp.height };
            }));
        }
        if (!dead) setTexts(all);
      } catch (e) { console.warn(e); if (!dead) setFailed(true); }
    })();
    return () => { dead = true; const f = inFlight.current; f.forEach((t) => t.cancel()); f.clear(); };
  }, [path]);

  /* ---- highlights persistence ---- */
  const hlFile = notesPath(path) + ".hl.json";
  useEffect(() => { fetch(fileUrl(hlFile), { cache: "no-store" }).then((r) => (r.ok ? r.json() : { marks: [] })).then((j: { marks?: Mark[] }) => setMarks(j.marks || [])).catch(() => {}); }, [hlFile]);
  const saveMarks = useCallback((next: Mark[]) => {
    setMarks(next);
    fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: hlFile, content: JSON.stringify({ file: path, marks: next }, null, 1) }) }).catch(() => {});
  }, [hlFile, path]);
  const markLayer = useMemo(() => {
    const m = new Map<number, RectF[]>();
    if (!texts) return m;
    for (const k of marks) { const r = markRects(texts[k.page - 1] || [], k); if (r.length) m.set(k.page, [...(m.get(k.page) || []), ...r]); }
    return m;
  }, [texts, marks]);

  /* ---- virtual rasterization: near-viewport pages only, atomic canvas swap ---- */
  const raster = useCallback(async (i: number) => {
    const pdf = doc.current;
    if (!pdf || rendered.current.has(i) || inFlight.current.has(i) || cwRef.current < 40 || !dims[i - 1]) return;
    const task = { cancel: () => {} };
    inFlight.current.set(i, task);
    try {
      const page = await pdf.getPage(i);
      if (rendered.current.has(i) || inFlight.current.get(i) !== task) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const scale = ((cwRef.current * zoom) / dims[i - 1].w) * dpr;
      const vp = page.getViewport({ scale });
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(vp.width)); off.height = Math.max(1, Math.round(vp.height));
      const render = page.render({ canvasContext: off.getContext("2d")!, viewport: vp });
      task.cancel = () => render.cancel();
      await render.promise;
      const c = canvi.current[i - 1];
      if (!c) return;
      c.width = off.width; c.height = off.height; // resizing clears the bitmap; then one atomic blit
      c.getContext("2d")!.drawImage(off, 0, 0);
      rendered.current.add(i);
      setReady((s) => (s.has(i) ? s : new Set(s).add(i)));
    } catch { /* cancelled or superseded: the page simply stays as it was */ }
    finally { if (inFlight.current.get(i) === task) inFlight.current.delete(i); }
  }, [dims, zoom]);

  useEffect(() => {
    if (!dims.length) return;
    rendered.current.clear();
    inFlight.current.forEach((t) => t.cancel()); inFlight.current.clear();
    for (const i of visible.current) raster(i);
  }, [zoom, dims, raster]);

  useEffect(() => {
    if (!dims.length) return;
    const el = wrap.current; if (!el) return;
    const scrollRoot = el.closest(".win-body") as HTMLElement | null;
    body.current = scrollRoot;
    const io = new IntersectionObserver((ents) => {
      let changed = false;
      for (const e of ents) {
        const i = Number((e.target as HTMLElement).dataset.page);
        if (e.isIntersecting) { if (!visible.current.has(i)) { visible.current.add(i); changed = true; } }
        else if (visible.current.delete(i)) changed = true;
      }
      if (changed) for (const i of visible.current) raster(i);
    }, { root: scrollRoot, rootMargin: "800px 0px" });
    for (const p of pageEls.current) if (p) io.observe(p);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (Math.abs(w - cwRef.current) > 1) { cwRef.current = w; rendered.current.clear(); for (const i of visible.current) raster(i); }
    });
    ro.observe(el);
    cwRef.current = el.clientWidth;
    return () => { io.disconnect(); ro.disconnect(); };
  }, [dims.length, raster]);

  /* ---- current page tracking ---- */
  useEffect(() => {
    const el = body.current; if (!el || !dims.length) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const mid = el.getBoundingClientRect().top + el.clientHeight / 3;
        let best = 0;
        for (const c of canvi.current) if (c && c.getBoundingClientRect().top < mid) best = Number(c.dataset.page || 0);
        if (best) setCur(best);
      }, 90);
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => { el.removeEventListener("scroll", on); clearTimeout(t); };
  }, [dims.length, texts]);

  /* ---- keyboard: eased glides, page jumps, home/end ---- */
  const cancelTween = useCallback(() => { if (tween.current) { cancelAnimationFrame(tween.current); tween.current = 0; } }, []);
  useEffect(() => () => cancelTween(), [cancelTween]);
  const glideTo = useCallback((to: number, dur = 340) => {
    const el = body.current; if (!el) return;
    cancelTween();
    const max = el.scrollHeight - el.clientHeight;
    const from = el.scrollTop, target = Math.max(0, Math.min(max, to));
    if (Math.abs(target - from) < 2) { el.scrollTop = target; return; }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      el.scrollTop = from + (target - from) * (1 - Math.pow(1 - k, 3));
      tween.current = k < 1 ? requestAnimationFrame(step) : 0;
    };
    tween.current = requestAnimationFrame(step);
  }, [cancelTween]);
  const pageTop = useCallback((n: number) => (pageEls.current[n - 1]?.offsetTop ?? 0) - 6, []);
  const zoomBy = useCallback((d: number) => setZoom((z) => { let n = Math.max(0.5, Math.min(3, +(z + d * 0.25).toFixed(2))); if (Math.abs(n - 1) < 0.13) n = 1; return n; }), []);

  useEffect(() => {
    const winEl = wrap.current?.closest(".win"); const el = body.current;
    if (!winEl || !el || !dims.length) return;
    let hot = false;
    const en = () => { hot = true; }, ex = () => { hot = false; };
    winEl.addEventListener("mouseenter", en); winEl.addEventListener("mouseleave", ex);
    const onWheel = () => cancelTween();
    el.addEventListener("wheel", onWheel, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (!hot || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
      const v = Math.max(80, el.clientHeight * 0.14);
      if (e.key === "ArrowDown") glideTo(el.scrollTop + v, 240);
      else if (e.key === "ArrowUp") glideTo(el.scrollTop - v, 240);
      else if (e.key === "ArrowRight") glideTo(el.scrollLeft + v, 240);
      else if (e.key === "ArrowLeft") glideTo(el.scrollLeft - v, 240);
      else if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) glideTo(pageTop(Math.min(dims.length, cur + 1)), 380);
      else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) glideTo(pageTop(Math.max(1, el.scrollTop - pageTop(cur) < 24 ? cur - 1 : cur)), 380);
      else if (e.key === "Home") glideTo(0, 520);
      else if (e.key === "End") glideTo(el.scrollHeight, 520);
      else if (e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "-" || e.key === "_") zoomBy(-1);
      else if (e.key === "0") setZoom(1);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => { winEl.removeEventListener("mouseenter", en); winEl.removeEventListener("mouseleave", ex); el.removeEventListener("wheel", onWheel); removeEventListener("keydown", onKey); };
  }, [dims.length, cur, glideTo, zoomBy, cancelTween, pageTop]);

  /* ---- selection popover: quote (provenance + context), highlight, copy ---- */
  useEffect(() => {
    if (!texts) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = document.getSelection();
        const node = s?.anchorNode;
        const layer = node instanceof Element ? node.closest(".txtlayer") : node?.parentElement?.closest(".txtlayer");
        if (!s || s.isCollapsed || !layer || !wrap.current?.contains(layer)) { setSel((x) => (x ? null : x)); return; }
        const text = s.toString().replace(/\s+/g, " ").trim();
        if (text.length < 2) { setSel((x) => (x ? null : x)); return; }
        const page = Number((layer.closest(".pdf-page") as HTMLElement | null)?.dataset.page || 1);
        const scroller = body.current;
        if (!scroller) return;
        const br = scroller.getBoundingClientRect();
        const r = s.getRangeAt(0).getBoundingClientRect();
        setSel({ x: r.left + r.width / 2 - br.left + scroller.scrollLeft, y: r.top - br.top + scroller.scrollTop - 10, text, page });
      }, 140);
    };
    const hide = () => setSel((x) => (x ? null : x));
    document.addEventListener("selectionchange", check);
    body.current?.addEventListener("scroll", hide, { passive: true });
    return () => { document.removeEventListener("selectionchange", check); body.current?.removeEventListener("scroll", hide); clearTimeout(t); };
  }, [texts]);

  const doQuote = () => {
    if (!sel) return;
    app.quote(buildPdfQuote(sel.text, path.split("/").pop() || path, sel.page, texts ? pageText(texts[sel.page - 1] || []) : ""));
    document.getSelection()?.removeAllRanges();
    setSel(null);
  };
  const doHighlight = () => {
    if (!sel || !texts) return;
    const raw = pageText(texts[sel.page - 1] || []);
    const at = norm(raw).indexOf(norm(sel.text));
    const pre = at > 0 ? raw.slice(Math.max(0, at - 36), at + 6) : "";
    saveMarks([...marks, { id: `hl${Date.now().toString(36)}`, page: sel.page, text: sel.text, pre }]);
    document.getSelection()?.removeAllRanges();
    setSel(null);
  };

  /* ---- bottom bar ---- */
  useEffect(() => {
    if (!setBar) return;
    setBar(dims.length ? <>
      <span className="v-meta num"><input className="v-page" value={cur} onChange={(e) => { const n = +e.target.value; if (n >= 1 && n <= dims.length) glideTo(pageTop(n), 420); }} aria-label="Page" /> / {dims.length}</span>
      <button className="ib sm" aria-label="Zoom out" title="Zoom out (-)" onClick={() => zoomBy(-1)}><ZoomOut /></button>
      <span className="v-meta num">{Math.round(zoom * 100)}%</span>
      <button className="ib sm" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1)}><ZoomIn /></button>
      <button className={"ib sm" + (zoom === 1 ? " on" : "")} aria-label="Fit to canvas" title="Fit page to canvas (0)" onClick={() => setZoom(1)}><Scan /></button>
      {marks.length > 0 && <button className={"ib sm hl-chip" + (hl ? " on" : "")} aria-label="Highlights" title="Highlights — click to manage" onClick={() => setHl((h) => !h)}><Bookmark />{marks.length}</button>}
    </> : null);
  }, [dims.length, cur, zoom, marks, hl, setBar, zoomBy, glideTo, pageTop]);

  if (failed) return <iframe className="full" src={fileUrl(path)} title={path} />;
  return (
    <div ref={wrap} className="pdfwrap" data-pdf={path}>
      {dims.map((d, i) => (
        <div key={i} ref={(el) => { pageEls.current[i] = el; }} data-page={i + 1} className={"pdf-page" + (ready.has(i + 1) ? "" : " pending")} style={{ aspectRatio: `${d.w}/${d.h}`, width: `${zoom * 100}%` }}>
          <canvas ref={(el) => { canvi.current[i] = el; }} data-page={i + 1} style={{ width: "100%", height: "100%" }} />
          {markLayer.get(i + 1)?.map((r, k) => <div key={k} className="hl-mark" style={{ left: `${r.x * 100}cqw`, top: `${r.y * 100}cqh`, width: `${r.w * 100}cqw`, height: `${r.h * 100}cqh` }} />)}
          {texts?.[i] && <TextLayer items={texts[i]} />}
          {setInk && <Ink strokes={ink?.[i + 1] || []} onChange={(s) => setInk(String(i + 1), s)} active={!!pen} />}
        </div>
      ))}
      {sel && (
        <div className="pdfsel" style={{ left: sel.x, top: sel.y }} role="toolbar" aria-label="Selection" onMouseDown={(e) => e.preventDefault()}>
          <span className="pdfsel-page">p.{sel.page}</span>
          <button onClick={doQuote} title="Quote to the chat — page and surrounding text are attached"><MessageSquareQuote />Quote</button>
          <button onClick={doHighlight} title="Highlight this passage"><Bookmark />Highlight</button>
          <button onClick={() => { navigator.clipboard.writeText(sel.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }} title="Copy">{copied ? <Check /> : <Copy />}</button>
        </div>
      )}
      {hl && marks.length > 0 && (
        <div className="hl-pop" role="dialog" aria-label="Highlights">
          <div className="hl-pop-h"><span>Highlights</span><span className="sp" />
            <button className="txt-btn" onClick={() => saveMarks([])}>Clear all</button>
            <button className="ib sm" aria-label="Close" onClick={() => setHl(false)}><X /></button>
          </div>
          {marks.map((m) => (
            <div key={m.id} className="hl-row">
              <span className="pg">p.{m.page}</span>
              <span className="tx">{m.text.length > 90 ? m.text.slice(0, 90) + "…" : m.text}</span>
              <button className="ib sm" aria-label="Remove highlight" onClick={() => saveMarks(marks.filter((x) => x.id !== m.id))}><X /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Invisible-but-selectable text over a page, aligned like pdf.js: baseline + ascent positioning,
    then a measured scaleX per span so the selection highlight hugs the glyphs under it. */
function TextLayer({ items }: { items: TxtItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const spans = [...el.children] as HTMLElement[];
    const pw = el.clientWidth;
    const widths = spans.map((s) => (s.firstChild ? s.getBoundingClientRect().width : 0)); // read pass (no transforms yet)
    spans.forEach((s, i) => {                                                                             // write pass
      const t = parseFloat(s.dataset.w || "0") * pw;
      if (t > 2 && widths[i] > 2) s.style.transform = `scaleX(${Math.min(4, t / widths[i])})`;
    });
  }, [items]);
  return (
    <div ref={ref} className="txtlayer" aria-label="PDF text">
      {items.map((t, k) => (
        <span key={k} data-w={t.w} style={{ left: `${t.x * 100}cqw`, top: `${spanTop(t.by, t.h) * 100}cqh`, fontSize: `${t.h * 100}cqh`, lineHeight: 1 }}>{t.s}</span>
      ))}
    </div>
  );
}
