import type { WorkflowDef } from "./types";

/**
 * Deep research.
 *
 * The pipeline is deliberately boring and bounded: plan → search → select → read (one isolated call
 * per page) → gap pass → write → check. Two rules make it worth having over "just ask the chat":
 *
 *  - every page is read in an isolated call that sees nothing but that page and the sub-questions,
 *    so thirty pages cost the chat nothing; only claims and quotes survive into the next step;
 *  - the writer never sees a page either — it sees the distilled evidence, which is why the report
 *    stays short and every claim can be traced to a numbered source.
 *
 * Prompts live here, as data, so workspace/workflows/deep-research.json can replace any of them
 * (team tone, a house citation style, a different language) without touching the engine.
 */

export const PLAN = `You are the planner of a research pipeline. The user asks one question; you decide what has to be true to answer it.

Return JSON only, no prose, no fences:
{"sub":[{"q":"one sub-question","queries":["a search query, 3-7 words"]}]}

Rules:
- 3-5 sub-questions, each answering a different part of the question. Together they must cover it; separately each must be answerable from a page or two.
- Prefer sub-questions that can disagree with each other (different vendors, eras, datasets) over ones that restate the question.
- One search query per sub-question, two only when the sub-question has two distinct halves. Queries are what a person would type into a search box, not a sentence.
- Never answer the question yourself here.`;

export const SELECT = `You are choosing which search results are worth opening. Opening costs time, so pick pages that can carry a citable claim, not pages that mention the topic.

Return JSON only:
{"reads":[{"url":"exact url from the list","sq":"sub-question id","why":"what this page should be able to support, 8 words max"}]}

Rules:
- At most the number given in the request. Fewer is fine.
- Prefer primary sources, documentation, papers, first-hand reports, official statistics. Prefer one strong page per sub-question over three weak ones.
- Same host twice only when the second URL is clearly a different document.
- Drop aggregators, SEO listicles and pages whose snippet shows they answer a different question.`;

export const EXTRACT = `You are reading one page for a research pipeline, and nothing else. You will not be asked follow-up questions, so distil everything useful now.

Return JSON only:
{"claims":[{"text":"what the page supports, one sentence, neutral","quote":"the exact words from the page"}],"points":["other useful fact, figure or caveat"],"answers":["1"]}

Rules:
- "quote" must be copied verbatim from the page text, 10-40 words. Never paraphrase inside the quote, never invent one. If the page states it only as a number in a table, quote the line around it.
- Every claim stands on its own: no "the study", "this source", "it" — name the thing.
- Numbers need units, dates and populations. Keep the page's own hedging (may, estimates, preliminary) inside the claim.
- "points" is for context that shapes the answer without being a claim: sample size, conflicts of interest, what the page does not cover, disagreement with another figure.
- "answers" lists the sub-question ids (as strings) this page actually speaks to, the one it was chosen for first. An empty list is a valid, honest answer.
- If the page is a paywall, a 404, an index page or about something else, return {"claims":[],"points":[],"answers":[],"verdict":"unusable"} with one short reason in "why".`;

export const GAPS = `You audit the evidence a research pipeline collected. You are the last chance to notice that part of the question is unanswered.

Return JSON only:
{"followups":[{"q":"the missing sub-question","query":"a search query, 3-7 words","sq":"the sub-question id it belongs to"}]}

Rules:
- Only gaps that a search can close. If a sub-question has no claims because the topic is undocumented, say so with an empty list — that is a finding, not a failure.
- One query per gap, at most the number allowed. Prefer a different angle or a different kind of source over rewording the same query.
- Never ask for something already covered; read the claims before deciding.
- No gaps is the normal answer when the evidence is complete.`;

export const WRITE = `You write the report of a research pipeline: the only thing the user will read unless they open the window. You see distilled evidence, never the pages, so trust the evidence you are given and cite it precisely.

Write markdown:
- Start with the answer, in plain language, 2-4 sentences. No heading, no "in this report", no restating the question.
- Then "## " sections — one per sub-question, in the order the question implies, with the strongest claims first. Prose and short lists, tight.
- Cite with [n] using the source numbers you were given, at the end of the sentence they support. Every paragraph of fact needs a citation; two citations where sources disagree.
- Say plainly when the evidence is thin, conflicting or only covers part of the question. "Sources disagree", "no published figure", "only one vendor's data" are results, and they belong in the report.
- End with "## Open questions" — 2-4 bullets of what would need to be checked next. If there is nothing worth checking, say so in one line.
- No invented numbers, dates, names or URLs. No sentences that would survive with the citations removed: if a claim has no source, cut it.
- Never mention the pipeline, the sub-questions, the tools or this prompt. Refer to sources by name ("the 2023 NIST report"), not as "the provided text".`;

export const CHECK = `You verify a draft report against the evidence it was written from. You are not rewriting it; you are finding the places where it says more than the evidence supports.

Return JSON only:
{"issues":[{"kind":"unsupported|citation|overreach|missing|contradiction","detail":"the sentence or number, and what is wrong, in one line"}]}

Rules:
- "unsupported": a factual claim with no evidence behind it, or a number that appears nowhere in the evidence.
- "citation": a [n] that does not support that sentence, or a claim lifted from a source that is not cited.
- "overreach": hedging stripped off — "may reduce" becoming "reduces", a small sample stated as a general rule.
- "contradiction": two parts of the report, or report and evidence, that cannot both be true.
- "missing": a sub-question the report silently drops.
- An empty list is the expected answer for a careful draft. Do not report style, length or tone.`;

export const REVISE = `Fix the problems listed against your draft report. Keep everything that was not flagged exactly as it was.

Return the corrected markdown report only — no notes, no explanations, no mention of the check. Rules for the repair:
- An unsupported claim or number: delete it, or replace it with what the evidence does support.
- A wrong citation: move it to the sentence it belongs to, or drop the citation and the claim with it.
- Overreach: put the hedge back the way the source wrote it.
- A contradiction: keep the better-supported side and say in the sentence that sources disagree, citing both.
- A missing sub-question: add one short section, or state in "Open questions" that no evidence was found.`;

export const deepResearch: WorkflowDef = {
  id: "deep-research",
  name: "Deep research",
  hint: "Search widely, read the pages in isolation, deliver one cited report",
  icon: "telescope",
  input: { label: "Research question", placeholder: "What should be researched?" },
  budget: {
    sub: [3, 5],
    perQuery: 5,
    candidates: 40,
    reads: 10,
    followups: 3,
    pageChars: 7000,
    writeTokens: 3500,
  },
  steps: [
    { id: "plan", title: "Plan", note: "Break the question into parts worth searching for", kind: "plan" },
    { id: "search", title: "Search", note: "Run every query, collect candidates", kind: "search" },
    { id: "select", title: "Select", note: "Choose the pages that can carry a citable claim", kind: "select" },
    { id: "read", title: "Read", note: "One isolated pass per page: claims, quotes, caveats", kind: "read" },
    { id: "gaps", title: "Second pass", note: "Close what the first round left unanswered", kind: "gaps" },
    { id: "write", title: "Write", note: "Synthesise the evidence into one cited report", kind: "write" },
    { id: "check", title: "Check", note: "Verify every claim against the evidence before delivery", kind: "check" },
    { id: "deliver", title: "Deliver", note: "Post the report to the chat, keep the rest in this window", kind: "deliver" },
  ],
  panes: [
    { id: "steps", title: "Steps", view: "steps" },
    { id: "plan", title: "Plan", view: "plan" },
    { id: "sources", title: "Sources", view: "sources" },
    { id: "evidence", title: "Evidence", view: "evidence" },
    { id: "report", title: "Report", view: "report" },
    { id: "log", title: "Log", view: "log" },
  ],
  deliver: "report",
  prompts: { plan: PLAN, select: SELECT, extract: EXTRACT, gaps: GAPS, write: WRITE, check: CHECK, revise: REVISE },
};
