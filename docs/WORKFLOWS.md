# Workflows

A workflow is **a window, not a block**.

A block is one rendered idea inside a message. A workflow is a reusable pipeline: several model and tool
steps that run in a defined order, each of which can take minutes and produce more material than a chat
should ever hold. The window is where that material *lives* — the plan, every query, every candidate,
what each page actually said, the draft, the check. The chat receives only what the workflow decides to
deliver.

That split is the whole point. Deep research that reads ten pages and distils hundreds of thousands of
characters of page text posts **one report** into the conversation: the history grows by one message, not
by a research session. The user watches the run next to the chat and keeps talking about it while it
works.

```
 chat                          window (a canvas window, docked)
 ┌───────────────────────┐     ┌─────────────────────────────────────────┐
 │ user: what does a heat│     │ DEEP RESEARCH   DONE            8/8 0:01 │
 │ pump cost per kW…     │     │ what does a heat pump cost per kW in …   │
 │                       │     ├──────────────┬──────────────────────────┤
 │ ◇ Deep research  OPEN │     │ ● Plan   1.3s│ [Steps][Plan][Sources]   │
 │ What does a heat pump │     │ ● Search 0.1s│  [Evidence][Report][Log] │
 │ … 42 units against 31 │     │ ● Select 0.0s│                          │
 │ in 2019 [1] …         │     │ ● Read   0.1s│   (Report tab)            │
 │                       │     │ ● Write  0.0s│   … 42 units against 31  │
 │ [ ask about the report]│    │ ● Check  0.0s│   in 2019 [1] …          │
 └───────────────────────┘     │ ● Deliver    │                          │
   one message of context      ├──────────────┴──────────────────────────┤
                               │ 5 queries · 6 pages · 18 claims · 1 (rev)│
                               └─────────────────────────────────────────┘
```

## The window

`src/components/Workflow.tsx` renders a run. It is a **chrome window** on the canvas layer, not an
immersive one: its title bar, tab strip and footer stay laid out, because a workflow is read *while*
the chat is being used. `Canvas.tsx` treats `kind: "workflow"` as a `{ratio: 1.62, pw: 1040}` window and
passes `chrome` to `onEdit`, so the bars are never auto-hidden the way a document canvas hides them.
`contentRatio()` gives it a wide default because the step rail and a pane sit side by side.

The window has three regions, and all three come from the run snapshot — the window renders itself from
`RunState`, so it looks the same live, after a reload, and when reopened from a chat chip a week later:

- **Head** — workflow name, status pill, elapsed time, the question, and the bar's numbers
  (`5 queries · 6 pages · 18 claims · 1 issue (revised)`); the window's own actions are `Stop` while it
  runs, then `Copy`, `Open as a canvas` and `Download` for the finished report.
- **Rail** — one row per step: a status dot, the title, the duration, and the summary the step wrote
  (`20 candidates from 4 queries`, `2 of 20 pages chosen`, `2 pages read · 6 claims`, `report posted to
  the chat`). Steps run in order, so the rail doubles as progress and as a log of what the run did.
- **Panes** — the tabs. Most are native views, because they are *interactive*: the source list filters,
  a source opens in a canvas window, the rail expands. The **Evidence** pane is BlocksUI — its content
  is unbounded (every claim and quote from every page) and it is read, not operated, so it is generated
  as `<x-section> / <x-list>` markup and rendered by the same `Block` surface the model writes in. That
  is the intended split: reach for blocks when the material is something to *show*, reach for a native
  pane when it is something to *use*.

The native panes are built from the state directly:

| pane | what it shows |
|---|---|
| `steps` | the full step list with notes (the rail, expanded) |
| `plan` | the sub-questions and the search queries chosen for each |
| `sources` | every candidate, with host, snippet, and its fate: `queued`, `3 claims`, or `unusable · paywall` |
| `evidence` | per page: the distilled claims, each with the verbatim quote, plus the caveats the extractor kept |
| `report` | the delivered report, markdown |
| `log` | the run's own log lines, timestamped |

A pane is `{id, title, view}` in the definition; `view` is the engine's vocabulary, and the pane order
is the tab order. A workflow that has material no existing view can express adds one component to
`Workflow.tsx` — or composes it out of BlocksUI, which is why a new workflow rarely needs new React.

## The engine

`src/lib/workflows/runner.ts` is the only place that executes steps, and it holds three rules:

1. **Every model call is isolated.** A step calls `complete()` with its own system prompt and its own
   user message — no conversation history, no prior step's tokens. Thirty pages read in parallel cost
   the run's time and the workflow's own budget, never the chat's context. The system prompt for each
   step comes from the definition's `prompts`, which is why "the pipeline" is data.
2. **Only the deliverable crosses back.** `deliver()` appends exactly one assistant message to the
   newest main-line leaf of the conversation — parts `[run, text]`, where `run` is the chip that reopens
   the window and `text` is the report. Everything else stays in the run.
3. **Nothing is silently dropped.** A page that is a paywall, a 404 or an anti-bot wall is kept in the
   run marked `unusable` with the reason; a sub-question nothing answers stays visible as an open
   question in the report. "Not found" is a finding.

### Runs live outside the process graph

Runs are held in `globalThis.__wfRuns`, so a dev-server hot reload does not lose a live run. A run is
written to disk coalesced at 300 ms (`run.json`, plus `report.md` on completion) and pruned to the
newest 20. Finished runs stay in memory for 60 s, which is how the chat page's poll notices a delivery.

`attachRun(id, signal)` returns an **NDJSON** stream of `RunEvent`s — the client replaces the whole
state on `state` and patches it on `step` / `log` / `plan` / `sources` / `report` / `check`, then stops
on `done`. It works on a finished run too (the state is replayed first), which is what makes reopening
an old run from its chip instant. Because the stream is `x-ndjson`, a client that tests
`content-type.includes("json")` will wrongly try `res.json()` on it — match `application/json` exactly.

### Step kinds

Kinds are the engine's vocabulary, and they live next to the code that can run them. Deep research uses
eight, all currently implemented:

| kind | what it does | what it leaves in the run |
|---|---|---|
| `plan` | one call: break the question into sub-questions + queries | `plan.sub[]` |
| `search` | offline search per query, deduplicated by URL (`mapLimit 3`) | `sources[]`, `stats.queries` |
| `select` | one call choosing which candidates are worth opening | `why` on each source, `read` flag |
| `read` | one **isolated** call per page: claims, verbatim quotes, caveats, verdict | `claims`, `points`, `answers`, `failed` |
| `gaps` | one call auditing what the evidence does not answer | `followups[]`, then a second search/read round |
| `write` | one call: synthesise the distilled evidence into a cited report | `report` |
| `check` | one call verifying the report against the evidence; one revise pass if it finds issues | `check{ok, issues, revised}` |
| `deliver` | post the report to the chat | `messageId`, chat `[run, chat report]` |

`ask()` counts every call in `stats.calls`, so a run's cost is on its own bar. `stopRun()` aborts the
run's `AbortController` and logs "Stopped by the user"; the partial state stays visible.

## The definition contract

`src/lib/workflows/types.ts` is the contract shared by the runner, the window and the authoring skill.

```ts
type WorkflowDef = {
  id: string;
  name: string;           // label in the palette and on the window
  hint: string;           // one line
  icon: string;           // lucide key, mapped in the UI
  input: { label: string; placeholder: string };
  budget: Budget;         // sub, perQuery, candidates, reads, followups, pageChars, writeTokens
  steps: StepSpec[];      // { id, title, note, kind } — order is the run order
  panes: PaneDef[];       // { id, title, view } — the tabs
  deliver: "report";      // what leaves the window
  prompts: Record<string, string>;
};
```

`src/lib/workflows/index.ts` is the registry: `listWorkflows()`, `workflowOf(id)` and
`loadWorkflow(id)`. Built-ins are code (their steps have to actually run), but everything a team would
change per install — name, hint, budgets, prompts, panes — is data, read from
`workspace/workflows/<id>.json` and applied by a **tolerant** merge: a bad field is ignored field by
field, so a typo disables one number, never the workflow.

```json
{
  "budget": { "reads": 14, "followups": 0 },
  "prompts": { "write": "Write the report in German, house citation style: [S1]." }
}
```

### Deep research's defaults

```
sub [3,5] · perQuery 5 · candidates 40 · reads 10 · followups 3 · pageChars 7000 · writeTokens 3500
```

A run of those defaults, against the dev mock: 5 queries → 25 candidates → 6 pages read → 18 claims →
12 model calls → 1 follow-up query and 4 more reads → 1 issue found and revised → a 755-character
report. The conversation holds exactly **one** assistant message.

## API

| route | body / query | returns |
|---|---|---|
| `GET /api/workflows` | — | `{workflows:[{id,name,hint,icon,input,steps,panes}], active, recent}` |
| `POST /api/workflows` | `{workflow, input, conversationId?}` | `{runId, conversationId, title}` (400 `{error}`) |
| `POST /api/workflows` | `{stop: runId}` | `{stopped}` |
| `GET /api/workflows/run` | `?id=<runId>` | `{run}` |
| `GET /api/workflows/run` | `?id=<runId>&stream=1` | NDJSON `RunEvent`s |

`recentRuns(withinMs = 150_000)` returns `{id, conversationId, messageId, status, name}` — the chat page
polls `GET /api/workflows` every 4 s while the tab is visible and uses `recent[].messageId` to notice
that a report has been delivered, then pulls that conversation.

## Starting a run

Four ways, all landing on the same `startWorkflow(workflow, question)`:

- **The composer chip** — `/workflows` in the palette lists the definitions; picking one puts a
  `.cwork` chip on the input bar ("Deep research"), and the next thing typed is the run's *input* rather
  than a message. `/workflows deep-research <question>` runs it in one go.
- **`/research <question>`** — the shorthand command.
- **The palette** — the Workflows tab lists definitions with their step counts and panes.
- **The model** — `workflow_list` + `workflow_start(workflow, question)`; the AI starts a run and keeps
  talking, because the report arrives on its own. The chat-side skill is
  `workspace-template/system/skills/workflow/SKILL.md`.

A run started from chat switches to the conversation that will receive the report (creating one if
needed), so the chip and the report are always in the same place. While a run is live the composer shows
a chip in the composer row; the run's window can be closed and reopened at any time, and reopening a
finished run shows the same window with the same panes.

`plan` mode denies `workflow_start`: a planning turn should not spend a run's budget.

## Adding a workflow

1. **Definition** — `src/lib/workflows/<name>.ts`, a `WorkflowDef`. Write the prompts as named exports
   like `deep-research.ts` does, so an override can replace one of them without touching the rest.
2. **Register** — add it to `BUILTIN` in `src/lib/workflows/index.ts`. It appears in the palette, the
   composer chip, `/api/workflows` and `workflow_list` immediately — there is no second list to update.
3. **Steps** — if the workflow needs a step the engine does not have, add the kind in `runner.ts` next
   to the code that can run it; a step may call the model, the search/fetch layer, or any server helper.
   A step must write what it produced into the run state — that is the only way the window can show it.
4. **Panes** — reuse an existing `view`, or add one component to `Workflow.tsx` for a new `view`. Prefer
   composing BlocksUI inside the window before writing a new native pane.
5. **Override for this install** — `workspace/workflows/<id>.json` (budgets, prompts, panes).
6. **Prove it** — `dev/workflows-e2e.mjs` drives the whole flow in a browser against the dev mock
   (`dev/mock-llm.mjs` answers the pipeline's own prompts, so runs are deterministic and offline).

### Why the marketplace direction works from here

A workflow is already a file plus a window: prompts, budgets and panes are data, step kinds are the
engine's vocabulary, panes are drawn by BlocksUI. Sharing one therefore means sharing a JSON definition
(resolved through `loadWorkflow`), not shipping a plugin. The same file is the unit a future community
registry lists, and the same pane mechanism is what a "block template" (a quiz, a half-adder sheet)
would ride: material goes in the run, the run renders it with blocks, the chat only sees the result.

## Files

| file | role |
|---|---|
| `src/lib/workflows/types.ts` | the contract: definition, step, budget, pane, run state, events |
| `src/lib/workflows/deep-research.ts` | the built-in definition and its seven prompts |
| `src/lib/workflows/index.ts` | the registry and the tolerant workspace override merge |
| `src/lib/workflows/runner.ts` | the engine: `startWorkflowRun`, `attachRun`, `stopRun`, `activeRuns`, `recentRuns`, `runState`, `isRunning` |
| `src/app/api/workflows/route.ts` | list / start / stop |
| `src/app/api/workflows/run/route.ts` | one run's state, or its live NDJSON stream |
| `src/components/Workflow.tsx` | the window: head, rail, panes, footer |
| `src/components/Canvas.tsx` | the `workflow` canvas kind (a chrome window, `{ratio:1.62, pw:1040}`) |
| `src/components/App.tsx` | `startWorkflow`, `openWorkflow`, the 4 s delivery poll, `/research` |
| `src/components/Composer.tsx` | the `.cwork` chip: "the next thing typed is this run's input" |
| `src/components/palette.tsx` | the Workflows panel |
| `src/components/Message.tsx` | the `run` part: the chip in chat that reopens the window |
| `src/lib/tools/index.ts` | `workflow_list`, `workflow_start` |
| `workspace-template/system/skills/workflow/SKILL.md` | what the model knows about all of this |

Runtime data (gitignored): `workspace/workflows/<id>.json` for overrides, and
`workspace/workflows/runs/<runId>/{run.json,report.md}` for runs (newest 20 kept).
