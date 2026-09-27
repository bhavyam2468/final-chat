"use client";
/* Canvas windows. Philosophy: the content IS the window. Bars float over it and stay out of the way
   (immersive by default, both floating and docked); hovering the top/bottom edge slides them in over
   the content; pinning turns them into real layout (content sits between them). Drag a window to the
   screen edge and it parks as a peek; click the peek to restore. Viewers contribute type-specific
   actions to the bottom bar, which scrolls inline instead of overflowing. */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pin, PinOff, Minus, X, PenLine, Eraser, NotebookPen, MessageSquareQuote, Download, Save, ExternalLink, PanelRight, PictureInPicture2, RotateCw, ZoomIn, ZoomOut, Code2, Eye, Scissors, Scan } from "lucide-react";
import { CanvasSpec, fileUrl, useApp } from "./ctx";
import { Block } from "./Block";
import { StreamMarkdown, CodeBlock } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "./Message";
import { SheetView, DocView, SlidesView, ArchiveView, MediaView, extOf } from "./viewers";
import { canvasPath } from "@/lib/shared";
import { ChatView } from "./ChatView";

export type Rect = { x: number; y: number; w: number; h: number };
export type Win = { id: string; spec: CanvasSpec; x: number; y: number; w: number; h: number; z: number; min: boolean; pinned: boolean; dock: boolean; peek?: Rect | null; dockPeek?: boolean; prevDockW?: number };

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

type TxtItem = { s: string; x: number; y: number; w: number; h: number };
/** Real PDF pages on canvases, an invisible-but-selectable text layer over them (quote it like chat text),
    and keyboard control: arrows/PageUp/PageDown scroll, +/- zoom with a snap that makes the page cover
    the viewport when it's close. */
function PdfView({ path, ink, setInk, pen, setBar }: { path: string; ink?: Record<string, Stroke[]>; setInk?: (k: string, s: Stroke[]) => void; pen?: boolean; setBar?: (n: React.ReactNode) => void }) {
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
  const [texts, setTexts] = useState<TxtItem[][] | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cur, setCur] = useState(1);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const doc = useRef<{ getPage: (n: number) => Promise<unknown>; numPages: number } | null>(null);
  const renderAll = useCallback(async (dims: { w: number; h: number }[], alive: () => boolean) => {
    const pdf = doc.current as unknown as { getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }> } | null;
    if (!pdf) return;
    for (let i = 1; i <= dims.length && alive(); i++) {
      const page = await pdf.getPage(i), c = refs.current[i - 1]; if (!c) continue;
      const scale = (c.parentElement!.clientWidth / dims[i - 1].w) * (devicePixelRatio || 1);
      const vp = page.getViewport({ scale }); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c }).promise;
    }
  }, []);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { getDocumentProxy } = await import("unpdf");
        const buf = new Uint8Array(await (await fetch(fileUrl(path))).arrayBuffer());
        const pdf = await getDocumentProxy(buf);
        doc.current = pdf as never;
        const dims: { w: number; h: number }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) { const vp = (await pdf.getPage(i)).getViewport({ scale: 1 }); dims.push({ w: vp.width, h: vp.height }); }
        if (dead) return; setPages(dims);
        await new Promise((r) => setTimeout(r, 30));
        await renderAll(dims, () => !dead);
        // selectable text layer (first 80 pages keeps it cheap); spans are transparent but selectable
        try {
          const all: TxtItem[][] = [];
          for (let i = 1; i <= Math.min(dims.length, 80) && !dead; i++) {
            const page = (await (doc.current as never as { getPage: (n: number) => Promise<unknown> }).getPage(i)) as { getTextContent?: () => Promise<{ items: unknown[] }> };
            if (typeof page.getTextContent !== "function") break;
            const tc = await page.getTextContent();
            const d = dims[i - 1];
            all.push((tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[])
              .filter((it) => it.str && it.transform)
              .map((it) => ({ s: it.str!, x: it.transform![4] / d.w, y: (d.h - it.transform![5]) / d.h, w: (it.width || 0) / d.w, h: (it.height || Math.abs(it.transform![3]) || 10) / d.h })));
          }
          if (!dead && all.length) setTexts(all);
        } catch { /* no text layer: selection falls back to snipping */ }
      } catch (e) { console.warn(e); if (!dead) setFailed(true); }
    })();
    return () => { dead = true; };
  }, [path, renderAll]);
  useEffect(() => { if (!pages.length) return; let dead = false; const t = setTimeout(() => renderAll(pages, () => !dead), 120); return () => { dead = true; clearTimeout(t); }; }, [zoom, pages, renderAll]);
  useEffect(() => {
    const el = wrap.current?.closest(".win-body"); if (!el) return;
    const on = () => { const mid = el.getBoundingClientRect().top + el.clientHeight / 3; let best = 1; refs.current.forEach((c, i) => { if (c && c.getBoundingClientRect().top < mid) best = i + 1; }); setCur(best); };
    el.addEventListener("scroll", on, { passive: true }); return () => el.removeEventListener("scroll", on);
  }, [pages]);
  const go = (n: number) => refs.current[n - 1]?.parentElement?.scrollIntoView({ behavior: "smooth", block: "start" });
  // zoom steps of .25, but snap to 1 (= page covers the canvas width) when a step lands close to it
  const zoomBy = useCallback((d: number) => setZoom((z) => { let n = Math.max(0.5, Math.min(3, +(z + d * 0.25).toFixed(2))); if (Math.abs(n - 1) < 0.13) n = 1; return n; }), []);
  useEffect(() => {
    const winEl = wrap.current?.closest(".win"); const body = wrap.current?.closest(".win-body") as HTMLElement | null;
    if (!winEl || !body || !pages.length) return;
    let hot = false;
    const en = () => { hot = true; }, ex = () => { hot = false; };
    winEl.addEventListener("mouseenter", en); winEl.addEventListener("mouseleave", ex);
    const onKey = (e: KeyboardEvent) => {
      if (!hot || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable=true]")) return;
      const v = Math.max(80, body.clientHeight * 0.12);
      if (e.key === "ArrowDown") body.scrollBy(0, v);
      else if (e.key === "ArrowUp") body.scrollBy(0, -v);
      else if (e.key === "ArrowRight") body.scrollBy(v, 0);
      else if (e.key === "ArrowLeft") body.scrollBy(-v, 0);
      else if (e.key === "PageDown" || e.key === " ") body.scrollBy(0, body.clientHeight * 0.9);
      else if (e.key === "PageUp") body.scrollBy(0, -body.clientHeight * 0.9);
      else if (e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "-" || e.key === "_") zoomBy(-1);
      else if (e.key === "0") setZoom(1);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => { winEl.removeEventListener("mouseenter", en); winEl.removeEventListener("mouseleave", ex); removeEventListener("keydown", onKey); };
  }, [pages, zoomBy]);
  useEffect(() => {
    if (!setBar) return;
    setBar(pages.length ? <>
      <span className="v-meta num"><input className="v-page" value={cur} onChange={(e) => { const n = +e.target.value; if (n >= 1 && n <= pages.length) go(n); }} aria-label="Page" /> / {pages.length}</span>
      <button className="ib sm" aria-label="Zoom out" title="Zoom out (-)" onClick={() => zoomBy(-1)}><ZoomOut /></button>
      <span className="v-meta num">{Math.round(zoom * 100)}%</span>
      <button className="ib sm" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1)}><ZoomIn /></button>
      <button className={"ib sm" + (zoom === 1 ? " on" : "")} aria-label="Fit to canvas" title="Fit page to canvas (0)" onClick={() => setZoom(1)}><Scan /></button>
    </> : null);
  }, [pages, cur, zoom, setBar, zoomBy]);
  if (failed) return <iframe className="full" src={fileUrl(path)} title={path} />;
  return <div ref={wrap} className="pdfwrap">{pages.map((d, i) => (
    <div key={i} className="pdf-page" style={{ aspectRatio: `${d.w}/${d.h}`, width: `${zoom * 100}%` }}>
      <canvas ref={(el) => { refs.current[i] = el; }} style={{ width: "100%", height: "100%" }} />
      {texts?.[i] && <div className="txtlayer" aria-label="PDF text">{texts[i].map((t, k) => (
        <span key={k} style={{ left: `${t.x * 100}cqw`, top: `${t.y * 100}cqh`, fontSize: `${t.h * 100}cqh`, width: `${t.w * 100}cqw` }}>{t.s}</span>))}</div>}
      {setInk && <Ink strokes={ink?.[i + 1] || []} onChange={(s) => setInk(String(i + 1), s)} active={!!pen} />}
    </div>))}</div>;
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

const Viewer = memo(function Viewer({ spec, winId, ctl }: { spec: CanvasSpec; winId: string; ctl?: React.ReactNode }) {
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

  const editor = <textarea className="editor" value={src} spellCheck={false} onChange={(e) => { setSrc(e.target.value); setDirty(true); }} aria-label="Source" />;
  const Pdf = useCallback((p: { path: string }) => <PdfView path={p.path} />, []);
  let body: React.ReactNode = null;
  if (spec.kind === "youtube") body = <iframe className="full black" src={`https://www.youtube-nocookie.com/embed/${spec.id}?autoplay=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title="YouTube" />;
  else if (spec.kind === "web") body = <iframe key={rev} className="full" src={spec.url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" title={spec.title} />;
  else if (spec.kind === "md") body = <div className="reader"><StreamMarkdown text={spec.body} {...md} /></div>;
  else if (spec.kind === "chat") body = <ChatView id={spec.id} setBar={setBar} />;
  else if (k === "ui") body = mode === "a" ? <Block key={rev + ":" + src.length} source={src} done fill /> : editor;
  else if (k === "image") body = <div className="imgview">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={fileUrl(path!)} alt="" /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} active={pen} /></div>;
  else if (k === "pdf") body = <PdfView path={path!} ink={ink} setInk={setInk} pen={pen} setBar={setBar} />;
  else if (k === "html") body = mode === "a" ? <div style={{ position: "relative", height: "100%" }}><iframe key={rev} className="full" src={fileUrl(path!)} sandbox="allow-scripts allow-forms allow-popups allow-modals" title={path} /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} active={pen} /></div> : editor;
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
      {annot && (k !== "html" || mode === "a") && <>
        <button className={"ib sm" + (pen ? " on" : "")} aria-label="Annotate" title="Pen (hold Shift to highlight)" onClick={() => setPen(!pen)}><PenLine /></button>
        {pen && <button className="ib sm" aria-label="Clear marks" title="Clear marks" onClick={() => { setInkAll({}); saveNotes({}); }}><Eraser /></button>}
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
  // which floating bars are revealed (hover zones); hidden = immersive fullscreen content
  const [show, setShow] = useState<Record<string, { t: boolean; b: boolean }>>({});
  const timers = useRef<Record<string, NodeJS.Timeout>>({});
  const reveal = (id: string, zone: "t" | "b" | null) => {
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
    setShow((s) => { const c = s[id] || { t: false, b: false }; const n = zone === null ? { t: false, b: false } : { ...c, [zone]: true }; if (n.t === c.t && n.b === c.b) return s; return { ...s, [id]: n }; });
    if (zone) timers.current[id] = setTimeout(() => setShow((s) => ({ ...s, [id]: { t: false, b: false } })), 900);
  };
  const upd = (id: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const front = (id: string) => setWins((ws) => { const top = Math.max(0, ...ws.map((w) => w.z)); const me = ws.find((w) => w.id === id); if (me && me.z === top) return ws; return ws.map((w) => (w.id === id ? { ...w, z: top + 1 } : w)); });
  const setDock = (id: string, dock: boolean) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, dock, min: false, dockPeek: false } : dock && w.dock ? { ...w, dock: false, min: true } : w)));
  const moved = useRef(false);
  const drag = (e: React.PointerEvent, w: Win, kind: "move" | "resize" | "dock") => {
    if ((e.target as HTMLElement).closest("button") && kind === "move") return;
    if (w.dock && kind === "move") return;
    e.preventDefault(); front(w.id); document.body.classList.add("dragging");
    const sx = e.clientX, sy = e.clientY, o = { ...w }, ow = dockW;
    moved.current = false;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      if (kind === "dock") setDockW(Math.round(Math.min(innerWidth - 380, Math.max(24, ow - dx))));
      else if (kind === "resize") upd(w.id, { w: Math.max(260, o.w + dx), h: Math.max(160, o.h + dy) });
      else upd(w.id, { x: Math.min(innerWidth - 40, Math.max(-o.w + 40, o.x + dx)), y: Math.min(innerHeight - 40, Math.max(0, o.y + dy)), peek: null });
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up); document.body.classList.remove("dragging");
      if (kind === "dock") { // dragged thinner than the snap point: park as a peek at the edge
        if (dockW < 120 && !w.dockPeek) { upd(w.id, { dockPeek: true, prevDockW: ow > 120 ? ow : w.prevDockW || 560 }); setDockW(16); }
        return;
      }
      if (kind !== "move" || !moved.current) return;
      if (ev.clientX > innerWidth - 28) upd(w.id, { peek: { x: o.x, y: o.y, w: o.w, h: o.h }, x: innerWidth - 14, y: Math.min(o.y, innerHeight - 120), w: 14, h: Math.max(120, o.h) });
      else if (ev.clientX < 28) upd(w.id, { peek: { x: o.x, y: o.y, w: o.w, h: o.h }, x: -o.w + 14, y: Math.min(o.y, innerHeight - 120) });
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  // minimised windows park as a tray along the top of the chat column; double-click or the button restores them
  const tray = wins.filter((w) => w.min && !w.dock).map((w) => w.id);
  const trayIdx = (id: string) => tray.indexOf(id);
  const trayPos = (i: number) => {
    const chatW = (typeof window === "undefined" ? 1200 : innerWidth) - (wins.some((w) => w.dock) ? dockW + 16 : 0);
    const per = Math.max(1, Math.floor((chatW - 96 - 150) / 180)); // keep clear of the top-left and top-right icons
    return { left: 96 + (i % per) * 180, top: 8 + Math.floor(i / per) * 42, width: 172 };
  };
  return <>
    {wins.map((w) => (
      <div key={w.id} data-win={w.id} className={`win${w.min && !w.dock ? " min" : ""}${w.pinned ? " pinned" : ""}${w.dock ? " docked" : ""}${w.peek ? " peek" + (w.peek.x > w.x ? " peek-r" : " peek-l") : ""}${w.dockPeek ? " dockpeek" : ""}${(show[w.id]?.t) ? " show-t" : ""}${(show[w.id]?.b) ? " show-b" : ""}`}
        style={w.dock ? { zIndex: 30 } : w.min ? { ...trayPos(trayIdx(w.id)), zIndex: 40 + w.z } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 40 + w.z }}
        onPointerDown={() => front(w.id)}
        onClick={() => { if (moved.current) return; if (w.peek) upd(w.id, { ...w.peek, peek: null }); else if (w.dockPeek) { upd(w.id, { dockPeek: false }); setDockW(w.prevDockW || 560); } }}
        onPointerMove={(e) => {
          if (w.pinned || w.min || w.peek || w.dockPeek) return;
          const r = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - r.top;
          reveal(w.id, y < 52 ? "t" : r.height - y < 52 ? "b" : null);
        }}
        onPointerLeave={() => !w.pinned && reveal(w.id, null)}>
        <div className="win-bar top" onPointerDown={(e) => !w.min && drag(e, w, "move")} onClick={(e) => { if (w.min && !(e.target as HTMLElement).closest("button")) upd(w.id, { min: false }); if (!(e.target as HTMLElement).closest("button")) e.stopPropagation(); }} onDoubleClick={() => !w.dock && !w.min && upd(w.id, { min: true })}>
          <span className="title">{w.spec.title}</span>
          {!w.min && <button className="ib sm" aria-label={w.pinned ? "Unpin bars" : "Pin bars"} title={w.pinned ? "Unpin bars (bars float over content)" : "Pin bars (part of the layout)"} onClick={() => upd(w.id, { pinned: !w.pinned })}>{w.pinned ? <PinOff /> : <Pin />}</button>}
          <button className="ib sm" aria-label="Close" title="Close" onClick={() => setWins((ws) => ws.filter((x) => x.id !== w.id))}><X /></button>
        </div>
        <Viewer spec={w.spec} winId={w.id} ctl={!w.min ? <>
          <span className="bar-sep" />
          <button className="ib sm" aria-label={w.dock ? "Float" : "Dock beside chat"} title={w.dock ? "Float" : "Dock beside chat"} onClick={() => setDock(w.id, !w.dock)}>{w.dock ? <PictureInPicture2 /> : <PanelRight />}</button>
          {!w.dock && <button className="ib sm" aria-label="Minimize" title="Minimize" onClick={() => upd(w.id, { min: true })}><Minus /></button>}
        </> : undefined} />
        {w.dock ? <div className="win-dockresize" onPointerDown={(e) => drag(e, w, "dock")} aria-label="Resize" role="separator" aria-orientation="vertical" />
          : <div className="win-resize" onPointerDown={(e) => drag(e, w, "resize")} />}
      </div>
    ))}
  </>;
}
