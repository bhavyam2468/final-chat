import type { Settings } from "./settings";
import { fastSearch, plainFetch } from "./search-fast";

/**
 * Web routing is intentionally tiered:
 *
 *   discovery: local SearXNG -> keyless fallback -> optional Firecrawl
 *   reading:   direct HTTP + Mozilla Readability -> optional Firecrawl
 *
 * Firecrawl is kept as a supported escalation path, but it is opt-in. That
 * means a normal search or fetch never starts a local Firecrawl/Chromium stack.
 */

function isAntiBotProtected(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return [
    "performing security verification",
    "security service to protect against malicious bots",
    "cf-browser-verification",
    "attention required! | cloudflare",
    "checking your browser before accessing",
    "just a moment...",
    "enable javascript and cookies to continue",
    "datadome",
  ].some((x) => lower.includes(x));
}

const cleanBase = (value: string) => value.trim().replace(/\/$/, "");
const asText = (value: unknown) => typeof value === "string" ? value : "";

type SearchRow = { url?: string; title?: string; content?: string; description?: string };

/** Query the local SearXNG JSON API. JSON must be enabled in settings.yml. */
export async function searxngSearch(st: Settings, query: string, limit: number) {
  if (!st.searxngUrl.trim()) return [] as SearchRow[];
  const u = new URL(cleanBase(st.searxngUrl) + "/search");
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  u.searchParams.set("safesearch", "1");
  const r = await fetch(u, {
    signal: AbortSignal.timeout(3500),
    headers: { Accept: "application/json", "User-Agent": "MinimalistChat/1.0" },
  });
  if (!r.ok) return [];
  const j = await r.json() as { results?: SearchRow[] };
  return (j.results || []).filter((x) => /^https?:\/\//i.test(asText(x.url))).slice(0, limit);
}

async function firecrawlScrapeFallback(st: Settings, url: string) {
  if (!st.firecrawlEnabled) return null;
  // A local Firecrawl service is useful when the operator explicitly enabled
  // it, but it is never contacted on the ordinary path.
  if (st.firecrawlUrl) {
    try {
      const r = await fetch(cleanBase(st.firecrawlUrl) + "/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) {
        const j = await r.json();
        const md = asText(j.data?.markdown);
        if (md.trim().length > 80 && !isAntiBotProtected(md)) return { ...j, _source: "firecrawl-local" };
      }
    } catch { /* try the explicitly configured cloud fallback */ }
  }
  if (!st.firecrawlKey) return null;
  const endpoint = cleanBase(st.firecrawlCloudUrl || "https://api.firecrawl.dev") + "/v1/scrape";
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.firecrawlKey}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Firecrawl scrape ${r.status}: ${JSON.stringify(j).slice(0, 240)}`);
  return { ...j, _source: "firecrawl-cloud" };
}

/** Fetch a URL with the lightweight path first; Firecrawl is a deliberate escalation. */
export async function firecrawlScrape(st: Settings, url: string) {
  if (st.dev && st.provider === "mock") {
    // developer mode keeps a workflow runnable offline, like search already was
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/dev/mock/v1/fetch`, { method: "POST", body: JSON.stringify({ url }) });
    return { ...(await r.json()), _source: "mock" };
  }
  const plain = await plainFetch(url).catch(() => null);
  if (plain && plain.markdown.trim().length > 80 && !isAntiBotProtected(plain.markdown)) {
    return { data: { markdown: plain.markdown, metadata: { title: plain.title } }, _source: "http-readability" };
  }

  const escalated = await firecrawlScrapeFallback(st, url);
  if (escalated) return escalated;

  if (plain && plain.markdown.trim()) {
    return { data: { markdown: plain.markdown, metadata: { title: plain.title } }, _source: "http-readability-low-confidence" };
  }
  throw new Error(st.firecrawlEnabled
    ? "Fetch failed: the page did not return readable content and the optional Firecrawl fallback was unavailable."
    : "Fetch failed: the page did not return readable content. Enable Firecrawl fallback in Settings for JavaScript-heavy or anti-bot pages.");
}

function rowsToData(rows: SearchRow[]) {
  return rows.map((x) => ({ url: asText(x.url), title: asText(x.title) || asText(x.url), description: asText(x.content) || asText(x.description) }));
}

/**
 * Search discovery. SearXNG is tried first; the keyless adapters keep a fresh
 * install usable before Docker is configured. Firecrawl search is explicitly
 * opt-in and only runs after both lightweight paths return no results.
 */
export async function firecrawlSearch(st: Settings, query: string, limit: number) {
  if (st.dev && st.provider === "mock") {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/dev/mock/v1/search`, { method: "POST", body: JSON.stringify({ query, limit }) });
    return { ...(await r.json()), _source: "mock" };
  }
  const n = Math.min(10, Math.max(1, limit || 5));

  const local = await searxngSearch(st, query, n).catch(() => []);
  if (local.length) return { data: rowsToData(local), _source: "searxng" };

  const fast = await fastSearch(query, n).catch(() => []);
  if (fast.length) return { data: fast.map((x) => ({ url: x.url, title: x.title, description: x.snippet || "" })), _source: "keyless" };

  if (st.firecrawlEnabled && st.firecrawlUrl) {
    try {
      const r = await fetch(cleanBase(st.firecrawlUrl) + "/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: n }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.data) && j.data.length) return { ...j, _source: "firecrawl-local" };
      }
    } catch { /* optional cloud fallback below */ }
  }
  if (st.firecrawlEnabled && st.firecrawlKey) {
    const r = await fetch(cleanBase(st.firecrawlCloudUrl || "https://api.firecrawl.dev") + "/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.firecrawlKey}` },
      body: JSON.stringify({ query, limit: n }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.data) && j.data.length) return { ...j, _source: "firecrawl-cloud" };
  }
  return { data: [], _source: "none" };
}

export async function firecrawlExtract(st: Settings, url: string, prompt: string) {
  if (!st.firecrawlEnabled || !st.firecrawlKey) {
    throw new Error("Enable Firecrawl fallback in Settings and provide an online Firecrawl key for structured extraction.");
  }
  const endpoint = cleanBase(st.firecrawlCloudUrl || "https://api.firecrawl.dev") + "/v1/scrape";
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.firecrawlKey}` },
    body: JSON.stringify({ url, formats: ["extract"], extract: { prompt } }),
    signal: AbortSignal.timeout(35000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Firecrawl extract ${r.status}: ${JSON.stringify(j).slice(0, 240)}`);
  return j.data?.extract || j.data || j;
}
