/**
 * Search/replace edit engine (Claude Code / Aider style, hardened for small models).
 *
 * Cascade per edit, first unique hit wins:
 *   1. exact            2. CRLF-normalised      3. trailing-whitespace-insensitive
 *   4. indentation-insensitive (replacement is re-indented by the same delta)
 * Line-number prefixes copied from fs_read output ("12\t…") are stripped first.
 * Fuzzy near-misses are never applied: the closest region is returned so the model can copy it exactly.
 * Replacements containing elision placeholders ("... rest of code ...") are rejected.
 * All edits of one call are applied in memory and written only if every edit succeeds.
 */

export type Edit = { find: string; replace: string; all?: boolean };
export type EditResult = { ok: true; text: string; changed: [number, number][]; notes: string[] } | { ok: false; error: string };

const NUMBERED = /^\s*\d+\t/;
export function stripNumbers(s: string) {
  const ls = s.split("\n");
  const nonEmpty = ls.filter((l) => l.trim());
  return nonEmpty.length && nonEmpty.every((l) => NUMBERED.test(l)) ? ls.map((l) => l.replace(NUMBERED, "")).join("\n") : s;
}

const PLACEHOLDER = /(^|\n)\s*(\/\/|#|\/\*|<!--|--|;)?\s*(\.\.\.|…)\s*(rest of|existing|unchanged|remaining|previous|same as|other|more)\b[^\n]*|(^|\n)\s*(\/\/|#|\/\*|<!--)\s*(rest of (the )?(code|file|function|implementation)|existing code|unchanged code|keep (the )?(rest|existing))[^\n]*/i;
export const hasPlaceholder = (replace: string, find: string) => PLACEHOLDER.test(replace) && !PLACEHOLDER.test(find);

const lineStarts = (text: string) => { const s = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") s.push(i + 1); return s; };
const lineAt = (starts: number[], idx: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= idx) lo = m; else hi = m - 1; } return lo + 1; };

function allIndexes(hay: string, needle: string) {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

type Hit = { start: number; end: number; replace: string; how: string };

/** Line-window matching with a per-line normaliser. Returns char ranges of matching windows. */
function lineMatches(text: string, find: string, norm: (l: string) => string) {
  const T = text.split("\n"), F = find.replace(/\n+$/, "").split("\n");
  while (F.length && !F[0].trim()) F.shift();
  if (!F.length) return [] as { a: number; b: number }[];
  const nf = F.map(norm), out: { a: number; b: number }[] = [];
  for (let i = 0; i + F.length <= T.length; i++) {
    let ok = true;
    for (let j = 0; j < F.length && ok; j++) ok = norm(T[i + j]) === nf[j];
    if (ok) { out.push({ a: i, b: i + F.length }); i += F.length - 1; }
  }
  return out;
}
const indentOf = (l: string) => l.match(/^[ \t]*/)![0];

function locate(text: string, e: Edit): { hits: Hit[]; near?: string } {
  const find = stripNumbers(e.find), repl = e.replace;
  // 1-2 exact / CRLF
  for (const [f, how] of [[find, "exact"], [find.replace(/\r\n/g, "\n"), "newline-normalised"]] as const) {
    const idx = allIndexes(text, f);
    if (idx.length) return { hits: idx.map((i) => ({ start: i, end: i + f.length, replace: repl, how })) };
  }
  const T = text.split("\n"), starts = lineStarts(text);
  const rangeOf = (a: number, b: number) => ({ start: starts[a], end: b < T.length ? starts[b] - 1 : text.length });
  // 3 trailing whitespace
  let m = lineMatches(text, find, (l) => l.replace(/\s+$/, ""));
  if (m.length) return { hits: m.map(({ a, b }) => ({ ...rangeOf(a, b), replace: repl.replace(/\n+$/, ""), how: "ignoring trailing spaces" })) };
  // 4 indentation: match trimmed lines, shift replacement by the indent delta of the first line
  m = lineMatches(text, find, (l) => l.trim());
  if (m.length) {
    const F = find.split("\n").filter((l) => l.trim());
    const fi = indentOf(F[0]);
    return {
      hits: m.map(({ a, b }) => {
        const ti = indentOf(T[a]);
        const shifted = repl.replace(/\n+$/, "").split("\n").map((l) => (!l.trim() ? l : l.startsWith(fi) ? ti + l.slice(fi.length) : ti + l.trimStart())).join("\n");
        return { ...rangeOf(a, b), replace: shifted, how: "re-indented" };
      }),
    };
  }
  return { hits: [], near: nearest(T, find) };
}

/** Best window by line similarity, shown numbered so the model can copy it verbatim. */
function nearest(T: string[], find: string) {
  const F = find.replace(/\n+$/, "").split("\n").map((l) => l.trim());
  if (!F.length || T.length > 20000) return undefined;
  const sim = (a: string, b: string) => { if (a === b) return 1; if (!a || !b) return 0; const A = new Set(a.split(/\W+/)), B = b.split(/\W+/); return B.filter((w) => A.has(w)).length / Math.max(A.size, B.length); };
  let best = -1, at = 0;
  for (let i = 0; i + F.length <= T.length; i++) {
    let s = 0;
    for (let j = 0; j < F.length; j++) s += sim(F[j], T[i + j].trim());
    if (s > best) { best = s; at = i; }
  }
  if (best / F.length < 0.5) return undefined;
  const a = Math.max(0, at - 1), b = Math.min(T.length, at + F.length + 1);
  return T.slice(a, b).map((l, k) => `${a + k + 1}\t${l}`).join("\n");
}

export function applyEdits(src: string, edits: Edit[]): EditResult {
  if (!edits.length) return { ok: false, error: "no edits given" };
  let text = src;
  const notes: string[] = [], spans: [number, number][] = [];
  for (let k = 0; k < edits.length; k++) {
    const e = edits[k], tag = edits.length > 1 ? `edit ${k + 1}: ` : "";
    if (typeof e.find !== "string" || typeof e.replace !== "string") return { ok: false, error: tag + "find and replace must be strings" };
    if (!e.find) {
      if (!text.trim()) { text = e.replace; spans.push([1, e.replace.split("\n").length]); continue; }
      return { ok: false, error: tag + "empty find on a non-empty file; use fs_insert to add lines" };
    }
    if (e.find === e.replace) return { ok: false, error: tag + "find and replace are identical" };
    if (hasPlaceholder(e.replace, e.find)) return { ok: false, error: tag + "replace contains an elision placeholder (\"... rest of code\"). Write the complete replacement text; unchanged code outside find stays as is." };
    const { hits, near } = locate(text, e);
    if (!hits.length) return { ok: false, error: tag + "find text not found." + (near ? ` Closest region (copy exact text, without the line numbers):\n${near}` : " fs_read the file and copy the lines exactly.") };
    const starts = lineStarts(text);
    if (hits.length > 1 && !e.all) return { ok: false, error: `${tag}find matches ${hits.length} places (lines ${hits.slice(0, 8).map((h) => lineAt(starts, h.start)).join(", ")}). Include more surrounding lines to make it unique, or set all=true.` };
    if (hits[0].how !== "exact") notes.push(`${tag}matched ${hits[0].how}`);
    let out = "", last = 0;
    const use = e.all ? hits : hits.slice(0, 1);
    for (const h of use) { out += text.slice(last, h.start) + h.replace; last = h.end; }
    // track changed line spans in the new text
    let delta = 0;
    for (const h of use) {
      const startLine = lineAt(lineStarts(out), h.start + delta);
      spans.push([startLine, startLine + Math.max(0, h.replace.split("\n").length - 1)]);
      delta += h.replace.length - (h.end - h.start);
    }
    text = out + text.slice(last);
  }
  return { ok: true, text, changed: spans, notes };
}

/** Insert text after line `after` (0 = top of file, -1 or > length = end). */
export function insertLines(src: string, after: number, add: string) {
  const L = src.length ? src.split("\n") : [];
  const trailingNl = src.endsWith("\n");
  if (trailingNl) L.pop();
  const at = after < 0 || after > L.length ? L.length : after;
  const ins = add.replace(/\n$/, "").split("\n");
  L.splice(at, 0, ...ins);
  return { text: L.join("\n") + (trailingNl || !src.length ? "\n" : ""), span: [at + 1, at + ins.length] as [number, number] };
}

/** Numbered excerpt around changed spans (merged, 3 lines of context, capped). */
export function snippet(text: string, spans: [number, number][], ctx = 3, cap = 60) {
  const L = text.split("\n");
  const ranges = spans.map(([a, b]) => [Math.max(1, a - ctx), Math.min(L.length, b + ctx)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  const out: string[] = []; let n = 0;
  for (const [a, b] of merged) {
    if (out.length) out.push("…");
    for (let i = a; i <= b && n < cap; i++, n++) out.push(`${i}\t${L[i - 1]}`);
    if (n >= cap) { out.push(`… (${L.length} lines total)`); break; }
  }
  return out.join("\n");
}
