/**
 * Would this answer read better as blocks? The agent loop calls this once per turn: when the model
 * computed or gathered data and then wrote it out as prose or a markdown table, it gets one round to
 * present it properly. Pure content heuristic — no tool names, so it also catches a wall of text that
 * came from the model's own knowledge.
 */
const mdRows = (t: string) => (t.match(/^\s*\|.*\|\s*$/gm) || []).length;
const numberBullets = (t: string) => (t.match(/^\s*[*-]\s+.*[\d%$€£₹]/gm) || []).length;
const kvLines = (t: string) => (t.match(/^\s*[A-Za-z][\w .()/-]{0,30}:\s+\S+/gm) || []).length;

/** A chart was rendered to a file instead of shown: the user cannot read a path. */
export const renderedToFile = (t: string, usedPython: boolean) =>
  usedPython && /\.(png|svg|jpe?g)\b/i.test(t) && /(matplotlib|plot|chart|graph|figure)/i.test(t);

export function needsBlocks(text: string, opts: { usedPython?: boolean } = {}): boolean {
  const t = text || "";
  if (/<ui\b|<canvas\b/.test(t)) return false;         // already presented
  if (renderedToFile(t, !!opts.usedPython)) return true;
  if (mdRows(t) >= 6) return true;                      // a table the user should be able to sort
  if (numberBullets(t) >= 5) return true;               // five comparable figures in a list
  if (kvLines(t) >= 6) return true;                     // a spec sheet written as lines of text
  return false;
}
