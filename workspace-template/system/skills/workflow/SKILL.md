---
name: workflow
description: Run, author and extend workflows — pipelines that live in their own window and post only their result to the chat.
tools: dev
---
# Workflows

A workflow is a **window**, not a block: a pipeline of steps (plan → search → select → read → write →
check) that keeps everything it produces outside the conversation. Only what the workflow delivers
enters the chat — for deep research, that is the one report. The user watches the searches, the
pages, the evidence and the checks in the window, next to the chat, and keeps talking to you about
the result the whole time.

## Running one
- `workflow_list` — the workflows this install offers.
- `workflow_start(workflow, question)` — starts a run, opens its window, returns a run id immediately.
  Do **not** wait or poll: the report is posted to the chat by itself when the run finishes. Say what
  you started in one line and go on with whatever the user asked.

## Reading what a run found
The run's state is at `GET /api/workflows/run?id=<runId>` (`workflows/runs/<id>/run.json` on disk,
`report.md` next to it). The chat intentionally does not contain the searches: if you need a detail
that is not in the report, read the run, do not ask the user to paste it.

## Authoring a workflow
Workflows are code because their steps have to actually run:
1. **Definition** — `src/lib/workflows/<name>.ts`: `WorkflowDef` = id, name, hint, icon, input label,
   budget, `steps` (the engine's kinds), `panes` (which views the window shows) and `prompts` (one
   string per step). Add it to `BUILTIN` in `src/lib/workflows/index.ts`.
2. **New step kinds** live in `src/lib/workflows/runner.ts` next to the code that can run them. A step
   is free to call the model (`complete()`, isolated: its own system prompt, no history), the search /
   fetch layer (`firecrawlSearch`, `firecrawlScrape`) or any other server helper. Everything a step
   wants to show belongs in the run state, not in the chat.
3. **Per-install overrides** — `workspace/workflows/<id>.json` replaces `name`, `hint`, `budget`,
   `prompts` and `panes` without touching code (a typo only disables the field it is in). That file is
   also how a shared workflow travels: prompts and budgets, nothing to compile.
4. **Panes** — `view` ids are rendered by `src/components/Workflow.tsx`; block-backed panes (like
   deep research's Evidence) render real BlocksUI inside the window. A new `view` is one component.

## Rules
- Deliverable in chat, machinery in the window. Never paste a run's log, queries or page text into the
  conversation — that is exactly the context cost the workflow exists to avoid.
- One run per question, not per sentence: a follow-up question about a report is a normal chat turn.
- Long work belongs in a workflow even when it is not a "research" task: if the answer needs more than
  two searches, its sources should live in a window instead of the history.
