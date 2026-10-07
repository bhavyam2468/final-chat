# Workflows

A workflow is a **named procedure the app performs for you**. You start one, it works in the background in the
order its file declares, and it shows what it is doing in a window while the chat stays quiet. Deep research is
the one that ships.

The difference from asking the model to do the same thing is not ceremony, it is three specific facts:

1. **The deterministic steps are performed by the app, not asked of the model.** "Search these queries, keep
   eight results, open the best six pages" is a fact rather than a hope — one step instead of six round trips,
   and the same behaviour every run.
2. **Progress is real.** A step is done when its work is done — sources found, pages opened — so the bar in the
   window means something instead of advancing with the token stream.
3. **The process stays out of the chat.** Searches, extracts, dead ends and the full text of every page live in
   the run record and in `.workflows/<id>/`. The chat receives the report and nothing else, so the context that
   gets carried forward is the answer, not the browsing.

A workflow is **not a block and not a chat**. It is a window that can contain blocks: the run's record is data
(the steps, the sources, the log, the report), and a workflow may ship `ui.html` — a Blocks document — to present
itself however it likes. Without one, the window uses its built-in process view.

| | What it is | Where it lives |
|---|---|---|
| **Definition** | a folder with `workflow.md`: front matter for the shape, the body for the brief | `workspace/workflows/<name>/` (shipped ones: `workspace-template/workflows/`) |
| **Run record** | steps, sources, log, report — written as the run goes, polled by the window | `workspace/.workflows/<id>.json` |
| **Run material** | the pages that were fetched, an index of every source | `workspace/.workflows/<id>/pages/NN.md`, `sources.md` |
| **Report** | saved with the chat's artifacts, and appended to the card's message | `workspace/chats/<chat>/artifacts/<slug>.md` |
| **Engine** | the parser, the record and what progress means (pure, testable) | `src/lib/workflow-format.ts` |
| **Runner** | the runners, the thinking step, the chat wiring | `src/lib/workflows.ts` |
| **Skill** | how the agent writes one worth keeping | `workspace-template/system/skills/workflows/` |

## The file

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
…the brief the thinking step follows…
```

One line per thing, no nesting. `parseWorkflow` refuses anything else with a sentence naming the file and the
problem: an unknown key, a step kind that does not exist, an option that is not `key=value`, an input name with a
space, a second `agent` step, an `agent` step that is not last. `{{name}}` is replaced with the run's inputs
anywhere in the file.

| Step kind | Performed by | Options |
|---|---|---|
| `search` | the app, through the same path as `web_search` (the user's settings are honoured) | `query=` (one or more, `;` separated; default: the first input), `limit=` |
| `read` | the app: fetch + readability extraction, small parallel batches | `limit=`, `parallel=` |
| `agent` | the model, in a hidden conversation, with the pages and the brief | `expect=` |

The `agent` step receives the body, the inputs, the step titles already done, and every source — the pages it may
read with `fs_read` and cite, plus the ones that could not be opened, so it can say a door stayed shut instead of
inventing one. It cannot see the chat: anything the report needs is either in the body or in that material.

`progressOf()` weights the steps (an `agent` step counts 3× a data step), counts a finished step in full and an
active one by what it has reported, capped just below full — so the bar never reaches a step's value before the
step is actually done, and a failed step is half rather than nothing.

## Running one

Three ways in, one code path (`startInChat` in `src/lib/workflows.ts`): the composer (`/workflows` → pick →
type the input), `POST /api/workflows`, and the `start_workflow` tool when the agent decides the user wants it.

- The run appears in the chat as **a card** — an assistant message whose parts are a workflow card plus, when the
  run ends, the report. The card shows the title, the input, the live activity and progress, and opens the window.
- The card is deliberately **not a "run"** in the app's streaming sense: the composer's Stop still means "stop
  answering", and a workflow in progress never looks like an answer in progress. The card and the window poll the
  run; the chat re-reads itself when a run settles (a global watcher in `App.tsx`, one refetch per finished run).
- Started from a chat that does not exist yet, the workflow gets a conversation of its own — a run nobody can look
  at is a run nobody trusts.
- Runs started from the chat are invisible to search and to the conversation list; the hidden `wf-<runId>`
  conversation is what keeps the searching out of the answer's context.
- Stopping: `POST /api/workflows/<id> {stop:true}` (the window's Stop button). Whatever the run produced so far is
  kept, the status is `stopped`, and the chat is told the truth rather than a report.

## API

| Route | What it does |
|---|---|
| `GET /api/workflows` | the definitions this workspace has (parsed, with any parse error as its description) and the recent runs |
| `POST /api/workflows` | `{name, input, conversationId?}` — starts a run, inserts the card, returns `{run, messageId}` at once |
| `GET /api/workflows/<id>` | the run record (the window's poll) |
| `POST /api/workflows/<id>` | `{stop:true}` |
| `GET /api/workflows/<id>/ui` | the workflow's own `ui.html`, if it has one |

The run never depends on the request that started it: `POST` returns in milliseconds and the loop continues on the
server whether or not anyone is watching.

## Creating one

- **The agent**: `workflow_save` takes the parts (name, title, description, inputs, steps, body) and writes the
  file, refusing anything the parser cannot run — the model cannot get the format wrong, and the failure message
  is the parser's own sentence. `skill_open workflows` has the craft: when a workflow is the right answer at all,
  why the agent step is last, and why `limit`/`expect` are what make the bar honest.
- **By hand**: a folder in `workspace/workflows/<name>/` with a `workflow.md`. It appears in `/workflows`
  immediately.
- **From a community**: same thing — a workflow is files, so a shared one is a folder you copy in (with its
  `ui.html` if it has one).

Extending the *kinds* of work is one entry: add a function to `RUNNERS` in `src/lib/workflows.ts` (kind + options
in, run record out) and its name to `KINDS` in `src/lib/workflow-format.ts`. A new kind is then available to
every workflow in every workspace, including the ones the agent writes.

## The window

`WorkflowView` (`src/components/Workflow.tsx`) is the block-side: a header (title, the question, the progress
bar, the status line), tabs for Process and Report, the steps with per-step detail, the sources with what was
read, and the log. It polls the record while the run is live and stops when it settles.

A workflow with its own `ui.html` renders that instead of the process view. The run arrives twice: once as a
`<script type="data" name="run">` tag (so the document is a pure function of the record, and can be opened on
its own), and then again on every change as a host event, which a one-line subscription turns into a live
window: `Blocks.on("run", (r) => { S.run = r })`. The bar with the tabs and the report stays on top either way,
and Process is one tab away — the workflow's own face is never the only way to see what happened.

`CanvasSpec {kind:"workflow", run}` is what opens it, from the card, from `/workflows` → recent runs, or from the
`open-workflow` event.

## Tests

```bash
node --experimental-strip-types dev/tests/workflows.test.ts   # the format, what the parser refuses, progress, the brief
node dev/workflows-e2e.mjs                                    # the composer path, then the tool path (mock model)
```

`workflows.test.ts` is pure — the format module has no database, filesystem or settings imports, which is why it
can be tested at all. `workflows-e2e.mjs` drives a real browser: `/workflows` → pick → input → the window opens,
shows real progress, renders the workflow's own UI when it is done, and the chat ends up with the card and the
report and nothing of the process; then the tools — the model saves a workflow (the file is checked on disk, and
that the runner accepts it) and starts one (its report lands in the chat as its own message).

## Where this is going

The workflow playground — an infinite canvas where you drop blobs (search, read, a model call, a branch, a shell
command) and connect them — is the next shape of the same idea, and it is a rendering of the same record: nodes
are steps, edges are order, the bar is the run. That is why the run record is data first and the window is only
one view of it.
