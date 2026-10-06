"use client";
/* The viewer switcher: picks the native viewer for a canvas spec and owns the shared per-window
   tools (source editing, ink annotations, notes, snip, download, mention). Bars float over the
   content; type-specific actions arrive through setBar from each viewer. */
import { memo, useCallback, useEffect, useState } from "react";
import { PenLine, Eraser, NotebookPen, MessageSquareQuote, Download, Save, ExternalLink, RotateCw, Code2, Eye, Scissors } from "lucide-react";
import { CanvasSpec, fileUrl, useApp } from "../ctx";
import { Block } from "../Block";
import { StreamMarkdown, CodeBlock } from "@/lib/streammark/StreamMarkdown";
import { useMdHandlers } from "../Message";
import { SheetView, DocView, SlidesView, ArchiveView, MediaView, extOf } from "../viewers";
import { canvasPath } from "@/lib/shared";
import { ChatView } from "../ChatView";
import { kindOf, notesPath } from "./types";
import { PdfView } from "./PdfView";
import { Ink, Stroke } from "./Ink";
import { SnipLayer } from "./Snip";

const baseName = (p: string) => p.split("/").pop() || p;

export const Viewer = memo(function Viewer({ spec, winId, ctl }: { spec: CanvasSpec; winId: string; ctl?: React.ReactNode }) {
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
