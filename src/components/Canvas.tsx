"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pin, PinOff, Minus, X, PenLine, Eraser, NotebookPen, MessageSquareQuote, Download, Save, ExternalLink } from "lucide-react";
import { CanvasSpec, fileUrl, useApp } from "./ctx";
import { Block } from "./Block";
import { StreamMarkdown, CodeBlock } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "./Message";

export type Win = { id: string; spec: CanvasSpec; x: number; y: number; w: number; h: number; z: number; min: boolean; pinned: boolean };

type Stroke = { c: string; w: number; p: [number, number][] };
const ext = (p: string) => p.split(".").pop()?.toLowerCase() || "";
const kindOf = (p: string) => {
  const e = ext(p);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(e)) return "image";
  if (e === "pdf") return "pdf"; if (e === "html" || e === "htm") return "html"; if (e === "ui") return "ui";
  if (e === "md" || e === "markdown") return "md";
  if (["xlsx", "pptx", "docx", "zip", "mp4", "mp3", "wav"].includes(e)) return "binary";
  return "text";
};
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

function PdfView({ path, ink, setInk, pen }: { path: string; ink: Record<string, Stroke[]>; setInk: (k: string, s: Stroke[]) => void; pen: boolean }) {
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
  const [failed, setFailed] = useState(false);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { getDocumentProxy } = await import("unpdf");
        const buf = new Uint8Array(await (await fetch(fileUrl(path))).arrayBuffer());
        const pdf = await getDocumentProxy(buf);
        const dims: { w: number; h: number }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) { const vp = (await pdf.getPage(i)).getViewport({ scale: 1 }); dims.push({ w: vp.width, h: vp.height }); }
        if (dead) return; setPages(dims);
        await new Promise((r) => setTimeout(r, 30));
        for (let i = 1; i <= pdf.numPages && !dead; i++) {
          const page = await pdf.getPage(i), c = refs.current[i - 1]; if (!c) continue;
          const scale = (c.parentElement!.clientWidth / dims[i - 1].w) * (devicePixelRatio || 1);
          const vp = page.getViewport({ scale }); c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as never).promise;
        }
      } catch (e) { console.warn(e); if (!dead) setFailed(true); }
    })();
    return () => { dead = true; };
  }, [path]);
  if (failed) return <iframe className="full" src={fileUrl(path)} title={path} />;
  return <div style={{ padding: "0 16px" }}>{pages.map((d, i) => (
    <div key={i} className="pdf-page" style={{ aspectRatio: `${d.w}/${d.h}`, maxWidth: 900 }}>
      <canvas ref={(el) => { refs.current[i] = el; }} style={{ width: "100%", height: "100%" }} />
      <Ink strokes={ink[i + 1] || []} onChange={(s) => setInk(String(i + 1), s)} active={pen} />
    </div>))}</div>;
}

const Viewer = memo(function Viewer({ spec, winId }: { spec: CanvasSpec; winId: string }) {
  const app = useApp();
  const md = useMdHandlers();
  const path = spec.kind === "file" ? spec.path : spec.kind === "ui" ? spec.path : undefined;
  const k = spec.kind === "file" ? kindOf(spec.path) : spec.kind;
  const [mode, setMode] = useState<"a" | "b">(k === "text" ? "b" : "a");
  const [src, setSrc] = useState<string>(spec.kind === "ui" ? spec.source : "");
  const [dirty, setDirty] = useState(false);
  const [pen, setPen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [ink, setInkAll] = useState<Record<string, Stroke[]>>({});
  const [rev, setRev] = useState(0);
  const annot = k === "pdf" || k === "image" || k === "html";

  useEffect(() => {
    if (!path || !["text", "md", "html", "ui"].includes(k) || (spec.kind === "ui" && spec.source)) return;
    fetch(fileUrl(path), { cache: "no-store" }).then((r) => r.text()).then(setSrc);
  }, [path, k, spec]);
  useEffect(() => {
    if (!path || !annot) return;
    fetch(fileUrl(notesPath(path) + ".ink.json"), { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then((j: { pages?: Record<string, Stroke[]> }) => setInkAll(j.pages || {})).catch(() => {});
  }, [path, annot]);

  const save = useCallback(async () => {
    if (!path) return;
    await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path, content: src }) });
    setDirty(false); setRev((r) => r + 1); app.refreshTree();
  }, [path, src, app]);
  const saveNotes = useCallback(async (nextInk = ink, text = notes) => {
    if (!path) return;
    const counts = Object.entries(nextInk).filter(([, s]) => s.length).map(([pg, s]) => `- ${k === "pdf" ? "page " + pg : "view"}: ${s.length} mark${s.length > 1 ? "s" : ""}`).join("\n");
    await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: notesPath(path) + ".ink.json", content: JSON.stringify({ file: path, pages: nextInk }) }) });
    if (text !== null) await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: notesPath(path) + ".md", content: `# Notes: ${path}\n\n${text}\n\n## Annotations\n${counts || "- none"}\n` }) });
    app.refreshTree();
  }, [path, ink, notes, k, app]);
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

  let body: React.ReactNode = null;
  if (spec.kind === "youtube") body = <iframe className="full" style={{ background: "black" }} src={`https://www.youtube-nocookie.com/embed/${spec.id}?autoplay=1`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title="YouTube" />;
  else if (spec.kind === "md") body = <div className="reader"><StreamMarkdown text={spec.body} {...md} /></div>;
  else if (k === "ui") body = mode === "a" ? <Block key={rev + src.length} source={src} done fill /> : <textarea className="editor" value={src} spellCheck={false} onChange={(e) => { setSrc(e.target.value); setDirty(true); }} />;
  else if (k === "image") body = <div className="imgview" style={{ position: "relative" }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={fileUrl(path!)} alt="" /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} active={pen} /></div>;
  else if (k === "pdf") body = <PdfView path={path!} ink={ink} setInk={setInk} pen={pen} />;
  else if (k === "html") body = mode === "a" ? <div style={{ position: "relative", height: "100%" }}><iframe key={rev} className="full" src={fileUrl(path!)} sandbox="allow-scripts allow-forms allow-popups allow-modals" title={path} /><Ink strokes={ink.view || []} onChange={(s) => setInk("view", s)} active={pen} /></div>
    : <textarea className="editor" value={src} spellCheck={false} onChange={(e) => { setSrc(e.target.value); setDirty(true); }} />;
  else if (k === "md") body = mode === "a" ? <div className="reader"><StreamMarkdown text={src} {...md} /></div> : <textarea className="editor" value={src} spellCheck={false} onChange={(e) => { setSrc(e.target.value); setDirty(true); }} />;
  else if (k === "text") body = mode === "a" ? <div className="reader"><CodeBlock code={src} lang={ext(path!)} done /></div> : <textarea className="editor" value={src} spellCheck={false} onChange={(e) => { setSrc(e.target.value); setDirty(true); }} />;
  else body = <div className="imgview"><a className="txt-btn solid" href={fileUrl(path!)} download>Download {baseName(path!)}</a></div>;

  const labels: Record<string, [string, string]> = { ui: ["Preview", "Code"], html: ["Preview", "Code"], md: ["Read", "Write"], text: ["Read", "Write"] };
  return <>
    <div className="win-body" style={k === "pdf" ? { background: "var(--surface)" } : undefined}>{body}</div>
    {notes !== null && <div className="notes"><textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => saveNotes()} aria-label="Notes" /></div>}
    <div className="win-bar bot">
      {labels[k] && <div className="seg"><button className={mode === "a" ? "on" : ""} onClick={() => setMode("a")}>{labels[k][0]}</button><button className={mode === "b" ? "on" : ""} onClick={() => setMode("b")}>{labels[k][1]}</button></div>}
      {dirty && (path ? <button className="ib sm" aria-label="Save" onClick={save}><Save /></button> : null)}
      {spec.kind === "ui" && !spec.path && <button className="ib sm" aria-label="Save to artifacts" onClick={async () => { const p = `artifacts/${spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ui`; await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: p, content: src }) }); app.refreshTree(); }}><Save /></button>}
      <span style={{ flex: 1 }} />
      {annot && (k !== "html" || mode === "a") && <>
        <button className={"ib sm" + (pen ? " on" : "")} aria-label="Annotate" title="Pen (hold Shift to highlight)" onClick={() => setPen(!pen)}><PenLine /></button>
        {pen && <button className="ib sm" aria-label="Clear marks" onClick={() => { setInkAll({}); saveNotes({}); }}><Eraser /></button>}
        <button className={"ib sm" + (notes !== null ? " on" : "")} aria-label="Notes" onClick={openNotes}><NotebookPen /></button>
      </>}
      {path && <button className="ib sm" aria-label="Ask about this" onClick={() => app.mention(path)}><MessageSquareQuote /></button>}
      {path && <a className="ib sm" aria-label="Download" href={fileUrl(path)} download><Download /></a>}
      {spec.kind === "youtube" && <a className="ib sm" aria-label="Open on YouTube" href={`https://youtu.be/${spec.id}`} target="_blank" rel="noreferrer"><ExternalLink /></a>}
    </div>
  </>;
});

export function CanvasLayer({ wins, setWins }: { wins: Win[]; setWins: React.Dispatch<React.SetStateAction<Win[]>> }) {
  const [imm, setImm] = useState<Record<string, boolean>>({});
  const upd = (id: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const front = (id: string) => setWins((ws) => { const z = Math.max(0, ...ws.map((w) => w.z)) + 1; return ws.map((w) => (w.id === id ? { ...w, z } : w)); });
  const drag = (e: React.PointerEvent, w: Win, resize: boolean) => {
    if ((e.target as HTMLElement).closest("button") && !resize) return;
    e.preventDefault(); front(w.id); document.body.classList.add("dragging");
    const sx = e.clientX, sy = e.clientY, o = { ...w };
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (resize) upd(w.id, { w: Math.max(260, o.w + dx), h: Math.max(160, o.h + dy) });
      else upd(w.id, { x: Math.min(innerWidth - 80, Math.max(-o.w + 80, o.x + dx)), y: Math.min(innerHeight - 40, Math.max(0, o.y + dy)) });
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); document.body.classList.remove("dragging"); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  return <>
    <style>{`body.dragging iframe{pointer-events:none}body.dragging{user-select:none}`}</style>
    {wins.map((w) => (
      <div key={w.id} data-win={w.id} className={`win${w.min ? " min" : ""}${w.pinned ? " pinned" : ""}${imm[w.id] ? " immersive" : ""}`}
        style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 40 + w.z }}
        onPointerDown={() => front(w.id)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const edge = e.clientY - r.top < 48 || r.bottom - e.clientY < 48; if (imm[w.id] === edge) setImm((m) => ({ ...m, [w.id]: !edge })); }}
        onMouseLeave={() => setImm((m) => ({ ...m, [w.id]: false }))}>
        <div className="win-bar top" onPointerDown={(e) => drag(e, w, false)} onDoubleClick={() => upd(w.id, { min: !w.min })}>
          <span className="title">{w.spec.title}</span>
          <button className="ib sm" aria-label={w.pinned ? "Unpin bars" : "Pin bars"} onClick={() => upd(w.id, { pinned: !w.pinned })}>{w.pinned ? <PinOff /> : <Pin />}</button>
          <button className="ib sm" aria-label="Minimize" onClick={() => upd(w.id, { min: !w.min })}><Minus /></button>
          <button className="ib sm" aria-label="Close" onClick={() => setWins((ws) => ws.filter((x) => x.id !== w.id))}><X /></button>
        </div>
        <Viewer spec={w.spec} winId={w.id} />
        <div className="win-resize" onPointerDown={(e) => drag(e, w, true)} />
      </div>
    ))}
  </>;
}
