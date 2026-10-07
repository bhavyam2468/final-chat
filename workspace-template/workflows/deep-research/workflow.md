---
name: deep-research
title: Deep research
description: Searches the web, opens the pages it finds, and writes a cited report. The searches and the extracts stay in the window; the chat gets the report.
inputs:
  - question | What should it look into? — a question, a claim to check, or a thing to compare
steps:
  - search limit=8            | Find sources
  - read limit=6 parallel=4   | Open the pages
  - agent expect=8            | Plan and write the report
---
# What this run is for

One question, answered from pages that were actually opened, with the receipts. The searches and the full text
of every page are already in this run's folder — read what you need from there and cite it. Nothing about the
process belongs in your answer: the person has the window for that.

## The report

- Lead with the answer in two or three sentences. No preamble, no "great question", no restating the question.
- Then the detail, sectioned by what the person would actually ask next. Prose first; a table when the material
  is genuinely tabular (versions, prices, specs, who-said-what); a short list only where a list is the honest
  shape.
- Every factual claim carries its source: `[n](url)` using the numbering in the sources list, and the date of
  the page when the claim can change (prices, versions, "current", "latest").
- Where the sources disagree, say so and say which one you would trust and why. Where they are silent, say what
  is not known instead of filling the gap. A confident-sounding invention is the worst possible output here.
- Numbers get units and a source. If you compute anything (a difference, a rate, a total), compute it with
  run_python and show the inputs, not just the result.
- If a page could not be opened, that is worth one line at the end — the reader should know which door stayed
  shut.

## Length

As long as the question deserves and no longer. A narrow question gets a tight answer; a broad one gets
sections. Ten good paragraphs beat three pages of padding, and a two-paragraph answer with four sources is a
perfect result for a small question.

## Saving it

Write the finished report to the run's artifacts file only if it is long enough that the person will want it
later (more than roughly 600 words); the app also saves a copy of your answer, so never write it twice.
