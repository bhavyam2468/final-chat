---
name: research
description: Deep research: plan sub-questions, broad then deep search, primary sources, cross-checking, cited synthesis with an explicit coverage & gaps section.
---
Goal: an answer the user can rely on, plus an honest map of what is not known. Use todo for the plan.
1. Frame (≤5 lines, show the user): the exact question, scope (time, region, domain), what a good answer contains. Ask only if a wrong assumption would waste the whole effort (ask_user).
2. Decompose into 3-7 non-overlapping sub-questions. Include one "strongest counter-evidence" sub-question.
3. Breadth: 1-2 varied queries per sub-question (official/primary terms, academic terms, recent news with year, critics/limitations). Skim snippets; pick sources by authority and date.
4. Depth: web_fetch the 4-10 best primary sources (official docs, datasets, papers, filings, standards). For papers use the MCP papers server if enabled. Extract claims as: claim · number/date · source [n].
5. Cross-check: every key claim needs 2 independent sources or is marked single-source. Record conflicts with the reason (date, definition, method). Prefer the newest authoritative figure and say so.
6. Context hygiene: after each sub-question, write findings to notes/research-<slug>.md (append), then compact_context(scope="web").
7. Synthesis: direct answer first; then findings by sub-question with inline citations [n](url); tables for comparisons; confidence per key claim (high/medium/low + why).
8. End with "Coverage & gaps": what was searched, what could not be verified, open conflicts, stale data, what evidence would change the conclusion. Never hide a gap to sound complete.
Budget: 6-15 searches, 4-10 fetches; stop early when sources converge. Literature-heavy → also skill literature-review; testing a thesis → skill hypothesis-testing.
