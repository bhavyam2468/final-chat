# The workflow file

`workflows/<name>/workflow.md` — front matter for the shape, the rest for the brief. `ui.html` beside it is
optional: a Blocks document that presents the run (it receives the run record as data). Without one the window
uses its own process view — steps, sources, the log, the report — which is what most workflows should have.

```markdown
---
name: deep-research
title: Deep research
description: Searches the web, opens the pages it finds, and writes a cited report.
inputs:
  - question | What should it look into? — a question, a claim to check, or a thing to compare
steps:
  - search limit=8            | Find sources
  - read limit=6 parallel=4   | Open the pages
  - agent expect=8            | Plan and write the report
---
# What this run is for

One question, answered from pages that were actually opened, with the receipts. ...
```

The front matter is deliberately one line per thing — no nesting, no YAML you have to be careful with. The
parser (`parseWorkflow`) refuses anything else with a sentence naming the file and the problem, so a bad file
fails at save time, not at 3am mid-run.

- `name` — one word (`\w` and `-`), the folder name. `title` and `description` are what the user sees in
  `/workflows`. All three are optional except the practical need for a name; the folder name is the fallback.
- `inputs:` — `- name | the question the user is asked | optional`. The name is one word, the middle is the
  label shown in the composer, `| optional` makes it not required. Most workflows want exactly one input.
  `{{name}}` anywhere in the file (steps and body) is replaced with what the user typed.
- `steps:` — `- kind option=value option=value | What this step is called in the window`. Steps run top to
  bottom; the title is the label in the window, and the kind is one of the three below.
- `#` comments and blank lines in the front matter are ignored.

## Step kinds

| kind | what the app does | options |
| --- | --- | --- |
| `search` | runs web search through the same path as `web_search` (the user's settings are honoured) and keeps the results as sources | `query=` one or more queries, `;` separated (default: the first input) · `limit=` results per query, max 10 |
| `read` | fetches and extracts each source, in small parallel batches, saving each page to `.workflows/<id>/pages/NN.md` with an index in `sources.md` | `limit=` pages to open, max 20 · `parallel=` pages at once, max 6 |
| `agent` | the one step that thinks: its own conversation (`wf-<id>`), the run's pages and the brief, tools allowed by the chat's mode, then the report | `expect=` tool calls to expect, for the progress bar |

Rules the parser enforces: at least one step; one `agent` step at most; the `agent` step last (the steps before
it gather material for it). A step cannot be a kind that does not exist — the error lists the known kinds.

## What the agent step receives

The file's body, this run's inputs, the list of steps already done, and every source: the pages that were opened
(as `.workflows/<id>/pages/NN.md`, to be read with `fs_read` and cited) plus the ones that could not be opened
(so it can say a door stayed shut instead of inventing a source). It works in a hidden conversation and cannot
see the chat — anything the report needs must be in the body or in that material.

## What happens at the end

The report is saved to `chats/<chat>/artifacts/<slug>.md` and put into the chat as the message that carried the
card. `.workflows/<id>.json` is the full record (steps, sources, log, report) and the window polls it; when a
workflow ships `ui.html`, the window renders that instead, with the run as its data.

## Worth stealing

- **Compare** — inputs: `question`; steps: `search query={{question}} price; {{question}} review limit=5`, `read
  limit=8`, `agent expect=10`. Body: a table of option, price, source, date; say which is cheapest and which
  the reviews prefer; flag anything you could not confirm.
- **Digest** — inputs: `topic | What should the digest cover?`; steps: `search query={{topic}} limit=10`,
  `read limit=8 parallel=4`, `agent expect=8`. Body: five items, one line each, newest first, each with a link;
  nothing older than a week unless it is still being discussed; end with what changed since the last digest if
  any of the run's pages say.
- **Check a claim** — inputs: `claim | What should I check?`; steps: `search query={{claim}} evidence; {{claim}}
  debunked limit=5`, `read limit=8`, `agent expect=10`. Body: verdict first (true / false / it depends, one
  line), then the strongest evidence on each side, then what would change the verdict.
