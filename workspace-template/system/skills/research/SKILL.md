---
name: research
description: Answering a question from the web or papers — search craft, source quality, cross-checking, deep research, literature review, and testing a claim against counter-evidence.
---
Search craft (every turn that touches the web)
- web_search(query, limit ≤ 5) → title, url, snippet. web_fetch(url) → page markdown (~12k chars).
- Query = specific nouns + version/year ("vite 7 server.host config"), official names, exact error strings in quotes. No boolean operators.
- Source order: official docs / specs / repos > papers > reputable press > blogs and forums. Check dates; newest authoritative source wins for versions and APIs.
- A snippet is a lead, not evidence: web_fetch before relying on a detail. Cite inline [n](url) right after the claim; if sources disagree, say so and give the reason (date, definition, method).
- Budget: ≤3 searches and ≤2 fetches in a normal turn; after extracting facts, compact_context(scope="web"). Never invent a URL, quote or number.

Deep research (asked for research, a report, or "look into")
Use todo for the plan.
1. Frame in ≤5 lines: the exact question, scope (time, region, domain), what a good answer contains. Ask only when a wrong assumption would waste the whole effort (ask_user).
2. Decompose into 3-7 non-overlapping sub-questions, one of them the strongest counter-evidence.
3. Breadth: 1-2 varied queries per sub-question (primary terms, academic terms, news with year, critics). Pick sources by authority and date.
4. Depth: web_fetch the 4-10 best primary sources. Extract claims as: claim · number/date · source [n].
5. Cross-check: every key claim needs two independent sources or is marked single-source.
6. Hygiene: after each sub-question append findings to notes/research-<slug>.md, then compact_context(scope="web").
7. Synthesis: the direct answer first, then findings by sub-question, x-table for comparisons, confidence per key claim (high/medium/low + why).
8. Close with "Coverage & gaps": what was searched, what could not be verified, open conflicts, stale data, what evidence would change the conclusion. Never hide a gap to sound complete.
Budget 6-15 searches, 4-10 fetches; stop early when sources converge.

Then: many papers → reference/literature.md · a thesis to attack → reference/critique.md · a thesis of your own to test → formulate it, then critique.md.
