/** Search signatures come from the same contract used by the runtime and validator. */
import schema from "../../../public/blocks/schema.js";
export type Comp = { tag: string; tags: string; usage: string };
export const CATALOG: Comp[] = Object.entries({ ...schema.registry, ...schema.guides }).map(([tag, spec]) => ({ tag, tags: spec.tags, usage: spec.usage }));
export function searchCatalog(q: string, n = 6) {
  const words = q.toLowerCase().split(/\W+/).filter(Boolean);
  const seen = new Set<string>();
  return CATALOG.map((c) => ({ c, score: words.reduce((sum, w) => sum + (c.tags.includes(w) ? 2 : 0) + (c.tag.includes(w) ? 3 : 0), 0) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
    .filter(({ c }) => { if (seen.has(c.usage)) return false; seen.add(c.usage); return true; })
    .slice(0, Math.max(1, Math.min(12, n))).map(({ c }) => `${c.tag}: ${c.usage}`).join("\n") || "No match. See skill blocks for the full list.";
}
