# Ideas — the brainstorming guide

This is the ideas part of the project: what to build after the ten features that are in, why each
one is here, what it would cost, what would make it wrong, and what has to happen before it is
worth starting.

It is a living document. Edit it in place, delete what stops hurting, and keep it short — a list
nobody prunes is a wish list, not a plan.

## Four filters

An idea has to pass all four before it gets written down here. They come from the constraints the
project actually runs on:

1. **No new surface if an existing one can hold it.** A feature that folds into the composer, a
   canvas, a block or a workflow is cheaper to build, cheaper to learn and cheaper to keep than a new
   panel. A new surface needs a stronger case, not an equal one.
2. **It must not bloat the app, the context or the UI.** Anything that adds a permanent cost to
   every turn (a new always-on tool, a bigger system prompt, a chat that grows) has to pay for itself
   in every turn, not once.
3. **It has to feel native** — to the interface it lives in and to the model that drives it. If the
   model has to be coaxed, or the user has to know an internal detail, it is not finished.
4. **It has to be verifiable here.** Every shipped feature so far ended with a test that fails when
   it breaks (structure tests, e2e suites, `check.ok` for templates). An idea that cannot be checked
   without a human eyeballing it will rot.

## What is already in (so this list does not re-propose it)

Features 1–10, roughly in order: the research/answer modes; the mode picker with auto-invoked
skills; workflows replacing the one-liner commands (deep research first, reports into the workflow
window, not into the chat); the editing canvas (tabs, highlighting, pinned header/footer); Blocks —
the documented UI language the model writes (`<ui>…</ui>`, one catalog of `x-*` tags, an iframe
sandbox, a structure test that fails if a tag is documented but does not exist); live language
variables (`live()` behind `<x-live>`: bash, python, node, ruby… 19 languages, values and histories
in the Blocks store, pushed to charts and tables); the verified template library (18 shipped
circuits/shells/documents, `template_search/get/save`, `check.ok` means it renders); and the desktop
layer (`/summon`, `/api/os`, `minimalist-chat summon|ask|hotkey|desktop`, `os_notify`).

Two things the project already decided to keep small, because every idea below has to respect them:
memory is three **visible, deletable** stores (profile, episodes, project notes) rather than a
vector layer; and the desktop never drives the UI (no screen automation) — it calls APIs.

## The ideas

Each card: **what**, why it is worth it, **cost** (S ≈ an afternoon, M ≈ a few days, L ≈ a project),
**risk** (what would make it a mistake), **trigger** (the event that says "now"), and *falsifier*
(the observation that would prove it was the wrong call).

### 1. Run any code block from the answer

**What.** Every fenced code block in a reply gets a small *Run* affordance; it executes through
`/api/blocks` (the same 19-language backends `live()` uses) and shows stdout next to it.
**Why.** Most answers end in something the user retypes into a terminal. The machinery is already
there and costs nothing at rest; this turns reading into doing without leaving the chat.
**Cost.** S. **Risk.** Running model-written code by accident — it stays in the sandbox, and host
execution still needs the host-terminal switch and the approval gate that already exists.
**Trigger.** The first time the same snippet is copied out and pasted into a terminal twice.
*Falsifier:* nobody clicks Run in a month of use.

### 2. Recipe capture — "save this as…"

**What.** On any turn, card or workflow run: *Save as workflow* / *Save as template* / *Save as
skill*, pre-filled from what just happened.
**Why.** The libraries (workflows, templates, skills) only grow if capture is one click after the
work is already good. It is also the supply side of the marketplace.
**Cost.** M. **Risk.** Half-captured artifacts that do not repeat — a saved workflow that only ever
ran once is clutter. **Trigger.** When the templates library has entries nobody has opened in weeks
(the moment capture starts producing dead weight, the save step needs a review, not more entries).
*Falsifier:* captured recipes are re-run less than one time in five.

### 3. Workspace history — snapshots you can undo

**What.** A `git` repository *inside* the workspace (hidden, listed in a visible History panel),
snapshotted at the start of every turn that can write; "undo this chat's file changes" is then one
action, and `diff_since` becomes exact instead of heuristic.
**Why.** The single real fear with an agent that edits files is an unwanted edit. Today the app
mitigates it with a trash folder for deletes and prompts for destructive commands — snapshots make
recovery unconditional.
**Cost.** M. **Risk.** Size (workspaces hold models, media) and surprise ("why is there a git repo
in my files?"). Mitigate with a size cap, `WS/.gitignore` defaults, and a switch that says what it
does. **Trigger.** The first time a file change is regretted.
*Falsifier:* nobody ever opens History; then keep the trash folder and drop the rest.

### 4. Context meter

**What.** A small live readout of what this turn actually carries: the budget, what is pinned, what
was trimmed, folded or summarised, and what each part costs. Clicking a slice shows the text.
**Why.** The app already trims, folds and compacts quite aggressively and invisibly. Trust in a
memory system comes from being able to look at it; the machinery exists, only the window is missing.
**Cost.** S–M. **Risk.** Becoming a dashboard nobody reads; keep it a meter in the composer, not a
panel. **Trigger.** The first "why did it forget?" question.
*Falsifier:* the meter is never opened while the model still surprises the user — that would mean the
problem is the trimming policy, not the visibility.

### 5. Usage ledger

**What.** Tokens and requests per chat, per day, per model, with an optional soft cap that warns in
the composer; the numbers come from the provider's own `usage` field, which the app can request.
**Why.** Local-first does not mean free: with paid keys there is currently no idea of spend until
the invoice. A cap that warns is also the honest way to offer "let it research for an hour".
**Cost.** S. **Risk.** Usage fields differ per provider and streaming needs `include_usage`; show
"unknown" rather than a wrong number. **Trigger.** The first surprising bill.
*Falsifier:* a user who switches to a flat-rate local model will never open it — then it stays a
line in Settings, not a surface.

### 6. Scheduled and triggered workflows

**What.** A workflow can run on a schedule ("every weekday at 07:30"), on a file change, or on a
webhook — with results landing in the workflow window and, at most, one line in the chat.
**Why.** Workflows and background processes already exist; only the *when* is manual. This is what
turns the workspace from something you visit into something that works while you are away. The
morning brief already hints at this by offering itself, once, by hand.
**Cost.** M. **Risk.** Autonomy and noise. Rules: per-workflow consent, a visible schedule list, a
hard cap on unattended spend, and results that never interrupt an active chat.
**Trigger.** The second week in a row the user runs the same workflow by hand.
*Falsifier:* scheduled runs are ignored (never opened) → cut to one, or drop.

### 7. Voice in the summon window

**What.** Hold a key in the summon window, speak, release: the transcript lands in the box. Local
speech model in the app venv by default; the browser's own recogniser as an opt-in.
**Why.** A 620×320 always-available window is for the moment your hands are busy. Typing is the only
input it has today, which is the wrong bottleneck for the one surface designed for interruption.
**Cost.** S (browser API) / M (local model). **Risk.** Privacy: the browser recogniser ships audio to
a third party, so it must not be the default. **Trigger.** Summon is used daily.
*Falsifier:* dictation is never used in a week of summoning.

### 8. One search across everything

**What.** A single box that answers "where did I see this?": chats (already searchable, ILIKE over
messages), workspace files, workflows, templates, skills, artifacts, run records — as a thin fan-out
over the search functions that already exist, not a new index.
**Why.** The artifact count multiplied (chats, blocks, canvas windows, workflows, runs, templates,
skills, memories) and each has its own panel. Navigation-by-remembering-which-panel is the tax.
**Cost.** M. **Risk.** Re-implementing `fs_search` badly, and ranking. Keep it a fan-out with a
section per source and let the existing tools do the work.
**Trigger.** Around 200 chats, or the first "I know I asked this before".
*Falsifier:* the panel stays unused because the model itself is the search box (`fs_search` in chat
works) — then the right move is to teach the agent to answer "where did I…" instead.

### 9. A second opinion

**What.** Select text → *Ask another model*. Uses the provider list the app already has, shows the
two answers side by side in a canvas, one click to keep.
**Why.** Cheap, and it makes model differences legible — which is exactly the judgement the mode
system asks the user to make anyway.
**Cost.** S. **Risk.** Two mediocre answers instead of one good one: keep it on a selection, never
automatic, and never in the context budget of the main chat.
**Trigger.** The first time a key answer is doubted.

### 10. Blocks: keyboard and accessibility pass

**What.** Full keyboard operation for the interactive tags (`x-deck`, `x-choice`, `x-todo`,
`x-tabs`), correct roles/labels, visible focus, and honouring reduced-motion (the `--spring`
constant).
**Why.** "Feels native" includes keyboard-only use, and a community tag set needs a baseline: if the
shipped shells are not operable without a mouse, third-party ones will not be either.
**Cost.** S–M. **Risk.** None meaningful. **Trigger.** Before the SDK ships, and before the first
external block.
*Falsifier:* it is one afternoon; the falsifier would be finding it unnecessary, which is unlikely.

### 11. Blocks SDK and scaffold

**What.** A generator (`blocks new <name>`) producing a tag with docs, a typed list generated from
`catalog.ts`, and a lint that runs the existing `uiIssues` check so a broken tag fails before it
renders. Version the tag set with every scaffold.
**Why.** Contribution is a stated goal and today's path is "read the docs and guess". The catalog,
the checker and the skill already exist; the SDK is the missing paved road.
**Cost.** M. **Risk.** SDK outrunning the runtime — mitigate by generating from the catalog rather
than documenting it twice.
**Trigger.** Two cases of hand-written blocks that miss the same rule.

### 12. Marketplace trust model (before the marketplace itself)

**What.** Decide, in writing and in code, what installing someone else's thing means: bundles are
reviewed, versioned and `check.ok`-verified (like the template library today); user content stays
local and unmarked; third-party content declares capabilities (`needs: host`, `net`, `fs`, `iframes`)
and the install dialog shows them. Blocks already run in a sandboxed iframe; templates render
through the same verified paths; skills are instructions to the model — each needs its own sentence.
**Why.** This is the difference between a wish and a feature. Without it, the marketplace ships a
security hole with a nice card layout.
**Cost.** M. **Risk.** Security theatre: be explicit that review is not a sandbox, and that "verified
to render" is not "safe to run".
**Trigger.** The first author who is not the user.
*Falsifier:* if all content stays first-party, keep the library and skip the marketplace — which is
a perfectly good outcome.

### 13. The infinite canvas (workflow playground)

**What.** The endgame you named: workflows as nodes you place and connect, running on the engine that
already exists (search → read → agent → produce), with blocks as node bodies.
**Why.** It is the natural home for "connect things" work, and the nouns are already in place.
**Cost.** L. **Risk.** A node editor is a project of its own, and the step-based engine is not yet
proven at depth. **Trigger.** When hand-written workflows pass ten and the good ones pass five steps
— that is when connecting beats listing.
*Falsifier:* nobody edits workflows by hand (they only run shipped ones) → a graph would be shelf
furniture.

### 14. Chats as files

**What.** A conversation is already a tree in the database; export it (or store it) as markdown in
the workspace, so chats diff, grep, sync and can be edited in the editor the app already has.
**Why.** Local-first text in files survives everything; the sync tooling (`chatsync`) already exists
for the reverse direction. It also makes chat search trivial.
**Cost.** M. **Risk.** Two sources of truth — one of them must be canonical, and the other derived
(export only, one-way, clear provenance).
**Trigger.** Together with search — they are the same problem.

### 15. Golden turns (a tiny eval harness)

**What.** A fixture set of prompts whose *properties* (not strings) are asserted — "this mode calls a
search tool before answering", "this answer contains a table", "no filler opener" — run before a
model or prompt change.
**Why.** The app has many prompts, five-plus modes, and per-model quirks; today a model swap is
judged by vibes and regressions are found by the user. The harness already has slop/quality checks
to build on.
**Cost.** M. **Risk.** Brittle tests: assert properties, never exact text.
**Trigger.** The first time a model change breaks a mode and nobody notices for a day.

## Considered and rejected (kept here so they stay rejected)

| idea | why not |
| --- | --- |
| Screen automation / UI-driving desktop agent | The stated principle: call APIs, never the screen. Fragile across themes, layouts and OSes, and untestable. |
| Native mobile app | `/summon` on a home screen is the 90% answer; a second client doubles the maintenance for the same endpoints. |
| Vector database over everything | Memory is three visible, deletable stores on purpose. A similarity layer hides what is in context, which is the opposite of what this app is for. |
| Multi-agent swarms / auto-orchestration | Cost and debuggability. The workflow engine is the orchestrated form, and it is inspectable. |
| Telemetry and analytics | Local-first. Usage numbers, when they come, are the user's alone. |
| A built-in browser as a surface | Firecrawl/browser escalation exists for hard pages; a browser window inside the app would be a worse browser. |
| Per-user prompt tuning | Unverifiable with one user, and it trades a legible prompt for an opaque one. |
| Marketplace before the trust model | See idea 12. |

## What to do next, in order

1. **Recipe capture (2)** — because the libraries are the product surface that is still manual, and
   every other idea (marketplace, canvas) needs supply.
2. **Workspace history (3) *or* context meter (4)** — pick by the pain that actually occurred first:
   a regretted edit, or a mysterious forgetting.
3. **Blocks a11y (10) then SDK (11)** — cheap, and they unblock community content.
4. Everything else by trigger. Nothing else by ambition.

## How to brainstorm the next batch

- **Start from a pain, not a feature.** Keep a short note of what annoyed you this week ("I copied
  the same snippet out twice"); an idea without an incident behind it is usually a fantasy.
- **Check the four filters** above before writing the card. Most ideas die at filter 1 or 2, and
  that is the point.
- **Prefer folding.** "Where does this live that already exists?" is the highest-value question in
  this app.
- **Price it honestly** (S/M/L) and **name the falsifier** — the observation that proves the idea
  wrong. If there is no such observation, the idea is not testable and will not be finished.
- **Set a trigger, not a date.** Dates make features late; triggers make them timely. Then delete
  cards whose trigger never fires.
- **Ship the smallest slice that can be judged**, and let the judgement — not the plan — decide
  whether the rest of the card happens.
