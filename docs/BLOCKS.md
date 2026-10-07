# BlocksUI

BlocksUI is the language the model writes inside `<ui>…</ui>` to produce interactive interfaces in chat and canvases. It's HTML with four additions:

1. **Components** (`x-*` tags) for things HTML lacks: charts, graphs, decks, quizzes, timers, molecules, diagrams.
2. **Bindings**: `{{expr}}`, `:attr`, `show`, `each`, `@event`. They make markup reactive without framework code.
3. **Logic**: `<script>` in JS, or `<script type="python">` through Pyodide, with a small helper API that reaches the chat (`sendToLm`), workspace (`saveIn`, `py`) and sandbox backends (`backend`, `shell`, live resource snapshots).
4. **Relations**: `<style type="rel">` describes *how things relate* (size, grouping, placement, orientation) instead of *how they look*.

The runtime owns every visual decision (theme, radius, spacing, typography, motion, responsiveness), so any combination the model writes looks like it belongs to the app. Models never write CSS.

Files: `public/blocks/runtime.js` (streaming parser, bindings, relations, helpers), `public/blocks/elements.js` (components), `public/blocks/runtime.css` (the design system). The model's quick reference is `workspace-template/system/skills/blocks/SKILL.md` (~2k tokens; the everyday blocks are also taught directly in SYSTEM.md and those examples are part of the e2e bench), and `ui_search` serves per-component detail from `src/lib/blocks/catalog.ts`.

## Design principles

- **Fundamentals, not templates.** Components are primitives and wrappers (a timer, a deck, a choice), never finished apps (a "pomodoro", a "quiz"). Composition makes the app. That keeps the surface small enough for a 16k-context model and open-ended enough for anything.
- **Existing is not a reason to use.** The skill and system prompt tell the model to use the fewest components that do the job, and to prefer text when text is enough.
- **Stream-stable.** Markup renders as it arrives:
  - Containers open immediately and fill in.
  - Leaf components show a skeleton matched to their shape until their closing tag arrives, then render once.
  - Nothing that has rendered is re-rendered by later chunks, so nothing jumps.
  - Put `<style type="rel">` and data first so layout is known before content lands.
- **Relative, not absolute.** Sizes are weights (`size: 3x`) and positions are relations (`place: start`, `group: controls`). The same UI works in a narrow docked canvas, a wide window, portrait or landscape.
- **Token-frugal.** Short attribute names, CSV/pipe data formats, JSON only when structure needs it.

## Anatomy

```html
<ui>
<style type="rel"> .plot { size: 3x } .ctl { group: sliders } </style>
<script type="data" name="pts">[[0,1],[1,3]]</script>
<x-state n="0"></x-state>

<x-graph class="plot" fn="y=a*sin(x)"></x-graph>
<label class="ctl">a = {{ a }} <input type="range" name="a" min="0" max="3" step="0.1" value="1"></label>

<script> function reset() { a = 1 } </script>
</ui>
```

## Components

The default attribute values are shown where they matter. All components accept `class`, `id`, `tone` (`accent|success|danger|warning|info|neutral`) and bindings.

### Layout
| Tag | Notes |
|---|---|
| `x-stack` `x-row` `x-col` | Flow containers. `x-row` wraps; `x-stack` picks row or column from available width |
| `x-grid cols="3"` | Collapses to ≤2 columns in portrait |
| `x-card title tone` | Bordered group; `title` is reactive |
| `x-section title subtitle` | Headed region |
| `x-divider label` · `x-spacer` | Rule; flexible gap (pushes siblings apart in a row) |
| `x-tabs > x-tab label` | Tabbed views. `.index` |
| `x-deck nav loop > x-slide label tone` | One view at a time: pages, wizards, question papers, flashcards. `nav="numbers|dots|steps|none"`. API: `.next() .prev() .go(i) .index .count`; ←/→ keys; nav marks slides whose inputs are answered |

### Text
Native `h1–h4 p small ul ol table details code a` are styled. Also:
- `x-md` renders a markdown body.
- `x-code lang` shows highlighted code with copy.
- `x-callout tone title` is a note, tip or warning box.
- `x-kv` takes `Key: value` lines.
- `x-badge`, `x-kbd` and `x-icon name` (lucide names) are small inline elements.

`$…$` and `$$…$$` render KaTeX in any text. That includes bound text, which re-typesets when its value changes.

### Data
| Tag | Notes |
|---|---|
| `x-stat value label delta unit` | Counts up on change |
| `x-progress value max` · `x-ring value max label` · `x-gauge value min max label` | Progress and meters |
| `x-chart type data labels series title x-label y-label center` | `line bar hbar stacked area pie donut scatter radar`. `data="1,2,3"`, multi-series `"1,2|3,4"` with `series="A|B"`, scatter `"x:y,x:y"`, or JSON. Draw-in animation; hover values |
| `x-sparkline data` | Inline trend |
| `x-live name lang every parse label unit show` | A live variable. Its producer — the element's content, or `code=` — runs every `every` (default `1s`) through the sandbox and keeps `S.‹name›` current: `.value`, `.history` (≤120 points), `.at`, `.ok`, `.error`. `parse="number"` (last number on the last line, the default) `"json"` `"text"`; a failed read keeps the last good value and shows the message in its place. Feed `x-sparkline`/`x-chart` with `:data="ram.history"` |
| `x-table csv|data sortable select total caption height dense cols` | A real data table. Body may be CSV, TSV, markdown pipes or pasted output (quoted fields keep commas); `csv=` or `:data` (array of objects or arrays) also work. Numeric columns are detected and right-aligned automatically (`cols="l,r,c"` forces a column), `**bold**` renders, signed values colour. `sortable` = click/focus+Enter a header, ascending → descending, with the caret showing where it is. `select` makes rows pickable: `.value` is the row as an object and a `select` event fires. `total="sum|avg|count"` (optionally `total="time,memory"`) pins a totals row that keeps the column's unit; a table over ~14 rows — or any `height=` — scrolls inside its own panel with the header and totals held. `caption` sits above |
| `x-heatmap data x-labels y-labels caption tone min max values` | A matrix read for its pattern: `data` is rows separated by `|` (or a JSON array of arrays), intensity carries the value, each cell names its row and column, and the numbers are printed inside the cells when the matrix is small (or with `values`). `min`/`max` fix the scale so two heatmaps compare |
| `x-timeline` | `date | title | detail` lines |

### Structure
| Tag | Notes |
|---|---|
| `x-flow dir caption height` | A flowchart that is drawn by the app itself, not by a diagram library. Node lines are `id "Label" :kind` with `start end decision step io note` (`process`/`task`→step, `question`→decision, `data|input|output`→io, `event|terminal`→start; a kind is optional — labels like *Start*/*Done* infer one, and a well-formed graph infers its source and sink). Edges are `a -> b "label"` with an optional `dashed`, and chains (`a -> b -> c`) are allowed. Mermaid spellings — `flowchart LR`, `A[Start]`, `A{Valid?}`, `A((Done))`, `A[/Reject/]`, `A -->|yes| B`, `A -- no --> B` — parse to the same native nodes, so the habit a model slips into still renders correctly. `dir` is `tb lr bt rl` or `auto` (left-to-right on a wide block). Clicking a node sets `:active` and emits `select`. The whole node body may also be bound: `<x-flow text="{{src}}">` |
| `x-tree collapse` | The same view, hierarchy from indentation (2 spaces or one tab per level). `Label | detail` adds a second line; `collapse` folds a branch when the user clicks it |
| `x-list name markers select dense` | An outline: indented rows, `Label | detail | meta`, chevrons fold branches. `markers="dot|number|dash|none"`. With `select="single|multi"` a row pick sets `.value`/`.values` and emits `select` |

Flowcharts and trees are not squeezed to fit: a drawing wider than its block keeps its true size and is explored by dragging, with zoom on ⌘/Ctrl+wheel, `+`/`−` and a **Fit** button — a 20-node process stays legible in a narrow chat. Keyboard: ↑/↓ move a list row, Enter picks it. A view the reader has panned or zoomed survives a re-render of the same block (streaming updates never move the diagram under their eyes); the `fit` attribute re-fits on every render instead. Parsing and layout are pure code in `public/blocks/graph.js` (`Blocks.parseFlow`, `Blocks.parseTree`, `Blocks.graphLayout` — layered/Sugiyama placement with barycentre ordering, back edges routed around the drawing), unit-tested in `dev/tests/graph.test.mjs`; `public/blocks/elements.js` only draws it.

### Science
| Tag | Notes |
|---|---|
| `x-math tex inline` | Display or inline LaTeX |
| `x-graph fn xmin xmax ymin ymax equal points legend height` | Desmos-style plot with pan, zoom and hover readout. See the notes below |
| `x-smiles smiles label` | 2D structure from SMILES |
| `x-mol3d name|cid|smiles|pdb still` | Rotatable 3D structure (PubChem/RCSB) |
| `x-mermaid` | Flowchart, sequence, mindmap and similar diagrams, from the body text |
| `x-draw w h` | Diagram mini-language, one primitive per line. See the list below |

`x-graph` details:
- Functions are separated by lines or `;`: `y=f(x)`, `r=f(theta)` (polar), or `x=f(t),y=g(t)` (parametric).
- Free letters bind live to same-named inputs or state, so a slider named `a` drives `y=a*sin(x)`.
- `points="1,2,A;3,4"` plots labelled points.

`x-draw` primitives:
- Shapes: `rect`, `circle`, `dot`, `polygon`, `curve`, `text`.
- Lines: `line`, `dashed`, `arrow`, `angle`.
- Mechanics: `mass`, `pulley`, `spring`, `incline`, `ground`, `wall`.
- Waves, optics, circuits: `wave`, `lens`, `resistor`, `battery`.

### Time
- `x-timer id seconds mode=down|up autostart`:
  - Methods: `.start() .stop() .toggle() .reset(s)`.
  - Properties: `.left .elapsed .running`.
  - Events: `tick` and `done`.
- `x-stopwatch` counts up.
- `x-clock` shows a live analog clock. `time=` shows a fixed time; `for="timerId"` mirrors a timer.

### Inputs
Any element with `name=` becomes a reactive variable of the same name.
- **Native elements:** `input` (text, number, range, date, color, checkbox, radio), `select`, `textarea`, and `button tone`.
- **`x-choice name options answer multi reveal lock layout`**:
  - Options come from a pipe list or from body lines.
  - `answer` can be the option text, a letter, or a 1-based index.
  - Read state with `.value .index .correct .answered`.
  - `reveal` marks options right or wrong; `lock` freezes the answer.
- **Other components:**
  - `x-segmented`, `x-toggle` and `x-rating` are simple pickers.
  - `x-sortable` takes body lines; its value is the array in the current order.
  - `x-sketch`'s value is a PNG data URL.
  - `x-upload accept multiple dir`'s value is the workspace path of the upload.

### Media
- Players and images: `x-image src caption`, `x-video`, `x-audio`, `x-youtube id|url start`.
- Embeds: `x-embed src height` (iframe), `x-map lat lng zoom markers`.
- Workspace paths work as `src`.

### State
`<x-state score="0" picks="[]">`: initial values are JSON-parsed.

## Bindings

| Syntax | Meaning |
|---|---|
| `{{ expr }}` | Text or attribute interpolation |
| `:attr="expr"` | Bind an attribute or property (`:value :checked :disabled :hidden :text :class="{on: x}"`). `false`/`null` removes the attribute |
| `show="expr"` | Toggle visibility |
| `each="item in list"` · `"(q, i) in qs"` · `"n in 5"` | Repeat the element with locals |
| `@click="stmts"` | Any event (`@input @change @done @tick …`); `event` and `el` in scope; async allowed |
| `on="click:fn"` | Call a named JS or Python function |

- **Scope lookup order:** loop locals → state → named inputs → `<script type="data" name>` data → helpers → element ids (`#clock` → `clock.stop()`) → globals.
- **Assignments** in handlers (`score = score + 4`) write to state.
- **Plain `<script>` code shares that state:** state keys and data vars are mirrored on `window`, so `submitted = true` in a function re-renders the bindings.
- **Re-rendering** happens once per animation frame after any input, event, timer tick or state write.

**Helpers:**

| Group | Helpers |
|---|---|
| Formatting and math | `fmt(sec)` (mm:ss), `sum`, `avg`, `count(arr, fn)`, `pct(a, b)`, `round(x, d)`, `clamp` |
| Collections and time | `range(n)`, `pick`, `shuffle`, `len`, `now`, `date`, `time`, `json` |
| Chat and workspace | `sendToLm(obj|str, label|{label, prompt})`, `saveIn(path, text|obj)`, `py(code)` |
| Backends | `backend(kind, input, opts)` for `python`, `bash`, `process`, `resource`, `lang` (any language the sandbox has — `node`, `ruby`, `go`, `c`, `lua`, `r`…: the snippet is written into `<workspace>/.blocks/` and its interpreter runs it, so an unknown one comes back as a sentence rather than a blank); `shell(command, opts)` / `processRun(command, opts)` launch sandbox work; `processLogs(name, {follow:true})` tails an existing agent process (including explicitly host-started processes); `backendStream(kind, input, onChunk, opts)` forwards live stdout/snapshots; blocks never launch arbitrary host commands |
| Live system data | `resource()` returns one snapshot; `watchResources(ms, key)` maintains `key.history.cpu`, `key.history.memory`, and `key.history.load` for `x-chart` / `x-sparkline`; `live(key, {lang, code, produce, parse, every, stream})` is the general form — one shell line, a Python/Ruby/Node producer, or a function — and returns a `stop()` |
| Page utilities | `form(sel?)`, `notify(text)`, `every(ms, fn)`, `after(ms, fn)`, `open(pathOrUrl)`, `state(k, init)`, `$`, `$$` |

Numbers that come from the machine are live variables, not prose. The producer runs in the sandbox; the element only paints what it returns, and says so when the producer breaks:

```html
<x-live name="ram" lang="bash" every="1s" label="RAM" unit="%">free -m | awk '/Mem:/{printf "%.1f", $3/$2*100}'</x-live>
<x-sparkline :data="ram.history"></x-sparkline>
```

```js
// the same thing from a script: any language, any shape
live("heap", { lang: "node", parse: "json", every: 1000, code: 'console.log(JSON.stringify({ value: Math.round(process.memoryUsage().heapUsed / 1048576), unit: "MB" }))' });
// S.heap.value · S.heap.history · S.heap.ok · S.heap.error   (produce: () => … is the testable seam)
```

`sendToLm` posts a `<ui_event>` into the chat as the user's next turn. The chat shows `label` as a compact card (fields collapsible) and passes `prompt` to the model as the instruction for its reply, so a button can invoke the AI with custom context:

```html
<form lm="Check my essay" lm-prompt="Grade against the rubric; list the 3 biggest fixes">
  <textarea name="essay"></textarea><button>Submit</button>
</form>
<button lm="Explain this setting" lm-prompt="Explain what a={{a}} does to the curve">Why?</button>
```

`form[lm]` sends its named inputs on submit; `button[lm]` outside a form sends the inputs of its nearest card/section/slide. No script needed. `py` runs server-side Python in the workspace and returns stdout. For live producers, `backendStream("bash", command, chunk => { log += chunk })` forwards stdout as it arrives; parse newline-delimited JSON when the producer emits structured rows and bind those rows to a normal `x-table` or `x-chart`. The bridge never grants a block host-terminal access.

## Logic

- **`<script>`** runs once the markup is complete. Its top-level functions become global and are callable from bindings.
- **`<script type="python">`** runs in Pyodide, which loads on demand (numpy, pandas and sympy auto-load).
  - Scope: `S` (state), `el(sel)`, `els(sel)`, `form()`, `send_to_lm(d)`, `save_in(p, t)`, `notify(t)`, `every(ms, f)`, `after(ms, f)`, `render()`.
  - Bind functions with `on="click:fn"`.

## Relations: `<style type="rel">`

`selector { prop: value }`:
- **Selectors:** `.class`, `#id`, `tag`, `root`.
- **Nesting:** `.a { .b { … } }`.
- **Orientation overrides:** `portrait { … }` and `landscape { … }`, evaluated against the canvas or block's own shape, not the screen.

| Property | Values | Effect |
|---|---|---|
| `size` | `xs s m l xl xxl` or `1..5` / `3x` | Relative weight: flex share, scale of text, charts and clocks |
| `orient` | `horizontal` `vertical` | Direction of children; `horizontal` on a leaf spans the row |
| `group` | name | Siblings with the same group share a row (wrapping in portrait) |
| `place` | `top bottom center start end` | Order, or a side column (`start`/`end`) on wide layouts sized by `size` |
| `columns` / `span` | `n` `auto` | Grid layout |
| `width` / `max` | `fill hug` / `narrow medium wide full` | Width behaviour |
| `align` | `start center end` | Alignment |
| `gap` / `density` | `tight normal loose` / `compact comfortable` | Spacing |
| `emphasis` | `low high` | Visual weight |
| `tone` | `accent success danger warning info neutral` | Semantic colour |
| `sticky` | `top bottom` | Stays in view while scrolling |
| `ratio` | `square wide tall` | Aspect ratio |
| `hide` | `true` | Hide (useful in `portrait {}`) |

## Composition example: a timed mock test

The model builds this from primitives: data, a deck of slides generated with `each`, `x-choice` with answers, a timer that submits on `done`, and a result section with stats, a stacked chart and per-question cards. The same pieces make flashcards, surveys, lab worksheets or onboarding flows. The runnable version is the "jee mock test" scenario in `dev/mock-llm.mjs` (developer mode: `__dev.enable(); __dev.mock()`).

```html
<canvas title="JEE Main mock 1" dock>
<ui>
<style type="rel"> .bar { sticky: top } .stats { columns: 3 } </style>
<script type="data" name="qs">[{"s":"Physics","t":"Laws of motion","q":"A block slides down a smooth incline of angle $\\theta$. Its acceleration is","o":["$g$","$g\\sin\\theta$","$g\\cos\\theta$","$g\\tan\\theta$"],"a":"B"}]</script>
<x-state submitted="false" res="[]" picks="[]"></x-state>
<x-row class="bar"><h3>Mock 1</h3><x-spacer></x-spacer><x-timer id="clock" seconds="3600" autostart @done="submit()"></x-timer></x-row>
<x-deck id="deck" nav="numbers" show="!submitted">
  <x-slide each="(q, i) in qs">
    <p>{{ q.q }}</p>
    <x-choice :name="'q' + i" :options="q.o.join('|')" :answer="q.a" :reveal="res.length > 0"></x-choice>
    <button tone="accent" @click="i === qs.length - 1 ? submit() : deck.next()">Next</button>
  </x-slide>
</x-deck>
<x-section show="submitted" title="Result">
  <x-stat :value="score" label="Score"></x-stat>
  <x-card each="(q, i) in qs" :tone="res[i] ? 'success' : 'danger'" :title="q.t">You: {{ picks[i] || 'skipped' }}</x-card>
  <button @click="sendToLm({ score, res })">Analyse my attempt</button>
</x-section>
<script>
function submit() {
  clock.stop();
  const cs = $$('x-choice');
  res = cs.map(c => c.answered ? c.correct : null);
  picks = cs.map(c => c.value);
  score = res.reduce((a, r) => a + (r === true ? 4 : r === false ? -1 : 0), 0);
  submitted = true;
}
</script>
</ui>
</canvas>
```

## Extending

Components are registered with `Blocks.define(tag, class extends Blocks.Base { init() {} render() {} }, { container?, void? })`:
- `render()` runs whenever the element's attributes change, batched per frame.
- `static owns = true` means the element consumes its body text as source (`this._src`), like `x-draw` or `x-choice`.
- Dispatch `change` for value changes so bindings update.

Add a catalog entry in `src/lib/blocks/catalog.ts`, and add one line to the skill only if the component is fundamental.
