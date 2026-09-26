# OpenUI (thesysdev/openui): what BlocksUI could borrow

Read in September 2026: the whole `lang-core` parser, prompt generator and runtime; the `react-ui` component list and prompt examples; the `grok-build` and `pi` harness examples; the benchmarks; and the language, reliability, autofix, artifact and pattern docs and blog posts. OpenUI is MIT-licensed. **Nothing below has been implemented.** Each idea needs your go-ahead.

## What OpenUI is, in one paragraph

A line-based UI language, `name = Component(positional, args)`, one statement per line, `root = …` first. The model writes it and a streaming parser renders it progressively. A React/Vue/Svelte runtime maps positional arguments to Zod-typed props. Version 0.5 adds reactive `$variables`, `Query("tool", args, defaults, refreshSec)` and `Mutation(...)`, which call MCP tools **directly from the UI without the model**, `@Filter/@Sort/@Count/@Each` builtins, and `Action([@Run, @Set, @Reset, @ToAssistant])`. The system prompt is generated from the component library with feature flags. There is also a paid cloud Gateway/Autofix that repairs invalid output.

## How BlocksUI compares today

| | OpenUI | BlocksUI (ours) |
|---|---|---|
| Syntax | Custom DSL, positional args | HTML-like tags + attributes, inline JS expressions |
| Streaming | Re-parses the trailing statement; forward refs resolve later | Streams as markdown/HTML; blocks render when closed |
| State | `$vars` + two-way binding | `name=` inputs are reactive vars, `<x-state>`, bindings |
| Talk back to the model | `@ToAssistant("msg")` | `sendToLm(data, {label, prompt})`, `form[lm]`, `button[lm]` |
| Data | `Query`/`Mutation` to MCP tools, auto-refresh | `py()` in Pyodide, `saveIn`, workspace files |
| Components | ~60 opinionated product components (cards, KPI blocks, follow-ups) | Fundamentals only, no templates (your rule) |
| Canvas | "Artifacts": preview inline, full view in a panel | Same idea: inline ⇄ canvas, docked or floating |

We are already level on bindings, talking back to the model and the inline/canvas duality. The gaps are validation/repair, patch editing, and UI bound to live data.

## Ideas worth borrowing, ranked by value ÷ effort

### 1. Validate every `<ui>` block and give the model one repair turn (high value, small)
OpenUI's parser returns `meta.errors` (unknown component, missing required prop), `unresolved` (dangling refs), `orphaned` (defined but unreachable) and `incomplete`. The grok-build harness turns those into **one bounded correction turn**: "Do not call tools. Return exactly one corrected program. Validation issues: … Invalid source: …". Invalid output is never shown as the final answer.

For us:
- A server-side checker for `<ui>`/`<canvas>` bodies: unknown `x-*` tags, unknown attributes per catalog entry, `{expr}` referencing names never declared, `each` without data, unclosed tags.
- Findings go into the existing quality-guard repair round, which currently covers files only.
- Cheap because `catalog.ts` already lists tags and attributes.

### 2. Patch-edit canvases instead of regenerating them (high value, medium)
OpenUI's "edit mode" merges by statement name: same name replaces, new name appends, and anything the patch leaves out is kept. Typical edits are 1–10 lines instead of 20+, up to 85% fewer tokens. For small-context models this matters more than anything else here.

For us:
- A `<ui-patch target="canvas-name">` block holding elements with `id=`, applied by the runtime as replace-by-id / append-to-parent / `remove="id"`.
- The model then edits a JEE mock test by re-emitting one `<x-slide id="q3">` instead of the whole deck.
- The prompt section can reuse their patch-size guide ("changing a label: 1 element; adding a component: 2–3").

### 3. Bind UI directly to tools: "the LLM is not your query engine" (high value, medium/large)
Their blog post estimates about 94% fewer tokens for data apps. Parameter changes (filter, date range) re-run the declared query at zero model cost, and every number shown comes from a real result instead of being retyped by the model.

For us:
- `<x-query name="rows" tool="fs_read|run_python|mcp__server__tool" args="{…}" refresh="30">` with a JSON default.
- Calls go through a new `/api/blocks/tool` endpoint that allows only read-only tools and respects the Access switches.
- This builds on our existing `py()` path.
- Needs a careful security design, because a UI calling tools is a new capability surface.

### 4. Prompt feature flags (medium value, small)
Their prompt includes sections only when needed:
- builtins only when bindings or queries are on;
- query/mutation rules only when tools exist;
- edit-mode text only when editing.

We already split by skill. The same trick could move the less-used blocks sections (science, `x-draw` DSL, time) into `skill_open("blocks", file=…)` references, making the base blocks skill smaller for 16k models.

### 5. A "final verification" checklist at the end of the blocks skill (small)
OpenUI ends its prompt with a self-check: root first, every referenced name defined, every defined name reachable, every `$binding` used. Their benchmark reports that one rule ("attach every component it defines") was worth **+13 points** on Kimi, and that one wrong example cost two. For us, 3–4 lines: every `name=` used somewhere, every `{expr}` name declared, one root layout, no unused components.

### 6. A WRONG/RIGHT contrast for "don't hardcode tool results" (small)
Their tool-workflow section shows a bad program that inlines fetched rows next to a good one that derives from the query. It would pair with idea 3. It is also useful now for `py()`: compute from data instead of typing numbers.

### 7. Partial render instead of blank (small, check first)
Because each OpenUI component is one line, a parse error costs one line. A2UI blanked the screen 35 times across 1,104 runs, OpenUI once. Our runtime already isolates expression errors per binding (`evaluate` returns undefined, handlers `reportErr`). Worth a test that a broken child element or attribute never blanks the whole block.

### 8. Developer inspect panel (nice to have, dev mode only)
OpenUI DevTools shows parse and render errors per statement and lets you paste code to try it. For us, a dev-mode-only drawer in the canvas listing runtime errors and validation findings for the current block. It would help while tuning prompts for small models.

### 9. Reliability benchmark (dev mode, later)
Their benchmark runs each prompt many times per model and scores structural validity and blank screens separately. We could keep a small `dev/bench/` of 10 BlocksUI prompts (JEE deck, graph with sliders, form with lm, x-todo plan…) and score them with the validator from idea 1, especially for the small local models you use.

## Worth knowing, not worth copying

- **The DSL itself.** Positional args save tokens but are harder for small models to get right without Zod-generated signatures. Our HTML-like syntax is what models have seen most. Their JSON comparison doesn't apply: we never used JSON.
- **The product component library** (KPI cards, pricing blocks, follow-up chips, "OverviewCardBlock"). It conflicts with your no-templates rule.
- **Cloud Gateway/Autofix.** Paid and remote, which conflicts with offline-first. Idea 1 is the local equivalent.
- **The Rust→WASM parser story.** Their conclusion was to drop WASM because the JS↔WASM boundary made it 30% slower. The takeaway, never re-parse completed statements, is what our streaming markdown already does per block.
- **Plan-approval dialogs** (grok-build): blocking plan approval that resumes the same turn. We have `ask_user`, which ends the turn. A resumable approval would help risky host actions, but that is a harness change rather than an OpenUI one.

## Suggested order if you approve
1 → 5 → 6 (validation, repair round, prompt lines: about a day), then 2 (patch edits), then 3 (tool-bound UI, with a security review first).
