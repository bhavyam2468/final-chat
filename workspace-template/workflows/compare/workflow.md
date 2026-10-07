---
name: compare
title: Compare options
description: Researches a few options and puts them side by side, with the trade-offs spelled out.
inputs:
  - question | What should be compared? — e.g. "Postgres vs SQLite for a local app", or a list of options
steps:
  - search limit=8            | Find sources for each option
  - read limit=6 parallel=4   | Open the pages
  - agent expect=8            | Build the comparison
---
# A comparison someone can decide with

- One table is the core of the answer: one row per option, one column per criterion, and only criteria that
  actually differ in a way that matters. Numbers with units and a source; unknown cells say "not published"
  rather than being left blank to guess at.
- Above the table: the one or two differences that decide it for most people, in plain sentences.
- Below it: who should pick which, and what would change your mind. The trade-off is the answer — if the
  options are genuinely equal, say what makes them equal and what each one costs later.
- Name the situations where the comparison does not apply. A recommendation without its conditions is a
  guess wearing a table.
- Cite every factual claim (`[n](url)` against the sources list) with the date for anything that moves.
