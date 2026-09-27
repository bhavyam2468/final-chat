/** Keyless, short-timeout search used before Firecrawl. Search home should feel like a search box, not a research job. */

export type Hit = { url: string; title: string; snippet: string };

const strip = (s: string) => s
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

/** DuckDuckGo wraps outbound links as /l/?uddg=<encoded>. */
export function decodeHref(href: string): string {
  const raw = href.replace(/&amp;/g, "&");
  try {
    const abs = raw.startsWith("//") ? "https:" + raw : raw;
    const url = new URL(abs, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg && /^https?:/i.test(uddg)) return uddg;
  } catch { /* keep raw */ }
  if (raw.startsWith("//")) return "https:" + raw;
  return raw;
}

/** Pull organic results out of DuckDuckGo HTML or lite HTML. */
export function parseDdgHtml(html: string, limit: number): Hit[] {
  const out: Hit[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const attrs = m[1];
    if (!/(?:result__a|result-link)\b/.test(attrs)) continue;
    const href = attrs.match(/\bhref="([^"]+)"/i)?.[1];
    if (!href) continue;
    const url = decodeHref(href);
    if (!/^https?:/i.test(url) || seen.has(url) || /duckduckgo\.com/i.test(url)) continue;
    seen.add(url);
    const title = strip(m[2]).slice(0, 180) || url;
    const after = html.slice(m.index, m.index + 900);
    const sn = after.match(/class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]*>([\s\S]*?)<\//i);
    out.push({ url, title, snippet: sn ? strip(sn[1]).slice(0, 240) : "" });
  }
  return out;
}

export function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n");
  const text = strip(body).replace(/ ([.?!]) /g, "$1 ").slice(0, 20000);
  return (title ? title.replace(/\s+/g, " ").trim() + "\n\n" : "") + text;
}

const UA = "Mozilla/5.0 (compatible; MinimalistChat/1.0; +https://github.com/bhavyam2468/final-chat)";

async function ddg(query: string, limit: number): Promise<Hit[]> {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const r = await fetch(url, { signal: AbortSignal.timeout(2500), headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) return [];
  return parseDdgHtml(await r.text(), limit);
}

async function wiki(query: string, limit: number): Promise<Hit[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=${limit}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(2200), headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return [];
  const j = await r.json() as { query?: { search?: { title: string; snippet: string }[] } };
  return (j.query?.search || []).map((s) => ({
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(s.title.replace(/ /g, "_")),
    title: s.title,
    snippet: strip(s.snippet || "").slice(0, 240),
  }));
}

async function instant(query: string): Promise<Hit[]> {
  const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const r = await fetch(u, { signal: AbortSignal.timeout(1800), headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const j = await r.json() as { AbstractText?: string; AbstractURL?: string; Heading?: string; RelatedTopics?: { Text?: string; FirstURL?: string }[] };
  const out: Hit[] = [];
  if (j.AbstractURL && j.AbstractText) out.push({ url: j.AbstractURL, title: j.Heading || j.AbstractURL, snippet: j.AbstractText.slice(0, 240) });
  for (const t of j.RelatedTopics || []) {
    if (t.FirstURL && t.Text) out.push({ url: t.FirstURL, title: t.Text.split(" - ")[0].slice(0, 120), snippet: t.Text.slice(0, 240) });
    if (out.length >= 5) break;
  }
  return out;
}

/** Best-effort results in about 2.5s. Empty array on total failure — caller falls back to Firecrawl. */
export async function fastSearch(query: string, limit: number): Promise<Hit[]> {
  const n = Math.min(8, Math.max(1, limit));
  const settled = await Promise.allSettled([ddg(query, n), wiki(query, Math.min(3, n)), instant(query)]);
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const h of s.value) {
      if (!h.url || seen.has(h.url)) continue;
      seen.add(h.url);
      out.push(h);
      if (out.length >= n) return out;
    }
  }
  return out;
}

/** Direct page fetch, used in parallel with Firecrawl so a dead local scraper doesn't stall the answer. */
export async function plainFetch(url: string): Promise<{ markdown: string; title: string } | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain" } });
  if (!r.ok) return null;
  const type = r.headers.get("content-type") || "";
  const raw = await r.text();
  if (type.includes("html") || /<html[\s>]/i.test(raw.slice(0, 500))) {
    const title = strip(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || url;
    return { markdown: htmlToText(raw), title };
  }
  return { markdown: raw.slice(0, 20000), title: url };
}
