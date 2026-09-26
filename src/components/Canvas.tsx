"use client";
/* Canvas windows. Two modes: floating (drag/resize freely) and docked (integrated beside the chat, which shifts;
   only horizontal resize). Every viewer contributes type-specific actions to the bottom bar. */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pin, PinOff, Minus, X, PenLine, Eraser, NotebookPen, MessageSquareQuote, Download, Save, ExternalLink, PanelRight, PictureInPicture2, RotateCw, ZoomIn, ZoomOut, Code2, Eye } from "lucide-react";
import { CanvasSpec, fileUrl, useApp } from "./ctx";
import { Block } from "./Block";
import { StreamMarkdown, CodeBlock } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "./Message";
import { SheetView, DocView, SlidesView, ArchiveView, MediaView, extOf } from "./viewers";
import { canvasSlug } from "@/lib/shared";

export type Win = { id: string; spec: CanvasSpec; x: number; y: number; w: number; h: number; z: number; min: boolean; pinned: boolean; dock: boolean };

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
      s.p.forEach(([x, y], i) => (i ? g.lineTo(x * r.width, y * r.height) : g.moveTo(x * r.width, y * r.height))); g.stroke();
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

function PdfView({ path, ink, setInk, pen, setBar }: { path: string; ink?: Record<string, Stroke[]>; setInk?: (k: string, s: Stroke[]) => void; pen?: boolean; setBar?: (n: React.ReactNode) => void }) {
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
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
  useEffect(() => {
    if (!setBar) return;
    setBar(pages.length ? <>
      <span className="v-meta num"><input className="v-page" value={cur} onChange={(e) => { const n = +e.target.value; if (n >= 1 && n <= pages.length) go(n); }} aria-label="Page" /> / {pages.length}</span>
      <button className="ib sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><ZoomOut /></button>
      <span className="v-meta num">{Math.round(zoom * 100)}%</span>
      <button className="ib sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}><ZoomIn /></button>
    </> : null);
  }, [pages, cur, zoom, setBar]);
  if (failed) return <iframe className="full" src={fileUrl(path)} title={path} />;
  return <div ref={wrap} className="pdfwrap">{pages.map((d, i) => (
    <div key={i} className="pdf-page" style={{ aspectRatio: `${d.w}/${d.h}`, maxWidth: 900 * zoom, width: `${Math.min(100, 100 * zoom)}%` }}>
      <canvas ref={(el) => { refs.current[i] = el; }} style={{ width: "100%", height: "100%" }} />
      {setInk && <Ink strokes={ink?.[i + 1] || []} onChange={(s) => setInk(String(i + 1), s)} active={!!pen} />}
    </div>))}</div>;
}

const Viewer = memo(function Viewer({ spec, winId }: { spec: CanvasSpec; winId: string }) {
  const app = useApp();
  const md = useMdHandlers();
  const path = spec.kind === "file" ? spec.path : spec.kind === "ui" ? spec.path : undefined;
  const k = spec.kind === "file" ? kindOf(spec.path) : spec.kind;
  const [mode, setMode] = useState<"a" | "b">("a");
  const [src, setSrc] = useState<string>(spec.kind === "ui" ? spec.source : "");
  const [dirty, setDirty] = useState(false);
  const [pen, setPen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [ink, setInkAll] = useState<Record<string, Stroke[]>>({});
  const [rev, setRev] = useState(0);
  const [bar, setBar] = useState<React.ReactNode>(null);
  const annot = k === "pdf" || k === "image" || k === "html";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s" && dirty && document.activeElement?.closest(`[data-win="${winId}"]`)) { e.preventDefault(); save(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save, winId]);

  const editor = <textarea className="editor" value={src} spellCheck={false} onChange={(e) => { setSrc(e.target.value); setDirty(true); }} aria-label="Source" />;
  const Pdf = useCallback((p: { path: string }) => <PdfView path={p.path} />, []);
  let body: React.ReactNode = null;
  if (spec.kind === "youtube") body = <iframe className="full black" src={`https://www.youtube-nocookie.com/embed/${spec.id}?autoplay=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title="YouTube" />;
  else if (spec.kind === "web") body = <iframe key={rev} className="full" src={spec.url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" title={spec.title} />;
  else if (spec.kind === "md") body = <div className="reader"><StreamMarkdown text={spec.body} {...md} /></div>;
  else if (k === "ui") body = mode === "a" ? <Block key={rev + ":" + src.length} source={src} done fill /> : editor;
  else if (k === "image") body = <div className="imgview" style={{ position: "relative" }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={fileUrl(path!)} alt="" /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} active={pen} /></div>;
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
    {notes !== null && <div className="notes"><textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => saveNotes()} aria-label="Notes" /></div>}
    <div className="win-bar bot">
      {toggle[k] && <div className="seg"><button className={mode === "a" ? "on" : ""} onClick={() => setMode("a")} aria-label={toggle[k][0]}>{mode === "a" ? <Eye /> : null}{toggle[k][0]}</button><button className={mode === "b" ? "on" : ""} onClick={() => setMode("b")} aria-label={toggle[k][1]}>{mode === "b" ? <Code2 /> : null}{toggle[k][1]}</button></div>}
      {dirty && path && <button className="ib sm" aria-label="Save" title="Save (Ctrl+S)" onClick={save}><Save /></button>}
      {spec.kind === "ui" && !spec.path && <button className="ib sm" aria-label="Save to artifacts" title="Save to artifacts" onClick={async () => { const p = `artifacts/${canvasSlug(spec.title)}.ui`; await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: p, content: src }) }); app.refreshTree(); }}><Save /></button>}
      {bar}
      {!bar && <span className="sp" />}
      {(k === "ui" || spec.kind === "web" || k === "html") && <button className="ib sm" aria-label="Reload" title="Reload" onClick={() => setRev((r) => r + 1)}><RotateCw /></button>}
      {annot && (k !== "html" || mode === "a") && <>
        <button className={"ib sm" + (pen ? " on" : "")} aria-label="Annotate" title="Pen (hold Shift to highlight)" onClick={() => setPen(!pen)}><PenLine /></button>
        {pen && <button className="ib sm" aria-label="Clear marks" title="Clear marks" onClick={() => { setInkAll({}); saveNotes({}); }}><Eraser /></button>}
      </>}
      {notable && <button className={"ib sm" + (notes !== null ? " on" : "")} aria-label="Notes" title="Notes (saved to notes/)" onClick={openNotes}><NotebookPen /></button>}
      {path && <button className="ib sm" aria-label="Ask about this" title="Ask about this" onClick={() => app.mention(path)}><MessageSquareQuote /></button>}
      {path && <a className="ib sm" aria-label="Download" title="Download" href={fileUrl(path)} download><Download /></a>}
      {external && <a className="ib sm" aria-label="Open in browser" title="Open in browser" href={external} target="_blank" rel="noreferrer"><ExternalLink /></a>}
    </div>
  </>;
});

export function CanvasLayer({ wins, setWins, dockW, setDockW }: { wins: Win[]; setWins: React.Dispatch<React.SetStateAction<Win[]>>; dockW: number; setDockW: (w: number) => void }) {
  const [imm, setImm] = useState<Record<string, boolean>>({});
  const upd = (id: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const front = (id: string) => setWins((ws) => { const top = Math.max(0, ...ws.map((w) => w.z)); const me = ws.find((w) => w.id === id); if (me && me.z === top) return ws; return ws.map((w) => (w.id === id ? { ...w, z: top + 1 } : w)); });
  const setDock = (id: string, dock: boolean) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, dock, min: false } : dock && w.dock ? { ...w, dock: false, min: true } : w)));
  const drag = (e: React.PointerEvent, w: Win, kind: "move" | "resize" | "dock") => {
    if ((e.target as HTMLElement).closest("button") && kind === "move") return;
    if (w.dock && kind === "move") return;
    e.preventDefault(); front(w.id); document.body.classList.add("dragging");
    const sx = e.clientX, sy = e.clientY, o = { ...w }, ow = dockW;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (kind === "dock") setDockW(Math.round(Math.min(innerWidth - 380, Math.max(320, ow - dx))));
      else if (kind === "resize") upd(w.id, { w: Math.max(260, o.w + dx), h: Math.max(160, o.h + dy) });
      else upd(w.id, { x: Math.min(innerWidth - 80, Math.max(-o.w + 80, o.x + dx)), y: Math.min(innerHeight - 40, Math.max(0, o.y + dy)) });
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); document.body.classList.remove("dragging"); };
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
      <div key={w.id} data-win={w.id} className={`win${w.min && !w.dock ? " min" : ""}${w.pinned || w.dock ? " pinned" : ""}${imm[w.id] ? " immersive" : ""}${w.dock ? " docked" : ""}`}
        style={w.dock ? { zIndex: 30 } : w.min ? { ...trayPos(trayIdx(w.id)), zIndex: 40 + w.z } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 40 + w.z }}
        onPointerDown={() => front(w.id)}
        onMouseMove={(e) => { if (w.dock) return; const r = e.currentTarget.getBoundingClientRect(); const edge = e.clientY - r.top < 48 || r.bottom - e.clientY < 48; if (imm[w.id] === edge) setImm((m) => ({ ...m, [w.id]: !edge })); }}
        onMouseLeave={() => setImm((m) => ({ ...m, [w.id]: false }))}>
        <div className="win-bar top" onPointerDown={(e) => !w.min && drag(e, w, "move")} onClick={(e) => { if (w.min && !(e.target as HTMLElement).closest("button")) upd(w.id, { min: false }); }} onDoubleClick={() => !w.dock && !w.min && upd(w.id, { min: true })}>
          <span className="title">{w.spec.title}</span>
          {!w.dock && !w.min && <button className="ib sm" aria-label={w.pinned ? "Unpin bars" : "Pin bars"} title={w.pinned ? "Unpin bars" : "Pin bars"} onClick={() => upd(w.id, { pinned: !w.pinned })}>{w.pinned ? <PinOff /> : <Pin />}</button>}
          <button className="ib sm" aria-label={w.dock ? "Float" : "Dock beside chat"} title={w.dock ? "Float" : "Dock beside chat"} onClick={() => setDock(w.id, !w.dock)}>{w.dock ? <PictureInPicture2 /> : <PanelRight />}</button>
          {!w.dock && <button className="ib sm" aria-label="Minimize" title="Minimize" onClick={() => upd(w.id, { min: !w.min })}><Minus /></button>}
          <button className="ib sm" aria-label="Close" title="Close" onClick={() => setWins((ws) => ws.filter((x) => x.id !== w.id))}><X /></button>
        </div>
        <Viewer spec={w.spec} winId={w.id} />
        {w.dock ? <div className="win-dockresize" onPointerDown={(e) => drag(e, w, "dock")} aria-label="Resize" role="separator" aria-orientation="vertical" />
          : <div className="win-resize" onPointerDown={(e) => drag(e, w, "resize")} />}
      </div>
    ))}
  </>;
}
