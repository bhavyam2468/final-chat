import type { Settings } from "./settings";
import { fastSearch, plainFetch, parallelSearch, parallelFetch } from "./search-fast";

/**
 * Web search and scrape engine.
 * DEFAULT: Fast, lightweight HTTP fetches and multi-engine metasearch (DuckDuckGo, Wikipedia, SearXNG).
 * Avoids spinning up heavy headless Chromium instances that consume gigabytes of RAM.
 * OPTIONAL: Firecrawl (local or cloud) can be toggled on in Settings when complex JS-heavy or anti-bot pages are required.
 */

function isAntiBotProtected(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("performing security verification") ||
    lower.includes("security service to protect against malicious bots") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("attention required! | cloudflare") ||
    lower.includes("checking your browser before accessing") ||
    lower.includes("just a moment...") ||
    lower.includes("enable javascript and cookies to continue") ||
    lower.includes("datadome")
  );
}

export async function firecrawlScrape(st: Settings, url: string) {
  // If user has not enabled Firecrawl (default), use fast direct HTTP fetch
  if (!st.useFirecrawl) {
    const plain = await plainFetch(url).catch(() => null);
    if (plain && plain.markdown.trim().length > 40 && !isAntiBotProtected(plain.markdown)) {
      return { data: { markdown: plain.markdown, metadata: { title: plain.title } }, _source: "fetch" };
    }
    // If blocked and cloud key is present, fall back to cloud Firecrawl
    if (st.firecrawlKey) {
      try {
        const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/scrape";
        const r = await fetch(cloudEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${st.firecrawlKey}`,
          },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
          signal: AbortSignal.timeout(20000),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return { ...j, _source: "cloud" };
      } catch {
        // fallback failed
      }
    }
    if (plain && plain.markdown.trim()) {
      return { data: { markdown: plain.markdown, metadata: { title: plain.title } }, _source: "fetch" };
    }
    throw new Error(`Scrape failed for ${url}: direct fetch was unable to read the page.`);
  }

  // Firecrawl mode enabled by user
  const direct = plainFetch(url);
  // 1. Try local Firecrawl
  if (st.firecrawlUrl) {
    try {
      const r = await fetch(st.firecrawlUrl.replace(/\/$/, "") + "/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const j = await r.json();
        const md = (j.data?.markdown as string) || "";
        if (!isAntiBotProtected(md) && md.trim().length > 80) {
          return { ...j, _source: "local" };
        }
      }
    } catch {
      // Local failed or timed out, fall back
    }
  }

  // 2. Direct fetch fallback
  const plain = await direct.catch(() => null);
  if (plain && plain.markdown.trim().length > 80 && !isAntiBotProtected(plain.markdown)) {
    return { data: { markdown: plain.markdown, metadata: { title: plain.title } }, _source: "fetch" };
  }

  // 3. Cloud Firecrawl
  if (st.firecrawlKey) {
    const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/scrape";
    const r = await fetch(cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${st.firecrawlKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ...j, _source: "cloud" };
    throw new Error(`Cloud Firecrawl scrape ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }

  if (plain && plain.markdown.trim()) return { data: { markdown: plain.markdown, metadata: { title: plain.title } }, _source: "fetch" };
  throw new Error("Scrape failed: direct fetch did not yield content and Firecrawl is unavailable.");
}

export async function firecrawlSearch(st: Settings, query: string, limit: number) {
  if (st.dev && st.provider === "mock") {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/dev/mock/v1/search`, { method: "POST", body: JSON.stringify({ query, limit }) });
    return { ...(await r.json()), _source: "mock" };
  }
  const n = Math.min(10, Math.max(1, limit || 5));

  // Default: fast HTTP multi-engine search (instant, zero memory footprint)
  if (!st.useFirecrawl) {
    const fast = await fastSearch(query, n, st.searxngUrl).catch(() => []);
    if (fast.length > 0) {
      return { data: fast.map((h) => ({ url: h.url, title: h.title, description: h.snippet || "", engine: h.engine })), _source: "fast" };
    }
  }

  // Firecrawl mode or fallback
  if (st.firecrawlUrl) {
    try {
      const r = await fetch(st.firecrawlUrl.replace(/\/$/, "") + "/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: n }),
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.data) && j.data.length > 0) {
          return { ...j, _source: "local" };
        }
      }
    } catch {
      // Local timed out or errored
    }
  }

  if (st.firecrawlKey) {
    const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/search";
    const r = await fetch(cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${st.firecrawlKey}`,
      },
      body: JSON.stringify({ query, limit: n }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.data) && j.data.length) return { ...j, _source: "cloud" };
  }

  // Final fast search fallback
  const fast = await fastSearch(query, n, st.searxngUrl).catch(() => []);
  if (fast.length) return { data: fast.map((h) => ({ url: h.url, title: h.title, description: h.snippet || "", engine: h.engine })), _source: "fast" };
  return { data: [], _source: "none" };
}

export async function firecrawlExtract(st: Settings, url: string, prompt: string) {
  if (!st.firecrawlKey) {
    throw new Error("Online Firecrawl API key is required for AI structured extraction.");
  }

  const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/scrape";
  const r = await fetch(cloudEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${st.firecrawlKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["extract"],
      extract: { prompt },
    }),
    signal: AbortSignal.timeout(35000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Firecrawl extract ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data?.extract || j.data || j;
}

export { parallelSearch, parallelFetch };
