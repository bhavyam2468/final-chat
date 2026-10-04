/** High-speed, low-memory local search and fetching engine.
 * Avoids spinning up heavy headless Chromium instances for standard queries.
 * Supports SearXNG, DuckDuckGo, Wikipedia, direct GitHub raw fetching, and clean HTML readability extraction.
 */

export type Hit = { url: string; title: string; snippet: string; engine?: string };

const strip = (s: string) => s
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
  .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

/** Converts GitHub blob/tree URLs to raw URLs for instant, zero-DOM text fetching */
export function normalizeFetchUrl(rawUrl: string): string {
  const gh = rawUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (gh) {
    return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}/${gh[4]}`;
  }
  return rawUrl;
}

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
    out.push({ url, title, snippet: sn ? strip(sn[1]).slice(0, 240) : "", engine: "duckduckgo" });
  }
  return out;
}

/** Fast, clean HTML to Markdown converter preserving structure, headings, code, and tables. */
export function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Extract main article container if available
  const mainMatch = clean.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  if (mainMatch && mainMatch[1].length > 400) {
    clean = mainMatch[1];
  }

  // Preserve headings
  clean = clean.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
  clean = clean.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
  clean = clean.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
  clean = clean.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n\n#### $1\n\n");

  // Code blocks & inline code
  clean = clean.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  clean = clean.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Lists
  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");

  // Paragraphs and breaks
  clean = clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n");
  clean = clean.replace(/<br\s*\/?>/gi, "\n");

  // Tables
  clean = clean.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, " | $1");
  clean = clean.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, " | $1");
  clean = clean.replace(/<\/tr>/gi, " |\n");

  // Strip remaining tags
  const body = strip(clean).replace(/\n{3,}/g, "\n\n").slice(0, 25000);
  return (title ? `# ${strip(title)}\n\n` : "") + body;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** SearXNG local metasearch if configured / available */
async function searxng(query: string, limit: number, searxngUrl?: string): Promise<Hit[]> {
  const base = searxngUrl || process.env.SEARXNG_URL || "http://localhost:8080";
  try {
    const u = `${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&language=auto`;
    const r = await fetch(u, { signal: AbortSignal.timeout(3000), headers: { Accept: "application/json", "User-Agent": UA } });
    if (!r.ok) return [];
    const j = (await r.json()) as { results?: { url: string; title: string; content?: string; engine?: string }[] };
    return (j.results || []).slice(0, limit).map((x) => ({
      url: x.url,
      title: strip(x.title || x.url),
      snippet: strip(x.content || "").slice(0, 240),
      engine: x.engine || "searxng",
    }));
  } catch {
    return [];
  }
}

async function ddg(query: string, limit: number): Promise<Hit[]> {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const r = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) return [];
  return parseDdgHtml(await r.text(), limit);
}

async function wiki(query: string, limit: number): Promise<Hit[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=${limit}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(2200), headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return [];
  const j = (await r.json()) as { query?: { search?: { title: string; snippet: string }[] } };
  return (j.query?.search || []).map((s) => ({
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(s.title.replace(/ /g, "_")),
    title: s.title,
    snippet: strip(s.snippet || "").slice(0, 240),
    engine: "wikipedia",
  }));
}

async function instant(query: string): Promise<Hit[]> {
  const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const r = await fetch(u, { signal: AbortSignal.timeout(2000), headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const j = (await r.json()) as { AbstractText?: string; AbstractURL?: string; Heading?: string; RelatedTopics?: { Text?: string; FirstURL?: string }[] };
  const out: Hit[] = [];
  if (j.AbstractURL && j.AbstractText) out.push({ url: j.AbstractURL, title: j.Heading || j.AbstractURL, snippet: j.AbstractText.slice(0, 240), engine: "duckduckgo" });
  for (const t of j.RelatedTopics || []) {
    if (t.FirstURL && t.Text) out.push({ url: t.FirstURL, title: t.Text.split(" - ")[0].slice(0, 120), snippet: t.Text.slice(0, 240), engine: "duckduckgo" });
    if (out.length >= 5) break;
  }
  return out;
}

/** Best-effort multi-engine search in ~200-500ms without spinning up Chromium */
export async function fastSearch(query: string, limit: number, searxngUrl?: string): Promise<Hit[]> {
  const n = Math.min(8, Math.max(1, limit));
  // If SearXNG is configured, try it first
  if (searxngUrl || process.env.SEARXNG_URL) {
    const sx = await searxng(query, n, searxngUrl);
    if (sx.length >= 2) return sx;
  }

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

/** Parallel search for multiple queries */
export async function parallelSearch(queries: string[], limitPerQuery = 4, searxngUrl?: string): Promise<Record<string, Hit[]>> {
  const results = await Promise.all(
    queries.map(async (q) => {
      const hits = await fastSearch(q, limitPerQuery, searxngUrl).catch(() => []);
      return [q, hits] as const;
    })
  );
  return Object.fromEntries(results);
}

/** Direct HTTP page fetch: super-fast (~150ms), lightweight text extraction */
export async function plainFetch(rawUrl: string): Promise<{ markdown: string; title: string } | null> {
  const url = normalizeFetchUrl(rawUrl);
  const r = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) return null;
  const type = r.headers.get("content-type") || "";
  const raw = await r.text();

  if (type.includes("json")) {
    try {
      const j = JSON.parse(raw);
      return { markdown: "```json\n" + JSON.stringify(j, null, 2).slice(0, 20000) + "\n```", title: url };
    } catch {
      return { markdown: raw.slice(0, 20000), title: url };
    }
  }

  if (type.includes("html") || /<html[\s>]/i.test(raw.slice(0, 500))) {
    const title = strip(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || url;
    return { markdown: htmlToText(raw), title };
  }
  return { markdown: raw.slice(0, 25000), title: url };
}

/** Parallel fetching for multiple URLs */
export async function parallelFetch(urls: string[]): Promise<Record<string, { markdown: string; title: string } | null>> {
  const results = await Promise.all(
    urls.map(async (u) => {
      const res = await plainFetch(u).catch(() => null);
      return [u, res] as const;
    })
  );
  return Object.fromEntries(results);
}
