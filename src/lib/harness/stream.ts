/**
 * Output hygiene for streamed model text. Pure functions, no imports (unit-tested in dev/tests/guards.test.ts).
 * Each guard targets a documented failure of small, distilled or free-tier models:
 *  - ReasoningSplitter: <think>/<thinking> blocks (DeepSeek-R1 distills, Qwen3, QwQ) leak into the answer and
 *    get re-sent every turn. Also handles the orphan "</think>" when the chat template opened the tag itself.
 *  - OpenerGate / trimCloser: sycophantic filler ("Great question!", "I hope this helps!").
 *  - findLoop: degenerate repetition (R1-Zero/QwQ "endless repetition"); lets the agent cut the stream.
 *  - extractTextCalls: tool calls printed as text (JSON, <tool_call>, <function=…>, Gemini tool_code).
 *  - foreignSpans: CJK intrusion in non-CJK replies (median span ~2 chars in quantized distills).
 *  - unverifiedUrls: cited links that never appeared in a search result, fetched page or user message.
 */

// ---------------------------------------------------------------- reasoning
const OPEN = /<(think|thinking|reasoning)>/i;
const CLOSE = /<\/(think|thinking|reasoning)>/i;
const TAGS = ["<think>", "</think>", "<thinking>", "</thinking>", "<reasoning>", "</reasoning>"];

/** retract: text emitted in earlier chunks of this step that turned out to be reasoning (orphan closer). */
export type Split = { text: string; reasoning: string; orphan?: boolean; retract?: string; reasoningEnd?: boolean };

export class ReasoningSplitter {
  private inside = false;
  private hold = "";
  private started = false; // any visible text yet in this step
  private emitted = "";
  push(d: string): Split {
    let s = this.hold + d;
    this.hold = "";
    let text = "", reasoning = "", orphan = false, retract = "", reasoningEnd = false;
    // hold a trailing partial tag ("<thi") until the next chunk decides it
    const lt = s.lastIndexOf("<");
    if (lt >= 0 && lt > s.length - 13 && !s.slice(lt).includes(">") && TAGS.some((t) => t.startsWith(s.slice(lt).toLowerCase()))) { this.hold = s.slice(lt); s = s.slice(0, lt); }
    while (s) {
      if (this.inside) {
        const m = CLOSE.exec(s);
        if (!m) { reasoning += s; break; }
        reasoning += s.slice(0, m.index);
        s = s.slice(m.index + m[0].length).replace(/^\s+/, "");
        this.inside = false;
        reasoningEnd = true;
      } else {
        const o = OPEN.exec(s), c = CLOSE.exec(s);
        if (c && (!o || c.index < o.index)) {
          // "</think>" without an opener: the template opened it; everything so far in this step was reasoning
          if (!orphan) { retract = this.emitted; this.emitted = ""; }
          reasoning = retract + reasoning + text + s.slice(0, c.index);
          text = "";
          s = s.slice(c.index + c[0].length).replace(/^\s+/, "");
          orphan = true; reasoningEnd = true; this.started = false;
          continue;
        }
        if (!o) { text += s; break; }
        text += s.slice(0, o.index);
        s = s.slice(o.index + o[0].length);
        this.inside = true;
      }
    }
    if (!this.started && text) { text = text.replace(/^\s+/, ""); if (text) this.started = true; }
    this.emitted += text;
    return { text, reasoning, ...(orphan ? { orphan, retract } : {}), ...(reasoningEnd ? { reasoningEnd: true } : {}) };
  }
  end(): Split { const h = this.hold; this.hold = ""; return this.inside ? { text: "", reasoning: h } : { text: h, reasoning: "" }; }
}

/**
 * Parse whatever complete (or currently streamed) fields are available in a JSON object.
 * Tool-call arguments often arrive as several SSE deltas, so a normal JSON.parse hides every
 * argument until the final brace. This exposes decoded string prefixes without ever rendering
 * the raw JSON to users. Incomplete nested objects/arrays are intentionally omitted.
 */
export function parsePartialJsonObject(source: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(source);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { /* streamed prefix */ }

  const out: Record<string, unknown> = {};
  let i = 0;
  const skip = () => { while (/\s/.test(source[i] || "")) i++; };
  const stringAt = (): { value: string; closed: boolean } | null => {
    if (source[i] !== '"') return null;
    const start = ++i;
    let j = start;
    for (; j < source.length; j++) {
      if (source[j] === "\\") { j++; continue; }
      if (source[j] === '"') {
        const raw = source.slice(start, j);
        i = j + 1;
        try { return { value: JSON.parse(`"${raw}"`) as string, closed: true }; }
        catch { return { value: raw, closed: true }; }
      }
    }
    let raw = source.slice(start);
    raw = raw.replace(/\\u[\da-f]{0,3}$/i, "").replace(/\\$/, "");
    i = source.length;
    try { return { value: JSON.parse(`"${raw}"`) as string, closed: false }; }
    catch { return { value: raw.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\(["\\/])/g, "$1"), closed: false }; }
  };
  const valueAt = (): { value: unknown; complete: boolean } | null => {
    skip();
    if (source[i] === '"') { const s = stringAt(); return s && { value: s.value, complete: s.closed }; }
    if (source[i] === "{" || source[i] === "[") {
      const start = i;
      const stack: string[] = [];
      let quoted = false, escaped = false;
      for (; i < source.length; i++) {
        const ch = source[i];
        if (quoted) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; continue; }
        if (ch === '"') quoted = true;
        else if (ch === "{") stack.push("}");
        else if (ch === "[") stack.push("]");
        else if ((ch === "}" || ch === "]") && stack.at(-1) === ch) {
          stack.pop();
          if (!stack.length) { i++; try { return { value: JSON.parse(source.slice(start, i)), complete: true }; } catch { return null; } }
        }
      }
      i = source.length;
      return null;
    }
    const start = i;
    while (i < source.length && source[i] !== "," && source[i] !== "}") i++;
    const raw = source.slice(start, i).trim();
    if (!raw) return null;
    try { return { value: JSON.parse(raw), complete: true }; } catch { return null; }
  };

  skip();
  if (source[i] !== "{") return out;
  i++;
  while (i < source.length) {
    skip();
    if (source[i] === ",") { i++; continue; }
    if (source[i] === "}" || i >= source.length) break;
    const key = stringAt();
    if (!key?.closed) break;
    skip();
    if (source[i] !== ":") break;
    i++;
    const value = valueAt();
    if (!value) break;
    out[key.value] = value.value;
    if (!value.complete) break;
    skip();
    if (source[i] !== ",") break;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- filler
const OPENER = /^(?:(?:what an? |that'?s an? |such an? )?(?:great|good|excellent|fantastic|interesting|wonderful|insightful) question[!.]?\s*|i'?d be (?:happy|glad|delighted) to help(?: you)?(?: with (?:that|this))?[!.]\s*|(?:certainly|absolutely|of course|sure(?: thing)?|great|okay|alright)[!,.]\s+(?=(?:here(?:'s| is| are)|let'?s|below)\b))/i;

/** Holds the first sentence of a reply until it can decide whether it is pure filler, then drops it. */
export class OpenerGate {
  private buf = "";
  private done = false;
  push(text: string): string {
    if (this.done) return text;
    this.buf += text;
    const b = this.buf.replace(/^\s+/, "");
    const boundary = /[.!?](\s|$)|\n/.exec(b);
    if (!boundary && b.length < 160) return "";
    return this.flush();
  }
  flush(): string {
    if (this.done) return "";
    this.done = true;
    const b = this.buf.replace(/^\s+/, "");
    this.buf = "";
    const m = OPENER.exec(b);
    if (!m) return b;
    const rest = b.slice(m[0].length);
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest;
  }
}

const CLOSER = /^(?:i hope (?:this|that|it) helps|hope (?:this|that) helps|let me know if (?:you|there)|feel free to (?:ask|reach out|let me know)|if you have any (?:other |more |further )?questions|happy (?:coding|learning|studying)|is there anything else|don'?t hesitate to)/i;
/** Drops a trailing filler paragraph ("Let me know if you have any other questions!"). */
export function trimCloser(text: string): string {
  const m = /\n\s*\n([^\n]+)\s*$/.exec(text);
  const last = m ? m[1].trim() : "";
  if (m && last.length < 220 && CLOSER.test(last.replace(/^[*_>\s]+/, ""))) return text.slice(0, m.index).replace(/\s+$/, "");
  return text;
}

// ---------------------------------------------------------------- repetition
/**
 * Detects degenerate repetition at the end of `text`. Returns the index where the redundant copies start
 * (keep text.slice(0, i)), or -1. Short units must repeat more often; units need letters (ignores "----" rules).
 */
export function findLoop(text: string): number {
  const t = text.slice(-2400);
  const off = text.length - t.length;
  for (let L = 8; L <= 400 && L * 3 <= t.length; L++) {
    const unit = t.slice(-L);
    if (!/[a-z\u00c0-\uffff]{3}/i.test(unit)) continue;
    const need = L < 40 ? 6 : L < 120 ? 4 : 3;
    if (L * need > t.length) continue;
    let k = 1;
    while (k < need && t.slice(t.length - L * (k + 1), t.length - L * k) === unit) k++;
    if (k >= need) {
      let start = t.length - L * k;
      while (start - L >= 0 && t.slice(start - L, start) === unit) start -= L;
      // keep the first copy, cut at a sentence/line end inside it (the unit may be phase-shifted mid-word)
      const first = t.slice(start, start + L);
      const b = Math.max(first.lastIndexOf(". "), first.lastIndexOf("! "), first.lastIndexOf("? "), first.lastIndexOf("\n"));
      return off + start + (b >= 0 ? b + 1 : L);
    }
  }
  // identical non-trivial lines repeated back to back (catches loops with variable whitespace)
  const lines = t.split("\n");
  let run = 1;
  for (let i = lines.length - 1; i > 0; i--) {
    const a = lines[i].trim(), b = lines[i - 1].trim();
    if (!a) continue;
    if (a === b && a.length > 12 && /[a-z]{3}/i.test(a)) { run++; if (run >= 4) { const keep = t.lastIndexOf(lines[i - 1] + "\n" + lines[i]); return keep < 0 ? -1 : off + keep + lines[i - 1].length; } }
    else break;
  }
  return -1;
}

// ---------------------------------------------------------------- tool calls printed as text
export type TextCall = { name: string; args: Record<string, unknown> };

function balanced(s: string, from: number): string | null {
  let depth = 0, str: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue; }
    if (c === '"') str = c;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(from, i + 1); }
  }
  return null;
}
function pyArgs(s: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const re = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|True|False|None|\[[^\]]*\])\s*(?:,|$)/g;
  let m, seen = 0;
  while ((m = re.exec(s))) {
    const v = m[2];
    seen += m[0].length;
    if (/^["']/.test(v)) out[m[1]] = v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\(["'\\])/g, "$1");
    else if (v === "True" || v === "False") out[m[1]] = v === "True";
    else if (v === "None") out[m[1]] = null;
    else if (v.startsWith("[")) { try { out[m[1]] = JSON.parse(v.replace(/'/g, '"')); } catch { out[m[1]] = v; } }
    else out[m[1]] = Number(v);
  }
  return seen >= s.replace(/\s/g, "").length * 0.6 || !s.trim() ? out : null;
}

/**
 * Finds tool calls the model wrote as text instead of using the API. Only names in `names` count.
 * Returns the calls and the text with those spans removed.
 */
export function extractTextCalls(text: string, names: Set<string>): { calls: TextCall[]; cleaned: string } {
  const calls: TextCall[] = [];
  const cut: [number, number][] = [];
  const take = (a: number, b: number, name: string, args: unknown) => {
    if (!names.has(name) || cut.some(([x, y]) => a < y && b > x)) return;
    calls.push({ name, args: args && typeof args === "object" ? (args as Record<string, unknown>) : {} }); cut.push([a, b]);
  };
  // <tool_call>{json}</tool_call>  (Hermes / Qwen)
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) { try { const j = JSON.parse(m[1]); take(m.index!, m.index! + m[0].length, j.name, j.arguments ?? j.parameters ?? j.args); } catch {} }
  // <function=name><parameter=k>v</parameter></function>  (Qwen3-coder XML) and <function=name>{json}</function>
  for (const m of text.matchAll(/<function=([\w.-]+)>([\s\S]*?)<\/function>/g)) {
    const body = m[2].trim(); let args: Record<string, unknown> = {};
    if (body.startsWith("{")) { try { args = JSON.parse(body); } catch {} }
    else for (const p of body.matchAll(/<parameter=(\w+)>\s*([\s\S]*?)\s*<\/parameter>/g)) args[p[1]] = /^-?\d+(\.\d+)?$/.test(p[2]) ? Number(p[2]) : p[2];
    take(m.index!, m.index! + m[0].length, m[1], args);
  }
  // Gemini: ```tool_code print(default_api.fn(a="b")) ```  or bare default_api.fn(...)
  for (const m of text.matchAll(/(?:```(?:tool_code|python)?\s*\n?)?(?:print\()?default_api\.(\w+)\(([\s\S]*?)\)\)?\s*(?:\n?```)?/g)) { const a = pyArgs(m[2]); if (a) take(m.index!, m.index! + m[0].length, m[1], a); }
  // {"name": "...", "arguments": {...}} as JSON (optionally fenced)
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    if (!/^\{\s*"(name|tool|function)"\s*:/.test(text.slice(i, i + 40))) continue;
    const obj = balanced(text, i);
    if (!obj) continue;
    try {
      const j = JSON.parse(obj);
      const name = j.name ?? j.tool ?? j.function?.name ?? j.function;
      let args = j.arguments ?? j.parameters ?? j.args ?? j.input ?? j.function?.arguments;
      if (typeof args === "string") { try { args = JSON.parse(args); } catch {} }
      if (typeof name === "string") {
        const fence = /```(?:json)?\s*$/.exec(text.slice(Math.max(0, i - 12), i));
        const a = fence ? i - (text.slice(Math.max(0, i - 12), i).length - fence.index) : i;
        const endFence = /^\s*```/.exec(text.slice(i + obj.length));
        take(a, i + obj.length + (endFence && fence ? endFence[0].length : 0), name, args);
      }
    } catch {}
  }
  if (!calls.length) return { calls, cleaned: text };
  let cleaned = text;
  for (const [a, b] of cut.sort((x, y) => y[0] - x[0])) cleaned = cleaned.slice(0, a) + cleaned.slice(b);
  return { calls, cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trim() };
}

// ---------------------------------------------------------------- language intrusion
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
const CJK_RUN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u3000-\u303f\uff01-\uff5e]+/g;
const FULLWIDTH: Record<string, string> = { "，": ", ", "。": ". ", "：": ": ", "；": "; ", "！": "! ", "？": "? ", "（": " (", "）": ") ", "、": ", ", "“": '"', "”": '"', "‘": "'", "’": "'", "《": '"', "》": '"', "【": "[", "】": "]" };

const stripCode = (t: string) => t.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length)).replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));

/** CJK runs in a reply whose conversation is not in a CJK language. Empty when the user writes CJK. */
export function foreignSpans(reply: string, userText: string): { span: string; index: number; context: string }[] {
  if (CJK.test(userText)) return [];
  const t = stripCode(reply);
  const out: { span: string; index: number; context: string }[] = [];
  for (const m of t.matchAll(CJK_RUN)) {
    if (out.length >= 24) break;
    out.push({ span: m[0], index: m.index!, context: reply.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40) });
  }
  return out;
}
/** Punctuation-only spans are fixed without a model call. */
export const fixPunct = (span: string) => (/^[\u3000-\u303f\uff01-\uff5e]+$/.test(span) ? span.split("").map((c) => FULLWIDTH[c] ?? (c.charCodeAt(0) >= 0xff01 && c.charCodeAt(0) <= 0xff5e ? String.fromCharCode(c.charCodeAt(0) - 0xfee0) : " ")).join("").replace(/\s+$/, " ") : null);

/** Replace spans right-to-left so indices stay valid. */
export function replaceSpans(text: string, spans: { span: string; index: number }[], repl: string[]): string {
  let out = text;
  spans.map((s, i) => ({ ...s, r: repl[i] })).sort((a, b) => b.index - a.index).forEach((s) => {
    if (out.slice(s.index, s.index + s.span.length) !== s.span || typeof s.r !== "string") return;
    const before = out.slice(0, s.index), after = out.slice(s.index + s.span.length);
    let r = s.r.trim();
    if (/^[\p{L}\p{N}(]/u.test(r) && /[\p{L}\p{N})]$/u.test(before)) r = " " + r;
    if (/[\p{L}\p{N})\],.;:!?]$/u.test(r) && /^[\p{L}\p{N}(]/u.test(after)) r += " ";
    out = before + r + after;
  });
  return out;
}

// ---------------------------------------------------------------- citations
export function normUrl(u: string): string {
  try {
    const x = new URL(u.trim().replace(/[).,;:!?'"\]>]+$/, ""));
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref$|fbclid|gclid|source$)/.test(k)) x.searchParams.delete(k);
    const q = x.searchParams.toString();
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + (q ? "?" + q : "")).toLowerCase();
  } catch { return u.toLowerCase(); }
}
export const urlsIn = (text: string) => [...new Set([...stripCode(text).matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)].map((m) => m[0].replace(/[).,;:!?'"\]>]+$/, "")))];

/**
 * Links in the reply that never appeared in anything the model actually saw this conversation
 * (tool results, fetched pages, user messages). Bare domains count as seen when the host was seen.
 */
export function unverifiedUrls(reply: string, seenText: string): string[] {
  const seen = new Set(urlsIn(seenText).map(normUrl));
  const hosts = new Set([...seen].map((u) => u.split("/")[0]));
  return urlsIn(reply).filter((u) => {
    const n = normUrl(u);
    if (seen.has(n)) return false;
    const [host, ...rest] = n.split("/");
    if (!rest.join("/") && hosts.has(host)) return false;
    return !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(n);
  });
}
