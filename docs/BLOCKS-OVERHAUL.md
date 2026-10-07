# Blocks overhaul — reliability before expansion

**Status:** original review/proposal, followed by a scoped implementation on 2026-10-07. See [implementation and test guide](BLOCKS-IMPLEMENTATION.md) for what actually shipped; the remainder below records the earlier design, not a claim that every proposed phase is finished.  
**Review date:** 2026-10-07. **Code examined:** `5ff7a768949bdaa03e29744cbc0728929dd4f0a7`.  
**Immediate scope:** native flowcharts; correctness, composition, lifecycle, validation, and backend reliability of existing Blocks.  
**Deferred:** template marketplace, community publishing, general workflow platform, desktop/mobile ports, compiler suite. Canvas code-editor improvements can ship independently.

## 1. Product intent

The model should describe content, relationships, and behavior. The runtime should own sizing, spacing, routing, rendering, state identity, and safe execution.

Templates are reusable domain knowledge, not merely visual presets. A future half-adder package should contain a verified topology and behavior, not a screenshot or a long prompt asking the model to draw a half-adder again. The library belongs in storage and retrieval, not permanently in the model's context.

Do not add dozens of new components on top of unreliable foundations. Keep the existing Quiet Paper design, HTML-like authoring familiarity, streaming chat, backend bridge, and inline/Canvas presentation. Strengthen their contracts.

## 2. Review scope and evidence limits

The previous review used read-only web access because the workspace failed. Local access recovered for this review. Source inspection has covered the agent loop; Blocks runtime, element implementations, host bridge, catalog, checks and documentation; message segmentation; context compaction; DB schema and initialization; Canvas editor and window identity paths; app UI events; workspace template migration; skill discovery; execution boundaries; TikZ; vendor serving; and existing test harnesses. Some large surrounding modules were inspected in sections, not in full.

This is **not** a claim to have read every repository file or certified the entire app. Full migration review must still cover all affected app paths, branch/thread ownership, export/import, deployment security, all viewers, and actual configured model behavior. Browser probes used the real unmodified standalone Blocks runtime, not the complete Next.js application.

At the time of the original review, no production code had been changed. The subsequent implementation adds ELK and changes the runtime, bridge, contracts, tests and authoring references; see the linked implementation guide.

### Tests run

- All eight existing `dev/tests/*.ts` test files completed successfully after installing dependencies. `harness-extra.test.ts` initially could not load a missing dependency, then passed after installation.
- Existing `dev/blocks-e2e.mjs`: **52 passed, 0 failed**, using headless Chromium through its `CHROME` override.
- Eight additional targeted Chromium probes reproduced the issues below.
- Direct Node probes demonstrated three structural-validator blind spots and the backend delimiter mismatch.
- No real-model reliability benchmark, complete app E2E suite, production build, or visual audit of all components was performed in this review.

The existing E2E runner substitutes a circle SVG for `/api/tikz`. Its passing TikZ cases prove the component accepts an SVG response, **not** that generated circuits compile, look correct, or have correct connections.

## 3. Reproduced failures

| Finding | Minimal condition / observed result | Relevant implementation |
|---|---|---|
| Aside overlap | Two sibling cards with `.side { place: end }` occupy overlapping rectangles | `runtime.js` `placeUnit`; `runtime.css` gives asides the same root grid area |
| Reordering loses item identity | Two repeated rows A/B; type into A; reorder to B/A; A's text appears in B | `runtime.js` drops `:key`, `renderEach` reuses clones by index |
| Form scope leaks | Two cards each have an input named `answer`; `form('#b')` returns card A's value | `form(scope)` enumerates local fields but `readInput(name)` queries the entire root |
| State scope leaks | Separate `x-data="{count:1}"` / `x-data="{count:2}"` groups both display 1 | `initData` writes into a global store rather than per-composition scopes |
| Table columns misalign | Records `{name:'Ada', score:5}` and `{score:9, name:'Lin'}` render the second row as `9 / Lin` under `name / score` | `elements.js` table uses first-record keys and each record's independent `Object.values` order |
| Removed timer keeps working | Start a timer, remove its DOM node; it remains running and emits two ticks over the next ~480ms | Timer has no disconnect cleanup |
| Layout weight changes typography | `size: 2x` versus `size: 1x` gives 18px versus 15px text | `compileRel` couples flex weight, visual scale, and font size |
| Missing accessibility state | Progress has no progressbar role/value; toggle has switch role but no `aria-checked` | Element implementations |

### Additional deterministic probes

`uiIssues` returned an empty issue list for each of:

```html
<ui><x-card>Unfinished
```

```html
<ui><x-timer seconds="oops"></x-timer><x-chart type="unknown" data="bad"></x-chart></ui>
```

```html
<ui><x-timer id="t"></x-timer><x-timer id="t"></x-timer></ui>
```

These demonstrate missing whole-document completion, typed property, and duplicate-ID checks. They are not an exhaustive validator test.

The Blocks host's NDJSON reader splits on the literal backslash-plus-n characters (`[92,110]`), whereas `/api/blocks` emits newline characters. Applying that delimiter to a two-event NDJSON packet extracts zero complete events. The resulting combined buffer cannot be parsed as one JSON object. Fix and test across arbitrary transport chunk boundaries, not just one-event packets.

## 4. Why circuits need a separate answer

Current TikZ processing prepares TeX, compiles it, recolors SVG output, and checks for a nonempty picture. It does not understand gates, wires, pins, circuit validity, or truth tables. Comments/catalog text suggesting anchors guarantee non-overlap are stronger than the implementation can establish.

A model producing a circuit through raw TikZ has to solve simultaneously:

1. The underlying logic or electrical topology.
2. The appropriate symbols and pin conventions.
3. Wire connectivity and junctions.
4. Geometry and routing.
5. Label placement.
6. TeX syntax and package requirements.

A successful SVG only confirms part of item 6. It cannot prove the other five.

### Immediate policy

- Build native flowcharts as **relationship diagrams**, not a pretend circuit simulator.
- Keep TikZ as an expert/static drawing path, with honest limits and proper error reporting.
- Do not silently substitute generic boxes for an actual gate schematic.
- Use verified fixtures when evaluating circuit rendering; do not imply that a diagram is electrically verified because it looks plausible.

### Future domain module

A digital-logic module should represent gates, named input/output ports, nets, and known gate behavior separately from drawing coordinates. A half-adder uses `Sum = A XOR B`, `Carry = A AND B`; a fixture checks all four input combinations. Net validation checks port existence, input arity, disconnected required pins, and unsupported feedback. Analog simulation and sequential circuits are separate capabilities, not automatic consequences of supporting a half-adder.

Verified topology can then render with native symbols and routing. Curated templates and community packages can build on that module later.

## 5. Shared contracts for all existing elements

### 5.1 One registry

Introduce an authoritative element definition containing:

- Name, version, description, tags.
- Typed attributes, defaults, constraints, and mutually exclusive options.
- Valid child/content forms and container/leaf classification.
- Value/state schema, events, and callable actions.
- Supported empty/loading/error presentations.
- Layout minimums and overflow/adaptation policy.
- Dependencies, connectivity requirements, execution capabilities.
- Working examples and behavioral fixtures.

Generate catalog signatures, validation metadata, reference documentation, and prompt examples from it. Keep renderer implementation in modules; the registry must not become another handwritten duplicate of the entire runtime.

The schema and fixtures, not an ever-longer system prompt, define what is supported.

### 5.2 Shared data normalization

Normalize input data once before rendering:

- Tables derive cells by declared column keys. Missing values stay missing; different object key order cannot move values between columns. Use a real CSV parser for quoted separators/newlines.
- Charts have explicit series and axis definitions. Do not silently reinterpret malformed numbers as zero or invent a chart type. Missing values should create deliberate gaps where appropriate.
- Automatic dual-axis changes must not quietly change the meaning of a comparison. Make scaling explicit in the SDK and visible in the presentation.
- Lists/timelines have stable item IDs and typed fields; delimiter text can remain a convenience format where unambiguous.
- Quizzes use unambiguous option IDs internally. “B” as literal answer text versus option index must not be guessed when ambiguous.
- Timers validate finite nonnegative durations; input constraints produce readable feedback.

### 5.3 Lifecycle and asynchronous work

Give elements explicit setup/update/teardown and serializable state boundaries.

- Dispose intervals, animation frames, observers, subscriptions, and document listeners.
- Ignore stale asynchronous responses after a newer render, source revision, or unmount.
- Keep input focus, selection, scroll, and current choices through unrelated updates.
- Do not reconstruct entire interactive subtrees for every small change.
- Batch related updates; avoid polling every element when only one value changed.
- Render-time callbacks must not create uncontrolled external effects.

Timer lifecycle needs a deliberate distinction: deleting an element releases its resources; an active Pomodoro moving between surfaces should continue through one instance-owned clock/deadline, not two DOM-owned intervals. Reload/sleep behavior must be specified and tested.

### 5.4 Honest error handling

Do not confuse tolerance with silent reinterpretation.

- Safe defaults: omitted direction, gap, or optional title.
- Unsafe guessing: broken wire target, malformed numeric data, unknown action, or missing answer key.
- Report structured diagnostics with document revision, element ID, location, severity, and recovery hint.
- Keep the valid part usable. Preserve the last valid diagram/data view when a new update fails, with a visible stale/error indication.
- One bounded model repair, then a readable fallback. Repair the smallest relevant unit, not the entire answer by default.
- Do not run actions during partial parsing or replay them during repair.

### 5.5 Accessibility and quiet visuals

- Native keyboard semantics for controls, tabs, sorting, and choices; explicit value/selection ARIA state.
- Maintain focus through updates; never use color alone to convey correctness/status.
- Reduce-motion applies to JS animation as well as CSS.
- Keep text at readable sizes; wrap or compact content before scaling whole diagrams down.
- No default box around every semantic block.
- Reuse the app's token scale rather than accumulating nearly identical spacing/radius rules.

## 6. Layout overhaul

### Three separate decisions

1. **Composition:** which children belong together.
2. **Allocation:** how available space is shared.
3. **Presentation:** typography, emphasis, density, and optional compact forms.

A layout weight must not change text size. Aspect ratio is a preferred shape, not permission to clip content or reduce controls below usable sizes.

### Small explicit layout vocabulary

Prefer row, column, grid, and weighted split over selector-driven DOM relocation. Existing `x-row` / `x-col` / `x-grid` remain useful. A versioned new split contract could describe `axis`, `weights`, and an automatic stacking fallback; exact public spelling is not committed yet.

```text
row, weights 2:1
  explanation
  column
    timer block
    timeline block
```

- Every child gets an intrinsic minimum and can shrink safely where appropriate.
- Narrow layouts stack in logical reading order.
- Adaptation depends on each container's available space, not only iframe orientation.
- Horizontal weights distribute available width. Vertical weights apply only when the parent has a bounded height; chat content normally grows naturally.
- No generated absolute positioning for ordinary layouts.
- Tables, code, and large diagrams may scroll internally where it preserves meaning; text/forms should normally reflow.
- Reflow must not remount the underlying stateful block.

Legacy relational styles remain supported through a compatibility path. Changing existing `size` semantics globally would alter saved answers; new semantics require versioning or an explicit opt-in.

## 7. Native flowcharts

### Architecture

```text
short graph source
  -> parser
  -> validated graph (node IDs, node kinds, labeled directed edges)
  -> measured node/label sizes
  -> bounded layout job
  -> native SVG/HTML renderer
```

The model never outputs node coordinates or edge paths. It provides semantic structure and a preferred direction.

The existing renderer is plain DOM/custom elements. Do not add React Flow and another React runtime inside every iframe merely to obtain graph layout. Evaluate a lazily loaded graph-layout engine (ELK is a candidate) behind a small adapter; render with the existing design system. Choose the engine after testing cycles, fan-out, long labels, edge labels, and packaging/offline behavior.

### Proposed authoring example — not implemented syntax

```html
<x-flowchart direction="down">
A["Read the passage"] --> B{"Understand it?"}
B -->|Yes| C["Try a question"]
B -->|No| D["Ask about the annotation"]
D --> A
</x-flowchart>
```

This is a documented Mermaid-like **subset**, not a claim to support every Mermaid diagram or directive. Initially support labeled steps, decisions, start/end nodes, directed edges, branch labels, and loops. Reject unsupported styling/directives clearly. Preserve `x-mermaid` for existing content and diagram types outside the new native renderer.

Normalize to one graph representation. If a structured JSON/tool input is added later, it feeds the same representation, not a second renderer.

### Required UX behavior

- Inline: useful reading size, bounded height, obvious expand action; never horizontal overflow of the entire chat.
- Canvas: pan/zoom, reset/fit, keyboard controls; diagrams do not capture ordinary page wheel scrolling unless deliberately engaged.
- Fit-to-view may show an overview; if that makes labels too small, offer a readable focused view rather than implying the overview is sufficient.
- Long labels wrap and participate in layout measurement. Edge labels get space too.
- Theme colors and type match Quiet Paper; conventional shapes retain their semantic meaning.
- Text outline of nodes and connections is available without relying on pointer hover or color.
- Layout changes are stable and bounded; no complete graph jump on every token. Update on complete logical units and preserve a user's zoom/pan after they interact.
- Limit node count, edge count, label length, nesting, and layout time; move expensive layout off the UI thread if required.
- Layout failure preserves source and offers a readable relationship outline. Do not silently delete unknown edges.

## 8. State, identity, and updates

Separate definition, instance, serialized state, view state, and revision.

- Instance ID is independent of title and source text.
- Names are scoped to the block; child instances cannot steal one another's fields.
- Repeated items use stable keys. Reordering moves the identity, not just its visible label.
- Moving to Canvas retains the instance. Duplicating explicitly creates a new instance.
- An AI edit references an expected revision and stable node IDs. Detect conflict with user changes rather than blindly overwrite them.
- Host persistence stores serializable state, not DOM nodes, functions, handles, or credentials.
- Store draft/generated source separately from executable committed revisions.
- Never replay irreversible actions merely because history was reopened.

Migration review must include conversation branches, side threads, chat switching, and export/import. A branched conversation should not accidentally share writable state unless that sharing is explicit. Existing Canvas identity is source/spec based, so this cannot be fixed solely inside `elements.js`.

## 9. Backend reliability and permissions

Fix transport first, then consolidate—not a second execution system.

- One tested incremental NDJSON decoder: partial UTF-8, split records, multiple records per packet, final unterminated record, errors, cancellation, and bounded output.
- Each request is bound to a specific block instance/document revision and the actual iframe window, not just a self-reported frame label.
- Typed request/reply envelopes, request IDs, timeouts, cancellation, and visible execution states.
- Cancellation semantics differ for a short computation and a deliberately persistent process; define ownership explicitly.
- Keep API credentials server-side. Inputs are data, not string interpolation into Python/shell source.
- Reuse existing access ceilings. The presence of a sandbox label is not proof of OS isolation: `exec.ts` falls back when bubblewrap is unavailable. Untrusted code needs an explicit fail-closed or user-approved policy.
- Host process log access also needs scope/ownership review; read-only does not mean nonsensitive.
- Direct helpers, agent tool calls, and future template actions should not accidentally take different approval paths.
- Default declarative flowcharts and read-only layouts require no execution permission.

This proposal identifies boundaries for review; it is not a complete security audit.

## 10. Model ergonomics without prompt growth

The shipped prompt already encourages Blocks. Do not respond to poor results by indiscriminately adding more always-on instructions.

- Generated core reference: everyday elements, layout rules, and one small example.
- `ui_search`: relevant signatures/examples generated from the same registry.
- Load graph, science, backend, and advanced-state guidance on demand.
- Provide short positive examples of useful Blocks selection, plus cases where prose is better.
- Benchmark presentation selection separately from syntax and rendering. A model can generate a perfect block for a situation where no block helps.
- The model sees relevant state changes and compact summaries, not every input keystroke, poll, timer tick, or full document source.
- Check the active workspace prompt. Template migration intentionally preserves user-edited files, so the seed prompt does not guarantee the deployed prompt.
- Keep familiar HTML-like authoring initially. Compare new encodings only on actual target models with first-pass success, repair rate, latency, and token cost; do not optimize tokens alone.

## 11. Existing component improvement checklist

| Family | Primary work | Acceptance example |
|---|---|---|
| Layout/card/section | Independent weights, container adaptation, no root aside collisions | Explanation + timer + timeline reflows with no overlapping siblings |
| Lists/todos/timeline | Stable item IDs, local state, preserved focus, typed data | Toggle or reorder one item; all other values remain attached to their items |
| Forms/choices/tabs/decks | Scoped fields, validation, accessible selection and navigation | Two independent quizzes reuse local field names without contamination |
| Timer/clock/progress | Ownership, serializable time state, cleanup, accessible values | Move a running timer between views without restart or duplicate callbacks |
| Tables | Key-based cells, real CSV parsing, empty state, keyboard sort | Reordered/missing record keys never move values to the wrong columns |
| Charts/graphs | Data validation, measured labels, explicit scaling, accessible data alternative | Narrow view and long labels remain readable without distorting meaning |
| Flowcharts/diagrams | Semantic graph + layout + themed renderer | Branching/cyclic chart with long edge labels remains navigable |
| TikZ/science/media | Honest dependency/network states, stale-result protection, resource teardown | Failed renderer reports an error without blanking siblings or hanging forever |
| Backend-driven blocks | Framing, errors, cancellation, ownership and permission checks | Multi-record stream updates a table; stop cancels the intended owned work |

## 12. Implementation sequence and release gates

### A. Make failures permanent regression fixtures

Promote the reproduced cases into the real bench; keep expected behavior explicit. Add real TikZ compilation fixtures separately from the mocked component test. Capture a few actual model failures without depending on private PDFs.

**Gate:** known defects are reproducible; baseline results and test limitations are documented.

### B. Repair correctness in the existing implementation

NDJSON framing; table field mapping; scope leakage; keyed repetition; timer/observer cleanup; async stale-result protection; specific layout collision fixes. Ship compatible fixes independently of a new language/runtime.

**Gate:** regressions fail before and pass after; current unit and E2E suites remain green.

### C. Introduce the registry and stronger validation

Make metadata authoritative; validate complete documents and complete streamed units; structured diagnostics; unknown attributes/IDs/actions and malformed data no longer silently pass. Keep advanced legacy scripts in a clearly separate compatibility path.

**Gate:** examples and implementation agree; invalid output fails locally and recoverably.

### D. Build the native flowchart slice

Parser, graph checks, measured layout, native renderer, keyboard/zoom/expand, offline assets, bounded resource use. Integrate through existing `Block`/Canvas surfaces.

**Gate:** branching, loops, wide graphs, long labels, malformed references, small containers, resize, and interrupted streams all tested.

### E. Improve adaptive composition and durable instances

Shared runtime stress lab, container-local reflow, explicit weighted splits, scoped state and state-preserving view transitions. Persistence and migration need an app-level design review rather than a hidden global rewrite.

**Gate:** no state reset or value reassignment across resize, reorder, edits, reload, or supported surface moves; branches and historical content remain correct.

### F. Expand built-ins only after foundations pass

Polish existing families against the common checklist before adding more. Future domain packages use these same contracts. No marketplace infrastructure is required for the immediate release.

## 13. Playground and evaluation

The lab must use the production parser, registry, renderer, and bridge interfaces—not a standalone imitation later ported into the app.

Fixtures: Pomodoro, checklist, two forms with identical local field names, explanation + graph + controls, table with messy data, quiz deck, branching flowchart, and a future verified half-adder fixture.

Test widths from narrow docks to large canvases; preferred ratios 16:9, 9:16, 3:1, 1:3, and 1:4; enlarged text; light/dark; reduced motion; keyboard use; long/unbroken/localized labels; empty and large datasets; slow/error backends; partial output; repeated IDs and instances; unmount/remount; reorder; reload.

Check measurable invariants rather than promising “always beautiful at any size”:

- No unintended sibling overlaps or page-level horizontal overflow within supported bounds.
- No input value associated with the wrong item or form.
- No silent data reordering or fabricated zeros.
- All intended actions reachable by keyboard.
- No duplicate side effects, listeners, polls, or timer owners.
- Bounded rendering and layout work; record latency and memory baselines before setting final budgets.
- No regression in existing stored answers.

Mock fixtures test the runtime. Repeated real-model trials test the authoring SDK and prompt. Record first-pass validity, behavioral correctness, useful presentation selection, recovery success, tokens, and latency separately. A 31B-class model is an evaluation target, not a guarantee of capability based on parameter count.

## 14. Future ecosystem seam — design now, build later

Use a small shared manifest vocabulary for future blocks/workflows/domain modules: ID, version, description, tags, inputs/outputs, dependencies, capabilities, provenance/license, and tests. Reuse existing skill discovery concepts, but do not treat workflow instructions as executable UI or grant permissions through a manifest's claims alone.

Data-only templates should be easy to author without building the application. Executable renderer/backend extensions require a stronger trust path. Retrieval can offer short signatures; installing, opening, or merely matching a package must not execute it automatically.

This leaves room for community puzzle pieces without making a package manager or marketplace a prerequisite for reliable flowcharts today.
