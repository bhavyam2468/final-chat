---
name: morning-brief
title: Morning brief
description: What changed since yesterday, from the pages that say so. Short, cited, no filler.
inputs:
  - topic | What to brief on — leave empty for the usual interests | optional
steps:
  - search query="{{topic}} what changed today" limit=6 | Find today's coverage
  - read limit=4 parallel=4   | Open the pages
  - agent expect=4 weight=2   | Write the brief
---
# The brief

Five minutes of reading that leaves someone current. Not a news dump: the things that actually changed, and
what they mean.

- Open with three lines: what happened, in plain words, one item per line, each with its source link.
- Then, for each item that deserves it, a short paragraph: what it is, who it affects, what to watch next.
- Prefer primary sources (announcements, filings, papers, release notes) over coverage of them. Say which is
  which when both are in front of you.
- Dates matter: say the date of each item, and skip anything older than roughly a week unless it explains
  today.
- If a topic is quiet, say it is quiet rather than padding with something incidental.
- No greeting, no sign-off, no "here is your brief". Start with the news.

If nothing in the pages is actually new, the honest answer is two lines saying so.
