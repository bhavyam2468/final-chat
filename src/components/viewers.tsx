"use client";
/* Type-specific canvas viewers. Each exposes its actions to the window's bottom bar via `bar` (a React node). */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Folder, FileText, FileArchive, Copy, Check, StickyNote, Maximize, PackageOpen, Search, Repeat, PictureInPicture2, ArrowUpLeft, Download } from "lucide-react";
import { fileUrl, useApp } from "./ctx";
import { CodeBlock } from "@/lib/streammark/StreamMarkdown";

const colName = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const human = (n: number) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
export const extOf = (p: string) => (p.match(/\.(tar\.gz|tar\.bz2|tar\.xz|[^./]+)$/i)?.[1] || "").toLowerCase();

function usePreview<T>(path: string, as: string) {
  // results are keyed by request, so a path change shows loading without resetting state inside the effect
  const key = as + "\u0000" + path;
  const [res, setRes] = useState<{ key: string; data: T | null; err: string | null }>({ key: "", data: null, err: null });
  useEffect(() => {
    let dead = false;
    fetch(`/api/preview?as=${as}&path=${encodeURIComponent(path)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (!dead) setRes({ key, data: j.error ? null : j, err: j.error || null }); })
      .catch((e) => { if (!dead) setRes({ key, data: null, err: String(e) }); });
    return () => { dead = true; };
  }, [path, as, key]);
  return res.key === key ? { data: res.data, err: res.err } : { data: null, err: null };
}
function CopyAct({ get, label }: { get: () => string; label: string }) {
  const [ok, setOk] = useState(false);
  return <button className="ib sm" aria-label={label} title={label} onClick={() => { navigator.clipboard.writeText(get()); setOk(true); setTimeout(() => setOk(false), 1200); }}>{ok ? <Check /> : <Copy />}</button>;
}
export function Loading({ err }: { err?: string | null }) {
  return err ? <div className="v-msg err">{err}</div> : <div className="v-msg"><span className="spin" /></div>;
}

/* ---------------------------------------------------------------- spreadsheet */
type Sheets = { sheets: { name: string; rows: string[][]; total: number }[] };
export function SheetView({ path, setBar }: { path: string; setBar: (n: React.ReactNode) => void }) {
  const { data, err } = usePreview<Sheets>(path, "sheet");
  const [si, setSi] = useState(0);
  const [q, setQ] = useState<string | null>(null);
  const [selCell, setSel] = useState<[number, number] | null>(null);
  const sh = data?.sheets[si];
  const rows = useMemo(() => {
    if (!sh) return [] as [string[], number][];
    const all = sh.rows.map((r, i) => [r, i] as [string[], number]);
    if (!q) return all;
    const n = q.toLowerCase();
    return all.filter(([r, i]) => i === 0 || r.some((c) => c.toLowerCase().includes(n)));
  }, [sh, q]);
  const width = sh ? Math.max(0, ...sh.rows.slice(0, 200).map((r) => r.length)) : 0;
  const csv = () => (sh ? sh.rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") : "");
  useEffect(() => {
    setBar(<>
      {data && data.sheets.length > 1 && <div className="seg sheets">{data.sheets.map((s, i) => <button key={i} className={i === si ? "on" : ""} onClick={() => { setSi(i); setSel(null); }}>{s.name}</button>)}</div>}
      {sh && <span className="v-meta">{selCell ? `${colName(selCell[1])}${selCell[0] + 1} · ${sh.rows[selCell[0]]?.[selCell[1]] ?? ""}` : `${sh.total.toLocaleString()} rows × ${width} cols${sh.total > sh.rows.length ? ` · first ${sh.rows.length.toLocaleString()}` : ""}`}</span>}
      <span className="sp" />
      {q !== null && <input className="v-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ(null)} aria-label="Filter rows" />}
      <button className={"ib sm" + (q !== null ? " on" : "")} aria-label="Filter rows" title="Filter rows" onClick={() => setQ(q === null ? "" : null)}><Search /></button>
      <CopyAct get={csv} label="Copy sheet as CSV" />
    </>);
  }, [data, si, sh, q, selCell, width, setBar]);
  if (!data) return <Loading err={err} />;
  return <div className="sheet">
    <table>
      <thead><tr><th className="rn" />{Array.from({ length: width }, (_, i) => <th key={i}>{colName(i)}</th>)}</tr></thead>
      <tbody>{rows.map(([r, ri]) => <tr key={ri} className={ri === 0 ? "hdr" : ""}>
        <td className="rn">{ri + 1}</td>
        {Array.from({ length: width }, (_, ci) => { const v = r[ci] ?? ""; return <td key={ci} className={(/^-?[\d,.]+%?$/.test(v) ? "num" : "") + (selCell && selCell[0] === ri && selCell[1] === ci ? " sel" : "")} onClick={() => setSel([ri, ci])} title={v.length > 40 ? v : undefined}>{v}</td>; })}
      </tr>)}</tbody>
    </table>
  </div>;
}

/* ---------------------------------------------------------------- document */
export function DocView({ path, setBar, Pdf }: { path: string; setBar: (n: React.ReactNode) => void; Pdf: (p: { path: string }) => React.ReactNode }) {
  const { data, err } = usePreview<{ html?: string; pdf?: string }>(path, "doc");
  const ref = useRef<HTMLDivElement>(null);
  const [words, setWords] = useState(0);
  useEffect(() => { if (ref.current) setWords((ref.current.innerText.match(/\S+/g) || []).length); }, [data]);
  useEffect(() => {
    setBar(<>{data?.html !== undefined && <span className="v-meta">{words.toLocaleString()} words</span>}<span className="sp" />
      {data?.html !== undefined && <CopyAct get={() => ref.current?.innerText || ""} label="Copy text" />}</>);
  }, [data, words, setBar]);
  if (!data) return <Loading err={err} />;
  if (data.pdf) return <>{Pdf({ path: data.pdf })}</>;
  return <div className="docview"><div className="page" ref={ref} dangerouslySetInnerHTML={{ __html: data.html || "" }} /></div>;
}

/* ---------------------------------------------------------------- slides */
type SlideItem = { t: "text"; b: number[]; p: { t: string; l: number; s: number | null; b: boolean }[]; ph: string | null } | { t: "img"; b: number[]; src: string } | { t: "table"; b: number[]; rows: string[][] };
type Deck = { ratio: number; slides: { items: SlideItem[]; notes: string }[]; pdf?: string };
function Slide({ s, ratio }: { s: Deck["slides"][0]; ratio: number }) {
  return <div className="slide" style={{ aspectRatio: String(ratio) }}>
    {s.items.map((it, i) => {
      const st = { left: it.b[0] + "%", top: it.b[1] + "%", width: it.b[2] + "%", height: it.b[3] + "%" };
      // eslint-disable-next-line @next/next/no-img-element
      if (it.t === "img") return <img key={i} src={fileUrl(it.src)} alt="" style={st} />;
      if (it.t === "table") return <div key={i} className="s-tbl" style={st}><table><tbody>{it.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody></table></div>;
      const title = it.ph === "TITLE" || it.ph === "CENTER_TITLE";
      return <div key={i} className={"s-txt" + (title ? " title" : "")} style={st}>{it.p.map((p, pi) => p.t.trim()
        ? <p key={pi} style={{ paddingLeft: p.l * 1.4 + "em", fontSize: p.s ? `${(p.s / 7.2).toFixed(2)}cqw` : undefined, fontWeight: p.b || title ? 600 : undefined }}>{!title && it.p.length > 1 ? <span className="bul" /> : null}{p.t}</p>
        : <br key={pi} />)}</div>;
    })}
  </div>;
}
export function SlidesView({ path, setBar, Pdf }: { path: string; setBar: (n: React.ReactNode) => void; Pdf: (p: { path: string }) => React.ReactNode }) {
  const { data, err } = usePreview<Deck>(path, "slides");
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState(false);
  const [grid, setGrid] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const n = data?.slides?.length || 0;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!box.current || !(box.current.closest(".win")?.contains(document.activeElement) || document.fullscreenElement === box.current)) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); setI((x) => Math.min(n - 1, x + 1)); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [n]);
  useEffect(() => {
    if (!data || data.pdf) { setBar(null); return; }
    setBar(<>
      <button className="ib sm" aria-label="Previous slide" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft /></button>
      <span className="v-meta num">{i + 1} / {n}</span>
      <button className="ib sm" aria-label="Next slide" disabled={i >= n - 1} onClick={() => setI(i + 1)}><ChevronRight /></button>
      <span className="sp" />
      <button className={"ib sm" + (grid ? " on" : "")} aria-label="All slides" title="All slides" onClick={() => setGrid(!grid)}><Folder /></button>
      <button className={"ib sm" + (notes ? " on" : "")} aria-label="Speaker notes" title="Speaker notes" onClick={() => setNotes(!notes)}><StickyNote /></button>
      <button className="ib sm" aria-label="Present" title="Present" onClick={() => box.current?.requestFullscreen?.()}><Maximize /></button>
      <CopyAct get={() => data.slides.map((s, k) => `## Slide ${k + 1}\n` + s.items.map((it) => (it.t === "text" ? it.p.map((p) => p.t).join("\n") : "")).filter(Boolean).join("\n") + (s.notes ? `\n> ${s.notes}` : "")).join("\n\n")} label="Copy outline" />
    </>);
  }, [data, i, n, notes, grid, setBar]);
  if (!data) return <Loading err={err} />;
  if (data.pdf) return <>{Pdf({ path: data.pdf })}</>;
  const s = data.slides[i];
  if (grid) return <div className="slide-grid">{data.slides.map((x, k) => <button key={k} className={k === i ? "on" : ""} onClick={() => { setI(k); setGrid(false); }}><Slide s={x} ratio={data.ratio} /><small>{k + 1}</small></button>)}</div>;
  return <div className="slides" ref={box} tabIndex={-1} onClick={(e) => { if (document.fullscreenElement) setI((x) => (e.clientX > innerWidth / 2 ? Math.min(n - 1, x + 1) : Math.max(0, x - 1))); }}>
    {s && <Slide key={i} s={s} ratio={data.ratio} />}
    {notes && s?.notes && <div className="s-notes">{s.notes}</div>}
  </div>;
}

/* ---------------------------------------------------------------- archive (browse without extracting) */
type Entry = { name: string; size: number; packed?: number; dir: boolean; date?: string };
const TEXTY = /\.(txt|md|json|js|ts|tsx|jsx|py|html|css|csv|xml|yml|yaml|toml|ini|sh|c|cpp|h|java|go|rs|rb|php|sql|log|cfg|conf|gitignore|env)$/i;
const IMGY = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
export function ArchiveView({ path, setBar }: { path: string; setBar: (n: React.ReactNode) => void }) {
  const app = useApp();
  const { data, err } = usePreview<{ type: string; entries: Entry[] }>(path, "archive");
  const [dir, setDir] = useState("");
  const [peek, setPeek] = useState<{ name: string; text?: string; img?: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // normalise into a tree with implicit directories
  const all = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of data?.entries || []) {
      const parts = e.name.replace(/\/$/, "").split("/");
      for (let k = 1; k < parts.length; k++) { const d = parts.slice(0, k).join("/") + "/"; if (!m.has(d)) m.set(d, { name: d, size: 0, dir: true }); }
      m.set(e.dir ? e.name.replace(/\/?$/, "/") : e.name, { ...e, name: e.dir ? e.name.replace(/\/?$/, "/") : e.name });
    }
    return [...m.values()];
  }, [data]);
  const here = all.filter((e) => { if (!e.name.startsWith(dir) || e.name === dir) return false; const rest = e.name.slice(dir.length).replace(/\/$/, ""); return !rest.includes("/"); })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  const total = (data?.entries || []).filter((e) => !e.dir).reduce((a, e) => a + e.size, 0);
  const extract = async (entries: string[]) => {
    setBusy("Extracting…");
    const r = await fetch("/api/preview", { method: "POST", body: JSON.stringify({ path, entries }) }).then((r) => r.json());
    setBusy(r.error ? r.error : `Extracted ${r.n} to ${r.dir}`); app.refreshTree(); setPicked(new Set());
    setTimeout(() => setBusy(null), 3500);
  };
  const open = async (e: Entry) => {
    if (e.dir) { setDir(e.name); setPeek(null); return; }
    const url = `/api/preview?as=entry&path=${encodeURIComponent(path)}&entry=${encodeURIComponent(e.name)}`;
    if (IMGY.test(e.name)) setPeek({ name: e.name, img: url });
    else if (TEXTY.test(e.name) || e.size < 200000) { const t = await fetch(url).then((r) => r.text()); setPeek({ name: e.name, text: /[\x00-\x08\x0e-\x1f]/.test(t.slice(0, 2000)) ? "(binary file)" : t.slice(0, 200000) }); }
    else setPeek({ name: e.name, text: "(large binary file — extract to open)" });
  };
  useEffect(() => {
    setBar(<>
      <span className="v-meta">{busy || (data ? `${data.entries.filter((e) => !e.dir).length} files · ${human(total)}` : "")}</span>
      <span className="sp" />
      {picked.size > 0 && <button className="txt-btn" onClick={() => extract([...picked])}>Extract {picked.size}</button>}
      <button className="ib sm" aria-label="Extract all" title="Extract all" onClick={() => extract([])}><PackageOpen /></button>
    </>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, busy, picked, total, setBar]);
  if (!data) return <Loading err={err} />;
  const crumbs = dir ? dir.replace(/\/$/, "").split("/") : [];
  return <div className={"archive" + (peek ? " peeking" : "")}>
    <div className="ar-list">
      <div className="crumbs">
        <button onClick={() => { setDir(""); setPeek(null); }}><FileArchive />{path.split("/").pop()}</button>
        {crumbs.map((c, k) => <span key={k}>/<button onClick={() => { setDir(crumbs.slice(0, k + 1).join("/") + "/"); setPeek(null); }}>{c}</button></span>)}
      </div>
      {dir && <button className="ar-row" onClick={() => setDir(crumbs.length > 1 ? crumbs.slice(0, -1).join("/") + "/" : "")}><ArrowUpLeft /><span className="nm">..</span></button>}
      {here.map((e) => {
        const nm = e.name.slice(dir.length).replace(/\/$/, "");
        return <div key={e.name} className={"ar-row" + (peek?.name === e.name ? " on" : "")}>
          <input type="checkbox" aria-label={"Select " + nm} checked={picked.has(e.name)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(e.name)) n.delete(e.name); else n.add(e.name); return n; })} />
          <button onClick={() => open(e)}>{e.dir ? <Folder /> : <FileText />}<span className="nm">{nm}</span>{!e.dir && <small>{human(e.size)}</small>}</button>
        </div>;
      })}
    </div>
    {peek && <div className="ar-peek">
      <div className="ar-peek-h"><span>{peek.name.split("/").pop()}</span><span className="sp" /><a className="ib sm" aria-label="Download entry" href={`/api/preview?as=entry&path=${encodeURIComponent(path)}&entry=${encodeURIComponent(peek.name)}`} download={peek.name.split("/").pop()}><Download /></a></div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {peek.img ? <div className="imgview"><img src={peek.img} alt="" /></div> : <CodeBlock code={peek.text || ""} lang={extOf(peek.name)} done />}
    </div>}
  </div>;
}

/* ---------------------------------------------------------------- audio / video */
export function MediaView({ src, video, setBar }: { src: string; video: boolean; setBar: (n: React.ReactNode) => void }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  useEffect(() => { if (ref.current) { ref.current.playbackRate = rate; ref.current.loop = loop; } }, [rate, loop]);
  useEffect(() => {
    setBar(<>
      <div className="seg">{[0.75, 1, 1.5, 2].map((r) => <button key={r} className={rate === r ? "on" : ""} onClick={() => setRate(r)}>{r}×</button>)}</div>
      <span className="sp" />
      <button className={"ib sm" + (loop ? " on" : "")} aria-label="Loop" title="Loop" onClick={() => setLoop(!loop)}><Repeat /></button>
      {video && <button className="ib sm" aria-label="Picture in picture" title="Picture in picture" onClick={() => ref.current?.requestPictureInPicture?.()}><PictureInPicture2 /></button>}
    </>);
  }, [rate, loop, video, setBar]);
  return video
    ? <div className="mediaview"><video ref={ref} src={src} controls autoPlay playsInline /></div>
    : <div className="mediaview audio"><audio ref={ref} src={src} controls autoPlay /></div>;
}
