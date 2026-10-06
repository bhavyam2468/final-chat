/**
 * Lightweight, keyless web primitives.
 *
 * Search and extraction are deliberately separate. SearXNG (in web.ts) discovers
 * URLs; this module only handles the small fallback search adapters and the
 * ordinary HTTP -> established readability pipeline. No browser is started here.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export type Hit = { url: string; title: string; snippet: string };

const decode = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const strip = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

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
    const after = html.slice(m.index, m.index + 1000);
    const sn = after.match(/class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]*>([\s\S]*?)<\//i);
    out.push({ url, title, snippet: sn ? strip(sn[1]).slice(0, 240) : "" });
  }
  return out;
}

const UA = "Mozilla/5.0 (compatible; MinimalistChat/1.0; +https://github.com/bhavyam2468/final-chat)";
const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

/**
 * Convert a fetched HTML document with Mozilla's Reader View algorithm, not a
 * home-grown tag stripper. Removing obvious chrome before Readability keeps
 * cookie banners, navigation and embeds out of the model context.
 */
export function htmlToText(html: string): string {
  // Remove executable/style payloads before parsing as well as from the DOM. Some
  // lightweight DOM implementations leave detached script text in Readability's
  // fallback content for fragment-shaped HTML.
  const safeHtml = html.replace(/<(script|style|noscript|template|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const { document } = parseHTML(safeHtml);
  document.querySelectorAll("script,style,noscript,template,svg,canvas,iframe,nav,header,footer,aside,form").forEach((node) => node.remove());
  const parsed = new Readability(document).parse();
  const title = strip(parsed?.title || document.title || "");
  const body = parsed?.content || document.body?.innerHTML || safeHtml;
  const cleaned = markdown.turndown(body)
    // Keep headings, lists, links and code readable to the model, but do not let
    // presentation markers turn ordinary prose into `Hello **there**` text.
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return `${title ? `# ${title}\n\n` : ""}${cleaned}`.slice(0, 20000);
}

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
  return (j.query?.search || []).map((x) => ({
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(x.title.replace(/ /g, "_")),
    title: x.title,
    snippet: strip(x.snippet || "").slice(0, 240),
  }));
}

async function instant(query: string): Promise<Hit[]> {
  const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const r = await fetch(u, { signal: AbortSignal.timeout(1800), headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const j = await r.json() as { AbstractText?: string; AbstractURL?: string; Heading?: string; RelatedTopics?: { Text?: string; FirstURL?: string }[] };
  const out: Hit[] = [];
  if (j.AbstractURL && j.AbstractText) out.push({ url: j.AbstractURL, title: j.Heading || j.AbstractURL, snippet: j.AbstractText.slice(0, 240) });
  for (const x of j.RelatedTopics || []) {
    if (x.FirstURL && x.Text) out.push({ url: x.FirstURL, title: x.Text.split(" - ")[0].slice(0, 120), snippet: x.Text.slice(0, 240) });
    if (out.length >= 5) break;
  }
  return out;
}

/** Keyless fallback when an install has no SearXNG instance. */
export async function fastSearch(query: string, limit: number): Promise<Hit[]> {
  const n = Math.min(8, Math.max(1, limit));
  const settled = await Promise.allSettled([ddg(query, n), wiki(query, Math.min(3, n)), instant(query)]);
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const hit of result.value) {
      if (!hit.url || seen.has(hit.url)) continue;
      seen.add(hit.url);
      out.push(hit);
      if (out.length >= n) return out;
    }
  }
  return out;
}

/**
 * Fetch a page without a browser. Readability is intentionally conservative:
 * callers can escalate when the returned article is too short or looks blocked.
 */
export async function plainFetch(url: string): Promise<{ markdown: string; title: string } | null> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(7000),
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain,application/json" },
  });
  if (!r.ok) return null;
  const type = r.headers.get("content-type") || "";
  const raw = await r.text();
  if (type.includes("html") || /<html[\s>]/i.test(raw.slice(0, 500))) {
    const markdownText = htmlToText(raw);
    const title = markdownText.match(/^#\s+(.+)$/m)?.[1] || url;
    return { markdown: markdownText, title };
  }
  return { markdown: raw.slice(0, 20000), title: url };
}
