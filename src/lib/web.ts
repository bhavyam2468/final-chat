import type { Settings } from "./settings";
const deadline = (ms: number, signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

/** Firecrawl: local-first (zero credits), cloud fallback for anti-bot pages, search fallback and AI extraction. */
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

export async function firecrawlScrape(st: Settings, url: string, signal?: AbortSignal) {
  // 1. Try local Firecrawl first (no API key needed, zero credit cost)
  if (st.firecrawlUrl) {
    try {
      const r = await fetch(st.firecrawlUrl.replace(/\/$/, "") + "/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: deadline(15000, signal),
      });
      if (r.ok) {
        const j = await r.json();
        const md = (j.data?.markdown as string) || "";
        if (!isAntiBotProtected(md) && md.trim().length > 0) {
          return { ...j, _source: "local" };
        }
      }
    } catch {
      // Local failed or timed out, fall back to cloud
    }
  }

  signal?.throwIfAborted();
  // 2. Fallback to Cloud Firecrawl using API key (bypasses Cloudflare / anti-bot)
  if (st.firecrawlKey) {
    const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/scrape";
    const r = await fetch(cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${st.firecrawlKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: deadline(30000, signal),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ...j, _source: "cloud" };
    throw new Error(`Cloud Firecrawl scrape ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }

  throw new Error("Scrape failed: Local Firecrawl was blocked by anti-bot protection or failed, and no online Firecrawl API key is set for cloud bypass.");
}

export async function firecrawlSearch(st: Settings, query: string, limit: number, signal?: AbortSignal) {
  // developer mode + offline model: fake results from dev/mock-llm.mjs so search mode is testable without network
  if (st.dev && st.provider === "mock") {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/dev/mock/v1/search`, { method: "POST", body: JSON.stringify({ query, limit }), signal: deadline(10000, signal) });
    return { ...(await r.json()), _source: "mock" };
  }
  // 1. Attempt local Firecrawl search with a quick timeout
  if (st.firecrawlUrl) {
    try {
      const r = await fetch(st.firecrawlUrl.replace(/\/$/, "") + "/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit }),
        signal: deadline(3000, signal),
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

  signal?.throwIfAborted();
  // 2. Fallback to Cloud Firecrawl search using API key
  if (st.firecrawlKey) {
    const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/search";
    const r = await fetch(cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${st.firecrawlKey}`,
      },
      body: JSON.stringify({ query, limit }),
      signal: deadline(15000, signal),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ...j, _source: "cloud" };
    throw new Error(`Cloud Firecrawl search ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }

  throw new Error("Search failed: Local search timed out/failed and no online Firecrawl API key is set.");
}

export async function firecrawlExtract(st: Settings, url: string, prompt: string, signal?: AbortSignal) {
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
    signal: deadline(35000, signal),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Firecrawl extract ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data?.extract || j.data || j;
}
