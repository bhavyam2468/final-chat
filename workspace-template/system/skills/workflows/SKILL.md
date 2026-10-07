---
name: workflows
description: Saving a procedure the user will run again as a workflow (deep research, digests, recurring reports, pipelines) — the file format, real progress, and briefs that produce a report.
---
# Workflows

A workflow is a named procedure **the app performs**, not a long prompt you follow: it lives in
`workflows/<name>/workflow.md`, it runs in the background in the order the file declares, and it has a window that
shows what it is doing. The point is that the parts that should be facts — search this, open the top six pages,
count the sources — are done by the app instead of asked of you, and that the process never enters the chat. The
chat receives the report and nothing else.

Reach for one when the user will want the same *shape* of work again: "keep an eye on X", "every release, write
the notes from the changelog", "compare the price of Y across these shops", "summarise the mailing list each
Monday". Do the work in the chat when it is a one-off — a workflow for a single question is slower and leaves a
file behind that nobody will run again.

## Running one
`start_workflow(name, input)` returns immediately. Say in one line that it is running; do not wait, do not
re-search what it is searching, and do not restate what it will produce — the card and its window are already in
front of the user. Later turns can open the run's own folder (`.workflows/<id>/`) if the user asks about it.

`deep-research` ships with the app. For a question that needs several sources and a cited answer, that is the
better answer than doing the research yourself, and in Search mode it is the only way to get files or a
long-running process. Check what exists before inventing a new one: the workflow list is in the composer
(`/workflows`) and in `workflows/`.

## Saving one
`workflow_save` takes the parts and writes the file, refusing anything the runner cannot parse — the file format
is in `skill_open name="workflows" file="reference/format.md"`. The shape is front matter (name, title,
description, inputs, steps) and a markdown body: the brief the thinking step follows.

Rules that matter:
- **One `agent` step, last.** It is the only step that thinks; `search` and `read` are performed by the app and
  hand it what they found. Several agent steps means several chances to drift; one means one report.
- **Progress must be honest.** `limit` and `expect` are what the bar is made of: `read limit=6` makes the bar
  move per page, `agent expect=8` per tool call. Guessing them is what makes a bar that sits at 20% and then
  jumps. A workflow with one step over a long body is a prompt with extra steps: give it real work.
- **The body is the brief, not the process.** What the run is for, what the answer must contain, how it should
  read, what to cite, what to do when the material is thin. The steps are already in the front matter — do not
  repeat them in prose.
- **Inputs are questions.** One `question` input covers most workflows; the person starting a run sees the
  label in the composer and the value fills `{{question}}` everywhere in the file.
- **Say it out loud when it is saved.** One line: the name, the steps in order, what it will produce, and how to
  run it (`/workflows`, or ask you next time).

Test what you wrote instead of describing it: `start_workflow` it once with a real input and look at the
window. A workflow whose first run fails on a typo in the front matter is worse than no workflow, because the
user trusted it.
