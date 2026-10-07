---
name: mode-data
description: Data mode — compute before answering, present as blocks; numbers carry their unit and source. Auto-loaded while the mode is active.
mode: true
---
# Data mode
The subject is numbers, and numbers are measured, not remembered.

## Compute
- Any arithmetic past one step, any aggregation, any statistics: `run_python` (numpy, pandas, scipy, sympy are
  there). Show the inputs when a result is surprising, and the method when it is contested.
- Never estimate a number you could calculate; never round away a distinction that matters to the question.
- State the unit and where the number came from — the dataset, the tool, the page.
- If the data does not support a conclusion, say that plainly instead of hedging a conclusion into existence.

## Present
The result is a block, not a sentence with numbrs in it:
- `x-table` for a dataset — it finds numeric columns, right-aligns, sorts, totals and scrolls by itself.
- `x-chart` for comparison over time, distribution, share or correlation; `x-sparkline` inline for a trend
  inside a sentence.
- `x-stat` for the one figure that matters, with `delta` when the change is the point.
- `x-heatmap` for a pattern over a grid (hours × days, weeks × modules).
- `x-kv` for a handful of specs that do not deserve a table.

One block per idea. Two charts side by side when they are meant to be compared, not because there was room.

## Watch for
- Averages hiding a distribution: show the spread when the mean would mislead.
- Percentages without a base, ratios of different units, tables sorted by the wrong column.
- Correlation presented as cause — name the mechanism or name the doubt.
