import type { Settings } from "./settings";
import { fastSearch, plainFetch } from "./search-fast";

/** Fast direct HTTP and keyless search are preferred. Firecrawl stays available as an explicit local/cloud fallback for pages that need it. */

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
  // Direct HTTP first: public docs and ordinary pages should not wait for a browser-backed scraper.
  const plain = await plainFetch(url).catch(() => null);
  if (plain && plain.markdown.trim().length > 80 && !isAntiBotProtected(plain.markdown)) {
    return { data: { markdown: plain.markdown, metadata: { title: plain.title } }, _source: "fetch" };
  }

  // Local Firecrawl is opt-in and used only when direct retrieval is empty or blocked.
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
        if (!isAntiBotProtected(md) && md.trim().length > 80) return { ...j, _source: "local" };
      }
    } catch {
      // Local scraper failed or timed out; continue to the cloud fallback only if configured.
    }
  }

  // Cloud Firecrawl is a last resort for anti-bot pages and requires an explicit API key.
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
  throw new Error("Scrape failed: the page didn't answer, local Firecrawl isn't up, and no online Firecrawl API key is set.");
}

export async function firecrawlSearch(st: Settings, query: string, limit: number) {
  // developer mode + offline model: fake results from dev/mock-llm.mjs so search mode is testable without network
  if (st.dev && st.provider === "mock") {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/dev/mock/v1/search`, { method: "POST", body: JSON.stringify({ query, limit }) });
    return { ...(await r.json()), _source: "mock" };
  }
  const n = Math.min(10, Math.max(1, limit || 5));
  // Keyless results in ~2.5s. Return them immediately when we have a real set, so a downed local scraper can't stall search mode.
  const fast = await fastSearch(query, n).catch(() => []);
  if (fast.length >= 2) {
    return { data: fast.map((h) => ({ url: h.url, title: h.title, description: h.snippet || "" })), _source: "fast" };
  }
  // Local Firecrawl, quick timeout.
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

  if (fast.length) return { data: fast.map((h) => ({ url: h.url, title: h.title, description: h.snippet || "" })), _source: "fast" };
  return { data: [], _source: "none" };
}

export async function firecrawlExtract(st: Settings, url: string, prompt: string) {
  // Local Firecrawl does not support AI extraction (requires LLM). Always routes to Cloud with API key.
  if (!st.firecrawlKey) {
    throw new Error("Online Firecrawl API key is required for AI structured extraction (local Firecrawl lacks an AI extraction engine).");
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
