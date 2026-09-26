---
name: web
description: Web search and page fetching via Firecrawl; query craft, source quality, citation. Deep research → skill research.
---
- web_search(query, limit≤5) → title, url, snippet. web_fetch(url) → page markdown (~12k chars).
- Queries: specific nouns + version/year ("vite 7 config server.host"), official site names ("site:docs.python.org"), exact error strings in quotes.
- Source order: official docs/specs/repos > papers > reputable press > blogs/forums. Check dates; prefer the newest authoritative source for versions and APIs.
- Snippets are leads, not evidence: web_fetch before relying on a detail.
- Budget per normal turn: ≤3 searches, ≤2 fetches. After extracting facts, compact_context(scope="web").
- Cite inline [n](url) right after the claim. If sources disagree, say so.
