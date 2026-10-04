---
name: research
description: Deep research: plan sub-questions, broad then deep search, primary sources, cross-checking, cited synthesis with an explicit coverage & gaps section.
---
Goal: an answer the user can rely on, plus an honest map of what is not known. Use todo for the plan.
1. Frame (≤5 lines, show the user): the exact question, scope (time, region, domain), what a good answer contains. Ask only if a wrong assumption would waste the whole effort (ask_user).
2. Decompose into 3-7 non-overlapping sub-questions. Include one "strongest counter-evidence" sub-question.
3. Breadth: 1-2 varied queries per sub-question (official/primary terms, academic terms, recent news with year, critics/limitations). Triage snippets for relevance, authority, date, and primary-source status; deduplicate URLs and syndicated copies before fetching. Do not scrape every search hit.
4. Depth: inspect the 4-10 best sources (prefer official docs, datasets, papers, filings, standards). Batch independent pages with web_fetch_many(urls≤8); use web_fetch for a single page. Direct HTTP is preferred; if it is blocked, the configured optional fallback may be used. For papers use the MCP papers server if enabled. Extract claims as: claim · number/date · source [n].
5. Cross-check: every key claim needs 2 genuinely independent sources, not duplicate reporting, or is marked single-source. Record conflicts with the reason (date, definition, method). Prefer the newest authoritative figure and say so.
6. Context hygiene: keep intermediate findings in the research run and tool history; do not write raw research into ordinary notes unless the user asks. The app retains inspectable run details outside future chat context, and sends only the final report into later turns. Compact context only if actually needed.
7. Synthesis: direct answer first; then findings by sub-question with inline citations [n](url); tables for comparisons; confidence per key claim (high/medium/low + why).
8. End with "Coverage & gaps": what was searched, what could not be verified, open conflicts, stale data, what evidence would change the conclusion. Never hide a gap to sound complete.
Budget: 6-15 searches, 4-10 fetches; stop early when sources converge. Literature-heavy → also skill literature-review; testing a thesis → skill hypothesis-testing.
