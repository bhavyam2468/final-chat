"use client";
/* streammark — standalone streaming markdown renderer.
   Usage: <StreamMarkdown text={md} streaming={bool} onLink={fn} components={{ui, canvas}} />
   Styles: streammark.css (class prefix sm-). No app dependencies. */
import React, { memo, useMemo, useState, createContext, useContext } from "react";
import { Marked, Token, Tokens, TokenizerExtension, RendererExtension } from "marked";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import { remend, segment, Segment } from "./remend";
type XSeg = Exclude<Segment, { kind: "md" }>;

type Ext = TokenizerExtension & RendererExtension;
const inline = (name: string, start: string, re: RegExp, map: (m: RegExpExecArray) => Record<string, unknown>): Ext => ({
  name, level: "inline", start: (s: string) => { const i = s.indexOf(start); return i < 0 ? undefined : i; },
  tokenizer(src: string) { const m = re.exec(src); if (m) return { type: name, raw: m[0], ...map(m) }; },
  renderer: () => "",
});
const EXTS: Ext[] = [
  { name: "mathBlock", level: "block", start: (s: string) => { const i = s.indexOf("$$"); return i < 0 ? undefined : i; },
    tokenizer(src: string) { const m = /^\$\$([\s\S]+?)\$\$\s*(?:\n|$)/.exec(src); if (m) return { type: "mathBlock", raw: m[0], tex: m[1].trim() }; }, renderer: () => "" },
  { name: "fnDef", level: "block", start: (s: string) => { const i = s.search(/^\[\^/m); return i < 0 ? undefined : i; },
    tokenizer(src: string) { const m = /^\[\^([^\]]+)\]:\s*([^\n]*(?:\n(?!\n|\[\^)[^\n]*)*)\n*/.exec(src); if (m) return { type: "fnDef", raw: m[0], id: m[1], text: m[2], tokens: this.lexer.inlineTokens(m[2]) }; }, renderer: () => "" },
  inline("mark", "==", /^==(?!=)([^\n]+?)==/, (m) => ({ text: m[1] })),
  inline("mathInline", "$", /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/, (m) => ({ tex: m[1] })),
  inline("fnRef", "[^", /^\[\^([^\]]+)\](?!:)/, (m) => ({ id: m[1] })),
];
// markdown tokens inside mark need inline lexing
EXTS[2].tokenizer = function (src: string) { const m = /^==(?!=)([^\n]+?)==/.exec(src); if (m) return { type: "mark", raw: m[0], tokens: this.lexer.inlineTokens(m[1]) }; };

const md = new Marked({ gfm: true, breaks: false });
md.use({ extensions: EXTS });

export type SMComponents = {
  ui?: (p: { source: string; done: boolean; attrs: Record<string, string> }) => React.ReactNode;
  canvas?: (p: { title: string; body: string; done: boolean }) => React.ReactNode;
};
type Ctx = { onLink?: (href: string, e: React.MouseEvent) => boolean | void; streaming: boolean; fn: Map<string, number>; components: SMComponents; resolveSrc?: (s: string) => string };
const C = createContext<Ctx>({ streaming: false, fn: new Map(), components: {} });

const yt = (u: string) => u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)?.[1];
const IMG = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i;

function Tex({ tex, display }: { tex: string; display?: boolean }) {
  const html = useMemo(() => { try { return katex.renderToString(tex, { displayMode: display, throwOnError: false }); } catch { return tex; } }, [tex, display]);
  return <span className={display ? "sm-math-block" : "sm-math"} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Img({ src, alt }: { src: string; alt?: string }) {
  const { resolveSrc } = useContext(C);
  const [ok, setOk] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={"sm-img" + (ok ? " is-in" : "")} src={resolveSrc ? resolveSrc(src) : src} alt={alt || ""} loading="lazy" onLoad={() => setOk(true)} />;
}

export function CodeBlock({ code, lang, done }: { code: string; lang?: string; done: boolean }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => {
    if (!done) return null;
    try { return lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value; } catch { return null; }
  }, [code, lang, done]);
  return (
    <div className={"sm-code" + (done ? "" : " is-live")}>
      <div className="sm-code-head">
        <span>{lang || "text"}</span>
        <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} aria-label="Copy code">{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre>{html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}</pre>
    </div>
  );
}

function Inline({ tokens }: { tokens?: Token[] }) {
  const ctx = useContext(C);
  if (!tokens) return null;
  return <>{tokens.map((t, i) => {
    const tk = t as Token & { tokens?: Token[]; text?: string; href?: string; title?: string; tex?: string; id?: string };
    switch (t.type) {
      case "text": return tk.tokens ? <Inline key={i} tokens={tk.tokens} /> : <React.Fragment key={i}>{decode(tk.text || "")}</React.Fragment>;
      case "escape": return <React.Fragment key={i}>{tk.text}</React.Fragment>;
      case "strong": return <strong key={i}><Inline tokens={tk.tokens} /></strong>;
      case "em": return <em key={i}><Inline tokens={tk.tokens} /></em>;
      case "del": return <del key={i}><Inline tokens={tk.tokens} /></del>;
      case "codespan": return <code key={i} className="sm-codespan">{decode(tk.text || "")}</code>;
      case "br": return <br key={i} />;
      case "mark": return <mark key={i} className="sm-mark"><Inline tokens={tk.tokens} /></mark>;
      case "mathInline": return <Tex key={i} tex={tk.tex!} />;
      case "fnRef": { const n = ctx.fn.get(tk.id!) ?? 0; return ctx.streaming ? null : <sup key={i} className="sm-fnref"><a href={`#fn-${tk.id}`}>{n || tk.id}</a></sup>; }
      case "image": return <Img key={i} src={tk.href!} alt={tk.text} />;
      case "link": return (
        <a key={i} href={tk.href} target={/^https?:/.test(tk.href || "") ? "_blank" : undefined} rel="noreferrer" className="sm-link"
          onClick={(e) => { if (ctx.onLink && ctx.onLink(tk.href!, e) === true) e.preventDefault(); }}><Inline tokens={tk.tokens} /></a>);
      case "html": {
        const h = tk.text || "";
        const m = h.match(/^<(kbd|sup|sub|mark|u|small)>$/i); if (m) return null;
        if (/^<br\s*\/?>$/i.test(h)) return <br key={i} />;
        return null;
      }
      default: return <React.Fragment key={i}>{tk.text || ""}</React.Fragment>;
    }
  })}</>;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function BlockView({ t, done }: { t: Token; done: boolean }) {
  switch (t.type) {
    case "space": return null;
    case "heading": { const H = `h${(t as Tokens.Heading).depth}` as "h2"; return <H className="sm-h"><Inline tokens={(t as Tokens.Heading).tokens} /></H>; }
    case "paragraph": {
      const p = t as Tokens.Paragraph;
      const only = p.tokens.length === 1 ? (p.tokens[0] as Tokens.Link) : null;
      if (only && (only.type === "link" || only.type === "text")) {
        const url = only.type === "link" ? only.href : only.text.trim();
        const id = /^https?:\/\/\S+$/.test(url) ? yt(url) : undefined;
        if (id) return <div className="sm-embed"><iframe src={`https://www.youtube-nocookie.com/embed/${id}`} allow="encrypted-media; picture-in-picture" allowFullScreen title="YouTube" /></div>;
        if (/^https?:\/\/\S+$/.test(url) && IMG.test(url)) return <p><Img src={url} /></p>;
      }
      return <p><Inline tokens={p.tokens} /></p>;
    }
    case "code": return <CodeBlock code={(t as Tokens.Code).text} lang={(t as Tokens.Code).lang} done={done} />;
    case "mathBlock": return <Tex tex={(t as unknown as { tex: string }).tex} display />;
    case "blockquote": return <blockquote><Blocks tokens={(t as Tokens.Blockquote).tokens} done={done} /></blockquote>;
    case "hr": return <hr />;
    case "list": {
      const l = t as Tokens.List; const L = l.ordered ? "ol" : "ul";
      return <L start={l.ordered && l.start !== 1 ? (l.start as number) : undefined} className={l.items.some((x) => x.task) ? "sm-tasks" : undefined}>
        {l.items.map((it, i) => <li key={i} className="sm-li">
          {it.task && <span className={"sm-check" + (it.checked ? " is-on" : "")} aria-hidden />}
          <Blocks tokens={it.tokens.filter((x) => x.type !== "checkbox")} done={done} tight={!l.loose} />
        </li>)}
      </L>;
    }
    case "table": {
      const tb = t as Tokens.Table;
      return <div className="sm-table"><table>
        <thead><tr>{tb.header.map((h, i) => <th key={i} style={{ textAlign: tb.align[i] || undefined }}><Inline tokens={h.tokens} /></th>)}</tr></thead>
        <tbody>{tb.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ textAlign: tb.align[ci] || undefined }}><Inline tokens={c.tokens} /></td>)}</tr>)}</tbody>
      </table></div>;
    }
    case "fnDef": return null;
    case "html": return null;
    case "text": return <p><Inline tokens={(t as Tokens.Text).tokens || [t]} /></p>;
    default: return null;
  }
}

function Blocks({ tokens, done, tight }: { tokens: Token[]; done: boolean; tight?: boolean }) {
  return <>{tokens.map((t, i) => tight && t.type === "text" ? <Inline key={i} tokens={(t as Tokens.Text).tokens || [t]} /> : <BlockView key={i} t={t} done={done} />)}</>;
}

/** Memoised top-level block: completed blocks never re-render while streaming. */
const TopBlock = memo(function TopBlock({ t, done }: { raw: string; t: Token; done: boolean; fnKey: string }) {
  return <div className="sm-block"><BlockView t={t} done={done} /></div>;
}, (a, b) => a.raw === b.raw && a.done === b.done && a.fnKey === b.fnKey);

function MdSegment({ text, live }: { text: string; live: boolean }) {
  const ctx = useContext(C);
  const tokens = useMemo(() => md.lexer(live ? remend(text) : text), [text, live]);
  const fnKey = ctx.streaming ? "s" : [...ctx.fn.keys()].join(",");
  return <>{tokens.map((t, i) => <TopBlock key={i} raw={t.raw} t={t} done={!live || i < tokens.length - 1} fnKey={fnKey} />)}</>;
}

function Details({ seg, live }: { seg: XSeg; live: boolean }) {
  const m = seg.body.match(/<summary>([\s\S]*?)<\/summary>/);
  const summary = m?.[1] ?? "Details";
  const body = m ? seg.body.replace(m[0], "") : seg.body;
  return <details className={"sm-details" + (seg.closed ? "" : " is-live")} open={seg.attrs.open !== undefined ? true : undefined}>
    <summary><span>{summary.replace(/<[^>]+>/g, "")}</span></summary>
    <div className="sm-details-body"><Segments text={body} live={live && !seg.closed} /></div>
  </details>;
}

function Segments({ text, live }: { text: string; live: boolean }) {
  const ctx = useContext(C);
  const segs = useMemo(() => segment(text), [text]);
  return <>{segs.map((s, i) => {
    const isLast = i === segs.length - 1;
    if (s.kind === "md") return <MdSegment key={i} text={s.text} live={live && isLast} />;
    if (s.kind === "details") return <Details key={i} seg={s as XSeg} live={live && isLast} />;
    if (s.kind === "ui") return <React.Fragment key={i}>{ctx.components.ui ? ctx.components.ui({ source: s.body, done: s.closed, attrs: s.attrs }) : <CodeBlock code={s.body} lang="html" done={s.closed} />}</React.Fragment>;
    if (s.kind === "canvas") return <React.Fragment key={i}>{ctx.components.canvas ? ctx.components.canvas({ title: s.attrs.title || "Canvas", body: s.body, done: s.closed }) : null}</React.Fragment>;
    return null;
  })}</>;
}

export function StreamMarkdown({ text, streaming = false, onLink, components = {}, resolveSrc, className }: {
  text: string; streaming?: boolean; onLink?: Ctx["onLink"]; components?: SMComponents; resolveSrc?: (s: string) => string; className?: string;
}) {
  const defs = useMemo(() => {
    if (streaming) return [] as { id: string; tokens: Token[] }[];
    const out: { id: string; tokens: Token[] }[] = [];
    md.lexer(text).forEach((t) => { if (t.type === "fnDef") out.push(t as unknown as { id: string; tokens: Token[] }); });
    return out;
  }, [text, streaming]);
  const fn = useMemo(() => new Map(defs.map((d, i) => [d.id, i + 1])), [defs]);
  const ctx = useMemo(() => ({ onLink, streaming, fn, components, resolveSrc }), [onLink, streaming, fn, components, resolveSrc]);
  return (
    <C.Provider value={ctx}>
      <div className={"sm " + (className || "")}>
        <Segments text={text} live={streaming} />
        {defs.length > 0 && <ol className="sm-footnotes">{defs.map((d) => <li key={d.id} id={`fn-${d.id}`}><Inline tokens={d.tokens} /></li>)}</ol>}
      </div>
    </C.Provider>
  );
}
export default StreamMarkdown;
