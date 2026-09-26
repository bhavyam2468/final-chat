/**
 * remend: make a partial (streaming) markdown string renderable by
 * optimistically closing unterminated syntax. Highlight (==) is the exception:
 * an unclosed opener is hidden rather than closed, so the highlight animates
 * only after the model finishes it.
 */
export function remend(src: string): string {
  let text = src;
  const fences = (text.match(/^\s{0,3}(```|~~~)/gm) || []).length;
  if (fences % 2 === 1) return text.replace(/\n?`{1,2}$/, "") + "\n```";

  // hide a dangling partial tag or fence start at the tail
  text = text.replace(/<\/?[a-zA-Z-]*$/, "").replace(/\n`{1,2}$/, "\n");

  const lastBreak = text.lastIndexOf("\n\n");
  const head = text.slice(0, lastBreak + 1);
  let tail = text.slice(lastBreak + 1);

  // inline code first: inside it nothing else matters
  const ticks = (tail.match(/(?<!`)`(?!`)/g) || []).length;
  if (ticks % 2 === 1) return head + tail + "`";

  // highlight: hide unclosed opener
  const marks = [...tail.matchAll(/==/g)];
  if (marks.length % 2 === 1) { const i = marks[marks.length - 1].index!; tail = tail.slice(0, i) + tail.slice(i + 2); }

  const closers: string[] = [];
  if ((tail.match(/\$\$/g) || []).length % 2 === 1) closers.push("$$");
  else if ((tail.replace(/\$\$/g, "").match(/(?<![\\\w])\$/g) || []).length % 2 === 1 && !/\$\s*$/.test(tail)) closers.push("$");
  if ((tail.match(/~~/g) || []).length % 2 === 1) closers.push("~~");
  const bold = (tail.match(/\*\*/g) || []).length;
  const single = (tail.replace(/\*\*/g, "").replace(/^\s*\*\s/gm, "").match(/\*/g) || []).length;
  if (single % 2 === 1) closers.push("*");
  if (bold % 2 === 1) closers.push("**");
  const ub = (tail.match(/(?<!\w)__|__(?!\w)/g) || []).length;
  if (ub % 2 === 1) closers.push("__");

  // unclosed link url
  if (/\[[^\]]*\]\([^)]*$/.test(tail)) tail = tail.replace(/\[([^\]]*)\]\([^)]*$/, "[$1](#)");
  // trailing empty emphasis markers look broken; drop them
  tail = tail.replace(/(\*\*|\*|~~|__)$/, (m) => { const i = closers.lastIndexOf(m); if (i >= 0) { closers.splice(i, 1); return ""; } return m; });
  return head + tail + closers.reverse().join("");
}

export type Segment =
  | { kind: "md"; text: string }
  | { kind: "ui" | "canvas" | "details"; attrs: Record<string, string>; body: string; closed: boolean; raw: string };

const OPEN = /<(ui|canvas|details)(\s[^>]*)?>/g;

function attrsOf(s = "") {
  const out: Record<string, string> = {};
  // key="v" | key='v' | key=v | bare boolean key (dock, open)
  for (const m of s.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

/** Split into markdown and custom XML segments (outside code fences). */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(text))) {
    const before = text.slice(0, m.index);
    if ((before.match(/^\s{0,3}```/gm) || []).length % 2 === 1) continue;
    if (m.index > pos) out.push({ kind: "md", text: text.slice(pos, m.index) });
    const tag = m[1] as "ui";
    const start = m.index + m[0].length;
    // find matching close accounting for nesting
    const re = new RegExp(`<(/?)${tag}(\\s[^>]*)?>`, "g");
    re.lastIndex = start;
    let depth = 1, end = -1, closeLen = 0, x: RegExpExecArray | null;
    while ((x = re.exec(text))) { depth += x[1] ? -1 : 1; if (!depth) { end = x.index; closeLen = x[0].length; break; } }
    const body = text.slice(start, end < 0 ? undefined : end);
    out.push({ kind: tag, attrs: attrsOf(m[2]), body, closed: end >= 0, raw: text.slice(m.index, end < 0 ? undefined : end + closeLen) });
    if (end < 0) { pos = text.length; break; }
    pos = end + closeLen;
    OPEN.lastIndex = pos;
  }
  if (pos < text.length) out.push({ kind: "md", text: text.slice(pos) });
  return out;
}
