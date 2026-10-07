"use client";
/* The canvas editor. One file, no editor dependency: a real textarea (native caret, selection, undo,
   IME) with a highlight layer painted behind it — highlight.js for code, the same engine for markdown —
   plus the behaviours that make writing in a canvas bearable:
     · Tab / Shift+Tab indent a line or a whole selection, indentation is language-aware (2 or 4, tabs for Go)
     · Enter keeps the indentation, opens a brace/bracket block, continues a markdown list or a quote
     · brackets and quotes close themselves, a selection is wrapped by typing the opener, a closer steps over
     · Backspace deletes an empty pair and un-indents to the previous stop
     · Ctrl/Cmd+/ toggles a line comment, Alt+↑/↓ moves lines, Home goes to the first non-space
     · Ctrl/Cmd+S saves (the canvas owns the save), Ctrl/Cmd+Enter runs the file
     · line-number gutter, active line, Ln/Col, language, indent and wrap controls in a status strip
   Edits go through execCommand("insertText") when the browser has it, so the native undo stack and the
   input event both survive; otherwise the value is replaced directly. */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import { WrapText, CornerDownLeft } from "lucide-react";

export type LangSpec = { id: string; label: string; indent: number; tab: boolean; comment: [string, string] | null };

const L = (id: string, label: string, indent = 2, comment: [string, string] | null = ["//", ""], tab = false): LangSpec => ({ id, label, indent, comment, tab });
const PLAIN: LangSpec = { id: "plaintext", label: "text", indent: 2, tab: false, comment: null };

const LANGS: Record<string, LangSpec> = {
  md: L("markdown", "markdown", 2, null), markdown: L("markdown", "markdown", 2, null), mdx: L("markdown", "mdx", 2, null),
  txt: PLAIN, log: PLAIN, csv: PLAIN, tsv: PLAIN, ui: L("xml", "blocks", 2, ["<!--", "-->"]),
  html: L("xml", "html", 2, ["<!--", "-->"]), htm: L("xml", "html", 2, ["<!--", "-->"]), xml: L("xml", "xml", 2, ["<!--", "-->"]),
  svg: L("xml", "svg", 2, ["<!--", "-->"]), vue: L("xml", "vue", 2, ["<!--", "-->"]), svelte: L("xml", "svelte", 2, ["<!--", "-->"]),
  css: L("css", "css", 2, ["/*", "*/"]), scss: L("scss", "scss", 2, ["//", ""]), less: L("less", "less", 2, ["//", ""]),
  js: L("javascript", "javascript"), jsx: L("javascript", "jsx"), mjs: L("javascript", "javascript"), cjs: L("javascript", "javascript"),
  ts: L("typescript", "typescript"), tsx: L("typescript", "tsx"), mts: L("typescript", "typescript"), cts: L("typescript", "typescript"),
  json: L("json", "json", 2, null), jsonc: L("json", "json", 2, null), ipynb: L("json", "notebook", 2, null),
  py: L("python", "python", 4, ["#", ""]), pyw: L("python", "python", 4, ["#", ""]),
  sh: L("bash", "bash", 2, ["#", ""]), bash: L("bash", "bash", 2, ["#", ""]), zsh: L("bash", "zsh", 2, ["#", ""]),
  c: L("c", "c", 4), h: L("c", "c header", 4), cpp: L("cpp", "c++", 4), cc: L("cpp", "c++", 4), cxx: L("cpp", "c++", 4), hpp: L("cpp", "c++ header", 4),
  cs: L("csharp", "c#", 4), java: L("java", "java", 4), kt: L("kotlin", "kotlin", 4), kts: L("kotlin", "kotlin", 4),
  rs: L("rust", "rust", 4), go: L("go", "go", 4, ["//", ""], true), swift: L("swift", "swift", 4),
  rb: L("ruby", "ruby", 2, ["#", ""]), php: L("php", "php", 4), lua: L("lua", "lua", 2, ["--", ""]), pl: L("perl", "perl", 4, ["#", ""]),
  r: L("r", "r", 2, ["#", ""]), sql: L("sql", "sql", 2, ["--", ""]), yml: L("yaml", "yaml", 2, ["#", ""]), yaml: L("yaml", "yaml", 2, ["#", ""]),
  toml: L("ini", "toml", 2, ["#", ""]), ini: L("ini", "ini", 2, ["#", ""]), cfg: L("ini", "config", 2, ["#", ""]), conf: L("ini", "config", 2, ["#", ""]),
  mk: L("makefile", "makefile", 4, ["#", ""], true), dockerfile: PLAIN, tex: L("plaintext", "latex", 2, ["%", ""]),
};
export const langOf = (p?: string): LangSpec => LANGS[(p || "").split(".").pop()!.toLowerCase()] || PLAIN;

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ESCAPE[c]);

function highlight(value: string, lang: LangSpec): string {
  if (!value) return "";
  if (value.length > 160_000) return esc(value); // huge file: stay responsive, colours are not worth the jank
  try {
    const id = lang.id !== "plaintext" && hljs.getLanguage(lang.id) ? lang.id : "";
    return id ? hljs.highlight(value, { language: id, ignoreIllegals: true }).value : esc(value);
  } catch { return esc(value); }
}

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const QUOTES = new Set(['"', "'", "`"]);
const CLOSERS = new Set(Object.values(PAIRS));
const OPENERS = new Set(Object.keys(PAIRS));

type Props = {
  value: string;
  onChange: (next: string) => void;
  path?: string;
  /** override the language (a .ui canvas body is blocks, not the file extension) */
  lang?: LangSpec;
  readOnly?: boolean;
  onSave?: () => void;
  onRun?: () => void;
  /** raised when the caret moves, so a parent can show it elsewhere */
  onStatus?: (s: { line: number; col: number; selected: number }) => void;
};

export const Editor = memo(function Editor({ value, onChange, path, lang: langProp, readOnly, onSave, onRun, onStatus }: Props) {
  const lang = langProp || langOf(path);
  const ta = useRef<HTMLTextAreaElement>(null);
  const codeRef = useRef<HTMLElement>(null);
  const numRef = useRef<HTMLDivElement>(null);
  // editor preferences: the language supplies the default, the user's toggle wins for this window
  const [pref, setPref] = useState<{ wrap?: boolean; indent?: number; tabs?: boolean }>({});
  const wrap = pref.wrap ?? (lang.id === "markdown" || lang.id === "plaintext");
  const indentN = pref.indent ?? lang.indent;
  const tabs = pref.tabs ?? lang.tab;
  const setWrap = (f: (w: boolean) => boolean) => setPref((p) => ({ ...p, wrap: f(p.wrap ?? (lang.id === "markdown" || lang.id === "plaintext")) }));
  const cycleIndent = () => setPref((p) => {
    const n = p.indent ?? lang.indent, t = p.tabs ?? lang.tab;
    if (t) return { ...p, tabs: false, indent: 2 };
    if (n === 2) return { ...p, indent: 4 };
    if (n === 4) return { ...p, indent: 4, tabs: true };
    return { ...p, indent: 2 };
  });
  const [caret, setCaret] = useState({ line: 1, col: 1, selected: 0 });
  // The textarea is UNCONTROLLED on purpose: the DOM owns the text and we report every change upward.
  // A controlled textarea lets React write a stale value back over fast keystrokes (auto-pairs and IME
  // edits land in the wrong place). `reported` marks the value we sent, so only real external changes
  // (another file, a parent rewrite) are pushed into the DOM.
  const reported = useRef(value);
  const deferred = useDeferredValue(value);
  const html = useMemo(() => highlight(deferred, lang), [deferred, lang]);
  const lineCount = useMemo(() => deferred.split("\n").length, [deferred]);
  const unit = tabs ? "\t" : " ".repeat(indentN);

  const sync = useCallback(() => {
    const el = ta.current; if (!el) return;
    if (codeRef.current) codeRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (numRef.current) numRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
  }, []);

  const position = useCallback(() => {
    const el = ta.current; if (!el) return;
    const upto = el.value.slice(0, el.selectionStart);
    const line = upto.split("\n").length;
    const col = upto.length - (upto.lastIndexOf("\n") + 1) + 1;
    const next = { line, col, selected: Math.abs(el.selectionEnd - el.selectionStart) };
    setCaret((c) => (c.line === next.line && c.col === next.col && c.selected === next.selected ? c : next));
    onStatus?.(next);
    const active = numRef.current?.querySelector<HTMLElement>(".ed-on");
    const want = String(line);
    if (active && active.textContent !== want) { active.classList.remove("ed-on"); numRef.current?.children[line - 1]?.classList.add("ed-on"); }
    else if (!active) numRef.current?.children[line - 1]?.classList.add("ed-on");
  }, [onStatus]);

  useEffect(() => { sync(); }, [value, wrap, indentN, tabs, sync]);
  useEffect(() => {
    const el = ta.current; if (!el) return;
    if (value === reported.current) return; // our own edit coming back
    reported.current = value;
    if (el.value !== value) {
      const at = Math.min(el.selectionStart ?? 0, value.length);
      el.value = value;
      el.setSelectionRange(at, at);
      sync();
    }
  }, [value, sync]);
  const emit = useCallback((next: string) => { reported.current = next; onChange(next); }, [onChange]);

  /** Replace a range and keep the caret/selection. execCommand keeps the native undo stack.
      The selection is restored SYNCHRONOUSLY after the edit (and again next frame): a fast typist fires the
      next keystroke before any animation frame, and if the caret were still parked after the inserted pair
      that character would land outside it. */
  const replace = useCallback((start: number, end: number, text: string, selStart?: number, selEnd?: number) => {
    const el = ta.current; if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    let done = false;
    try { done = document.execCommand("insertText", false, text); } catch { done = false; }
    const a = selStart ?? start + text.length, b = selEnd ?? a;
    if (!done) { const next = value.slice(0, start) + text + value.slice(end); el.value = next; emit(next); }
    el.setSelectionRange(a, b); // synchronous: a keystroke can arrive before the next frame
    position(); sync();
  }, [emit, position, sync, value]);

  const lineBounds = useCallback((pos: number) => {
    const from = value.lastIndexOf("\n", pos - 1) + 1;
    let to = value.indexOf("\n", pos); if (to < 0) to = value.length;
    return [from, to] as const;
  }, [value]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value: v } = el;
    const mod = e.metaKey || e.ctrlKey;
    const multi = a !== b;

    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); onSave?.(); return; }
    if (mod && e.key === "Enter") { e.preventDefault(); onRun?.(); return; }

    if (mod && (e.key === "/" || e.key === "?" || e.code === "Slash")) {
      if (!lang.comment) return;
      e.preventDefault();
      const [ls] = lineBounds(a < b ? a : a);
      const [, le] = lineBounds(b > a ? b - (v[b - 1] === "\n" ? 1 : 0) : b);
      const block = v.slice(ls, le);
      const [open, close] = lang.comment;
      const linesArr = block.split("\n");
      const marked = linesArr.filter((l) => l.trim()).every((l) => l.trimStart().startsWith(open));
      const next = linesArr.map((l) => {
        if (!l.trim()) return l;
        const lead = l.match(/^[ \t]*/)![0];
        const body = l.slice(lead.length);
        if (marked) return lead + body.slice(open.length).replace(/^ /, close ? "" : "").replace(new RegExp(` ?${close.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
        return lead + open + " " + body + (close ? " " + close : "");
      }).join("\n");
      replace(ls, le, next, ls, ls + next.length);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const [ls] = lineBounds(a);
      const [, le] = lineBounds(b);
      const spanning = multi && v.slice(a, b).includes("\n");
      if (spanning || (multi && ls < a) || e.shiftKey) {
        const block = v.slice(ls, le);
        const linesArr = block.split("\n");
        const next = linesArr.map((l) => {
          if (e.shiftKey) {
            if (l.startsWith(unit)) return l.slice(unit.length);
            const spaces = l.match(/^ +/)?.[0] || "";
            return spaces.length ? spaces.slice(0, Math.max(1, Math.min(indentN, spaces.length))) + l.slice(spaces.length) : l;
          }
          return l.trim() || !multi ? unit + l : unit + l;
        }).join("\n");
        const delta = next.length - block.length;
        replace(ls, le, next, Math.max(ls, a + (e.shiftKey ? 0 : unit.length)), Math.max(ls, b + delta));
        return;
      }
      replace(a, b, unit);
      return;
    }

    if (e.key === "Enter" && !e.altKey) {
      const [ls] = lineBounds(a);
      const before = v.slice(ls, a);
      const lead = (before.match(/^[ \t]*/) || [""])[0];
      const trimmed = before.trimEnd();
      const closer = v[a] || "";
      let body = "\n" + lead;
      // markdown: continue a list / quote / task, and an empty item ends the list
      if (lang.id === "markdown") {
        const m = before.match(/^([ \t]*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/);
        const quote = before.match(/^([ \t]*)>\s?/);
        if (m) {
          e.preventDefault();
          if (!before.slice(m[0].length).trim()) { replace(ls, a, ""); return; }
          const n = m[2].match(/^(\d+)/);
          const mark = n ? `${n[1]}.` : m[2];
          replace(a, b, "\n" + m[1] + mark + " " + (m[3] ? "[ ] " : ""));
          return;
        }
        if (quote) {
          e.preventDefault();
          if (!before.slice(quote[0].length).trim()) { replace(ls, a, ""); return; }
          replace(a, b, "\n" + quote[1] + "> ");
          return;
        }
        if (!before.trim()) { e.preventDefault(); replace(a, b, "\n"); return; }
      }
      // a block that just opened indents one level, and a lone closer expands to its own line
      if (/[{([:]$/.test(trimmed) || (lang.id === "xml" && /<[^/!?][^>]*[^/]>$/.test(trimmed) && !/<\/[\w:-]+>$/.test(trimmed))) body += unit;
      if (closer && CLOSERS.has(closer) && /[{([:]$/.test(trimmed)) {
        e.preventDefault();
        const pair = "\n" + lead + unit + "\n" + lead;
        replace(a, b, pair, a + 1 + lead.length + unit.length);
        return;
      }
      if (multi) { e.preventDefault(); replace(a, b, "\n" + lead); return; }
      e.preventDefault();
      replace(a, b, body);
      return;
    }

    if (e.key === "Backspace" && !multi) {
      const prev = v[a - 1] || "", next = v[a] || "";
      if (PAIRS[prev] === next) { e.preventDefault(); replace(a - 1, a + 1, ""); return; }
      const [ls] = lineBounds(a);
      const before = v.slice(ls, a);
      if (before && !before.trim() && a - ls >= unit.length && (a - ls) % unit.length === 0) {
        e.preventDefault();
        replace(a - unit.length, a, "");
        return;
      }
    }

    if (e.key === "Home" && !mod) {
      const [ls] = lineBounds(a);
      const firstWord = (v.slice(ls).match(/^[ \t]*/) || [""])[0].length + ls;
      e.preventDefault();
      const target = a === firstWord ? ls : firstWord;
      el.setSelectionRange(target, e.shiftKey ? b : target);
      position();
      return;
    }

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const up = e.key === "ArrowUp";
      const [ls] = lineBounds(a);
      const [, le] = lineBounds(b);
      const here = v.slice(ls, le);
      if (up && ls === 0) return;
      if (!up && le >= v.length) return;
      if (up) {
        const prevStart = v.lastIndexOf("\n", ls - 2) + 1;
        const above = v.slice(prevStart, ls - 1);
        replace(prevStart, le, here + "\n" + above, prevStart + here.length + 1, prevStart + here.length + 1 + (b - a));
      } else {
        const nextEnd = v.indexOf("\n", le + 1);
        const below = v.slice(le + 1, nextEnd < 0 ? v.length : nextEnd);
        replace(ls, nextEnd < 0 ? v.length : nextEnd, below + "\n" + here, ls + below.length + 1, ls + below.length + 1 + (b - a));
      }
      return;
    }

    // auto-pairs, wrap-in-pair, skip-over
    if (!mod && !e.altKey && e.key.length === 1) {
      const opener = OPENERS.has(e.key) ? e.key : null;
      const closer = CLOSERS.has(e.key) ? e.key : null;
      if (opener && (multi || !QUOTES.has(opener) || shouldQuote(v, a, opener))) {
        e.preventDefault();
        if (multi) replace(a, b, opener + v.slice(a, b) + PAIRS[opener], a + 1, b + 1);
        else replace(a, b, opener + PAIRS[opener], a + 1);
        return;
      }
      if (closer && !multi && v[a] === closer) { e.preventDefault(); el.setSelectionRange(a + 1, a + 1); position(); return; }
    }
  }, [indentN, lang, lineBounds, onRun, onSave, position, replace, unit]);

  return <div className="ed" data-lang={lang.id}>
    <div className="ed-gut" aria-hidden="true">
      <div className="ed-nums" ref={numRef}>
        {Array.from({ length: lineCount }, (_, i) => <div key={i} className={"ed-n" + (i + 1 === caret.line ? " ed-on" : "")}>{i + 1}</div>)}
      </div>
    </div>
    <div className="ed-main">
      <pre className="ed-hl" aria-hidden="true"><code ref={codeRef} className="hljs" dangerouslySetInnerHTML={{ __html: html + "\n" }} /></pre>
      <textarea ref={ta} className="ed-in" defaultValue={value} readOnly={readOnly} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        wrap={wrap ? "soft" : "off"} aria-label={`Edit ${path || "text"}`} data-gramm="false"
        style={{ tabSize: indentN, paddingLeft: "calc(var(--ed-gut) + 12px)" }}
        onChange={(e) => { emit(e.target.value); position(); sync(); }}
        onKeyDown={onKeyDown} onScroll={sync} onSelect={position} onClick={position} onKeyUp={position} />
    </div>
    <div className="ed-status">
      <span className="ed-at">Ln {caret.line}, Col {caret.col}</span>
      {caret.selected > 0 && <span className="ed-at">{caret.selected} selected</span>}
      <span className="ed-sp" />
      <span className="ed-at">{lang.label}</span>
      <button type="button" className="ed-t" onClick={() => setWrap((w) => !w)} title={wrap ? "Soft wrap on" : "Soft wrap off"} aria-label="Toggle soft wrap"><WrapText /><span>{wrap ? "wrap" : "nowrap"}</span></button>
      <button type="button" className="ed-t" title="Indent width" aria-label="Indent width" onClick={cycleIndent}>
        <CornerDownLeft /><span>{tabs ? "tab" : `spaces: ${indentN}`}</span></button>
    </div>
  </div>;
});

/** A quote only pairs when it is being opened before nothing wordish. */
function shouldQuote(v: string, at: number, ch: string) {
  const prev = v[at - 1] || "", next = v[at] || "";
  if (/[A-Za-z0-9_$]/.test(prev)) return false;
  return next === "" || /[\s)\]}:,;]/.test(next);
}
