/**
 * Ranking and slicing for memory retrieval (kept free of I/O so it can be tested and reasoned about).
 * Shared words carry the match; a gentle recency term breaks ties toward newer notes.
 */
export type Rankable = { id: string; text: string; at: string };

/**
 * Content words, lightly stemmed: "theme/themes", "edit/editing", "note/notes" are the same word, or a
 * question almost never recalls the note it should. Only words longer than four letters are cut, so
 * short words that merely end in s (gas, bus) stay intact.
 */
export const stem = (w: string) => {
  if (w.length <= 4) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(ches|shes|xes|zes|ses)$/.test(w)) return w.slice(0, -2);
  if (/ing$/.test(w)) return w.length > 6 ? w.slice(0, -3) : w;
  if (/ed$/.test(w)) return w.length > 5 ? w.slice(0, -2) : w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
};
export const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).map(stem));
export const norm = (s: string) => s.toLowerCase().replace(/\W+/g, " ").trim();
export const when = (at: string) => (/^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : "");

export const day = 86_400_000;
export function relevance(e: Rankable, q: Set<string>, now: number) {
  const hits = [...words(e.text)].filter((w) => q.has(w)).length;
  if (!hits) return 0;
  const age = Number.isFinite(Date.parse(e.at)) ? Math.max(0, now - Date.parse(e.at)) / day : 365;
  return hits + 0.5 / (1 + age / 60);
}

/** Best notes for a query: no duplicates, most recent wins ties, at most `limit`. */
export function pickNotes<T extends Rankable>(eps: T[], query: string, now = Date.now(), limit = 4): T[] {
  const q = words(query);
  const seen = new Set<string>();
  return eps
    .map((e) => ({ e, s: relevance(e, q, now) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (Date.parse(b.e.at) || 0) - (Date.parse(a.e.at) || 0))
    .filter((x) => { const k = norm(x.e.text); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit)
    .map((x) => x.e);
}

/** Cut on a line boundary, so a slice never leaves half a fact behind. */
export function sliceLines(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  return (nl > max * 0.6 ? cut.slice(0, nl) : cut).trimEnd();
}

/** Lines shipped in the template that are instructions, not memories. */
const PLACEHOLDER = /^(Stable facts the user asked to remember\.|Durable facts about the user and their preferences\.)/;

/** The profile body without its heading and without the template's own explanation line. */
export function profileBody(profile: string) {
  return profile.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() && !/^#\s/.test(l) && !PLACEHOLDER.test(l.trim())).join("\n").trim();
}
