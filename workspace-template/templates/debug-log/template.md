---
name: debug-log
kind: doc
title: Debug log
description: The shape of a bug investigation that ends with a regression test: symptom, reproduction, hypotheses with what killed each one, fix, and what is now watched.
tags: doc debugging bug log incident reproduce hypothesis fix regression
vars:
  - symptom | what is seen | Uploads stall at 99% on files over ~20 MB
---
# {{symptom}}

**Impact** — who hits it, how often, and whether there is a workaround. This line decides how much of the rest is worth doing right now.

**Reproduction** — the smallest reliable recipe: inputs, exact steps, and how often it happens when repeated. "Sometimes" is not a repro; say how many of ten runs.

**Evidence** — logs, timings, traces, the failing request as it actually went out. Quote raw output; paraphrase hides the clue.

**Hypotheses**
| Hypothesis | Test | Outcome |
|---|---|---|
| — | — | — |

Every hypothesis gets a test that could kill it. A hypothesis no test can kill is a guess, and guesses belong above the table, not in it.

**Root cause** — the mechanism, in one paragraph, stated so that someone who was not here could verify it.

**Fix** — what changed and why that removes the mechanism rather than the symptom. If the fix is a workaround, say what the real fix would be.

**Regression test** — the test that fails before the fix and passes after, named. Without it the bug comes back.

**Follow-ups** — what else the same mechanism could break, and what is now watched (metric, alert, check).
