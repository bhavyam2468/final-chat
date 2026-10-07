# Blocks: implementation and verification

Implemented 2026-10-07. This is the shipped subset of [the overhaul review](BLOCKS-OVERHAUL.md), not a claim that every proposed future phase is complete.

## What changed

- **Native flowcharts:** `x-flowchart`, Mermaid-like bounded syntax or JSON, real ELK layered/orthogonal layout in a lazy-loaded local worker, measured/wrapped node and edge labels, app theme tokens, readable initial scale for wide graphs, pan/zoom/Fit/Reset, keyboard interaction, node selection and text outline. Parse/layout errors retain the last good drawing. Stale layout results cannot overwrite a newer graph. Worker execution is bounded to eight seconds. ELK is the only added runtime dependency; the app does not load it unless a flowchart is used. Existing `x-mermaid` remains available.
- **Composition:** `x-block` provides an explicit local state/input/reference boundary. Nested `x-split` uses space ratios and its own available width, not a viewport grid. `x-grid` now measures its own width. `weight` and `type` separate allocation from typography. Legacy `size` behavior is preserved. Multiple aside cards no longer occupy the same grid cell.
- **Correctness:** keyed editable lists retain DOM nodes, input values and focus; independent x-data groups no longer share initial values; form collection stays inside the selected form; object-table rows use a consistent union of header keys; quoted CSV handles commas, escaped quotes and multiline fields. Existing lists, todos, forms, quizzes, decks, charts and timers remain covered by the original browser bench.
- **Lifecycle/accessibility:** timer intervals stop on removal; shared observers and document listeners clean up; layout/plot/sketch observers reconnect safely; async diagram/media results reject stale updates; molecule spinning and maps dispose on removal. Tables sort from the keyboard; tabs have keyboard navigation/selection state; progress and switches expose values; reduced-motion rules apply across elements.
- **Contracts:** browser validation, server repair checks, searchable signatures and playground search share `public/blocks/schema.js`. Validation covers unknown elements, custom-element balance, duplicate IDs, numeric bounds/enums, parent rules, weights and graph semantics. Registry-to-renderer parity is tested. Native inputs, bindings and backend helper signatures remain searchable. This is a lightweight authoring validator, **not an HTML sanitizer or a JS sandbox**.
- **Backend:** one bounded incremental UTF-8/NDJSON decoder shared by app/lab/tests; final unterminated records and arbitrary chunk boundaries work. Host verifies source window; invalid request bodies/paths fail cleanly; abort signals and stream cancellation propagate. Requests have `.cancel()` and accept AbortSignal. Output chunks are split without discarding their tails. Upload MIME metadata no longer overwrites the bridge message type. POSIX invocation-owned process groups terminate on cancel/timeout; UTF-8 subprocess output is decoded incrementally. Existing backend/JS/Python functionality is preserved.
- **Playground:** `/blocks/playground.html`, using the real production runtime in the same opaque-origin sandbox. Editable functional examples, nested composition, local catalog search, resizing/presets, dark/light theme, diagnostics, copying/exporting source. Backend execution is explicitly off until enabled. Chat/open/save/upload actions are logged, not executed.

## Quick examples

```html
<x-flowchart title="Study loop" direction="right">
A("Read") --> B{"Ready?"}
B -->|Yes| C["Practice"]
B -->|No| A
</x-flowchart>
```

```html
<x-split weights="2:1" min="240">
  <x-block id="practice" x-data="{count:0}">
    <button @click="count++">Practice: {{count}}</button>
  </x-block>
  <x-block id="focus" x-data="{count:10}">
    <button @click="count++">Focus: {{count}}</button>
  </x-block>
</x-split>
```

Each block owns `count`. Nested x-data inherits declared parent state. Top-level legacy x-data still exposes its first group's values to sibling scripts/bindings for compatibility. Plain script globals remain global. DOM IDs must be unique; use `x-ref` for local repeated references. Use `:key="item.id"` for editable/reorderable repeats.

## Run the checks

```sh
for f in dev/tests/*.ts; do
  node --experimental-strip-types --no-warnings "$f" || exit 1
done
npm run typecheck
npm run build

# Set CHROME to a local Chrome/Chromium executable.
CHROME=/path/to/chromium node dev/blocks-e2e.mjs
# Or install @sparticuz/chromium locally (without adding a production dependency),
# or provide CHROMIUM_MODULE=/absolute/path/to/its/entry.js.

npm run start -- --hostname 0.0.0.0
# In another shell; uses the real app, no model/provider calls:
CHROME=/path/to/chromium node dev/blocks-app-e2e.mjs
```

`BLOCKS_URL` changes the app-test origin (default http://127.0.0.1:3000). Browser-facing preview code uses same-origin paths and the actual app origin, never a sandbox localhost URL. The browser tests themselves execute inside the development machine. `SHOT=directory` captures standalone bench screenshots; `SHOT=file.png` captures the app test.

The standalone bench preserves the earlier TikZ HTTP fixture; it **does not** claim real TeX compilation or circuit correctness. New flowchart tests use the actual ELK API and worker, not mocked diagrams. The app test verifies an opaque-origin iframe, local vendor delivery, state surviving resize/theme, message-source rejection, backend opt-in, real Python/Bash streaming, invalid input and cancellation of shell descendants. It creates a uniquely named temporary marker only to detect a surviving cancelled child and cleans it up.

## Boundaries and remaining work

- No marketplace, community SDK, template package manager or verified digital-circuit library.
- No default immersive editor or Canvas editor rewrite. Existing Markdown/code/PDF workflows are unchanged.
- Opening an inline block in Canvas makes a **new independent instance**. The action now says “Open a copy in canvas”; live instance transfer, durable state serialization and reload recovery remain unimplemented.
- Flowcharts support step/decision/terminal nodes, directed/labeled edges, cycles, disconnected nodes and direction changes. They are not full Mermaid: no subgraphs, styling directives, sequence grammar or circuit simulation. Native labels use plain text; escape HTML-sensitive source characters.
- Local browser/runtime tests and the app build do not establish reliability across every possible user script, all browsers, arbitrary third-party data, or real 31B model generation. No comprehensive whole-app security audit was performed. Actual provider/model adoption still needs evaluation.
- External maps/molecules keep their existing network requirements. General JS and backend execution retain the application's current permissions; without bubblewrap the workspace sandbox is not OS-enforced isolation. Cancellation on Windows cannot offer POSIX process-group guarantees.
- System/skill **seed files** were updated, without expanding the default prompt into a full catalog. Existing user-edited workspace prompts are not overwritten; they must opt into the updated reference through the app's normal defaults workflow.

See the repository tests for executable acceptance cases; see the original review for subsequent architecture work rather than treating this increment as the entire long-term platform.

## Verification recorded for this increment

- **86/86 standalone browser checks passed** (52 existing checks + 34 regression checks, inline and Canvas variants).
- **9/9 unit-test files passed**, including the new shared-contract/flow-parser/registry/NDJSON suite and all eight existing suites.
- Real-app integration checks passed against the **production Next server**, including ELK in an opaque-origin iframe, real Python/Bash output, Unicode, opt-in execution, and cancellation of child processes.
- TypeScript typecheck, production build, targeted ESLint and `git diff --check` passed.
- The playground was visually inspected; explicit iframe background painting fixes white browser canvases with dark-theme text. Diamond edge endpoints are projected onto the actual diamond rather than stopping at its bounding box.
