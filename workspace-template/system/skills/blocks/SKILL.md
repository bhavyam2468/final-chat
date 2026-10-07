---
name: blocks
description: BlocksUI — how this app shows anything the user reads as data, compares, manipulates or keeps; components, reactive bindings, JS/Python logic, relational layout. Open before writing <ui>.
---
# BlocksUI
`<ui>` = HTML + x-* components + bindings + optional logic + `<style type="rel">` relations. The system owns all visuals (theme, spacing, radius, animation, responsiveness). Never write CSS, inline style, colors or px sizes. It streams: write `<style type="rel">` first, then data, then markup top-down, then `<script>`.

## When a block, and how much
The medium rules are in SYSTEM.md → Presentation; this file is how to write one. A block carries anything the user should read as data, compare, see drawn, work through, answer or keep — a markdown table, a list of numbers, a chart rendered to a file: blocks. Restraint applies to decoration, not to data: a sentence still beats a card, one number is not a chart, no badges/icons/stat-rows for show, never one element wrapped in a card.
Inline in the reply by default. The same markup works unchanged inside <canvas title="…"><ui>…</ui></canvas>; use canvas only for something the user keeps using outside the conversation.
Layout is automatic: each block takes a full line, adjacent buttons sit side by side at their own width, forms stack fields and keep buttons compact. Mark the main action button.primary (or type=submit). Async @click handlers show a spinner in their button.
Every name you use must exist (named input, x-state, data script, element id, or an assignment). Unknown names render as blank and are reported to the user as an issue.

## Components (attr=default; ui_search for details)
Layout: x-block[id title surface=plain|card x-data] x-split[weights="2:1" axis=horizontal|vertical min=240] x-stack x-row x-col x-grid[cols] x-card[title tone] x-section[title subtitle] x-divider[label] x-spacer
 x-tabs>x-tab[label] · x-deck[nav=numbers|dots|steps|none loop]>x-slide[label tone] (one view at a time; el.next() prev() go(i) .index .count; ←/→ keys; nav marks answered slides)
Text: native h1-h4 p small ul ol table details code a · x-md (markdown body) · x-code[lang] · x-callout[tone title] · x-kv ("Key: value" lines) · x-badge[tone] x-kbd x-icon[name=lucide]
Data: x-stat[value label delta unit] (counts up) · x-progress[value max tone] · x-ring[value max label] · x-gauge[value min max label]
 x-chart[type=line|bar|hbar|stacked|area|pie|donut|scatter|radar data labels series title x-label y-label center] data="1,2,3" multi "1,2|3,4" series="A|B"; scatter "x:y,x:y"; JSON ok ([{label,value}] or {series:[…]}). A series ≥50× smaller than the rest gets its own right axis automatically
 x-sparkline[data] · x-table[csv|data sortable] (or CSV/markdown rows as body) · x-heatmap[data="1,2|3,4" x-labels y-labels] · x-timeline (lines "date | title | detail")
Science: x-math[tex|body inline] · $..$ / $$..$$ in any text renders KaTeX
 x-graph[fn xmin xmax ymin ymax equal points legend height tmin tmax] interactive plot, pan/zoom/hover; shapes keep their true proportions at any width. fn lines/`;`: `y=a*sin(b*x)`, implicit `x^2+y^2=9`, polar `r=1+cos(theta)`, parametric `x=cos(t),y=sin(2t)`. Free letters (a,b,…) bind live to same-named inputs/state → sliders drive the graph. points="1,2,A;3,4"
 x-tikz[caption scale] body = TikZ (commands, tikzpicture or full document), server-rendered, theme-aware. circuitikz pgfplots tikz-cd chemfig tikz-feynhand; patterns arrows.meta calc positioning angles quotes. THE choice for physics (free-body, pulleys, inclines, optics), circuits and geometry: place labels with anchors (above/below/left/right=of) so nothing overlaps; draw ropes/strings explicitly
 x-smiles[smiles label] 2D structure · x-mol3d[name|cid|smiles|pdb still] 3D (PubChem/RCSB) · x-flowchart (native, see below); x-mermaid remains available for legacy/full Mermaid diagrams · x-draw[w h] diagram lines: rect x y w h "l" | circle x y r | dot x y | line/dashed/arrow x1 y1 x2 y2 "l" | mass x y "m" | pulley x y r | spring x1 y1 x2 y2 | incline x y w h | ground y | wall x | angle x y r deg1 deg2 "θ" | polygon x y x y… | curve x1 y1 cx cy x2 y2 | wave x1 y x2 amp cycles | lens x y h | resistor x1 y1 x2 y2 | battery x y | text x y "t" (quick sketches; prefer x-tikz for anything the user studies)
Time: x-timer[id seconds mode=down|up autostart keep-running] (.start() .stop() .toggle() .reset(s); .left .elapsed .running; events tick, done; :seconds="expr" re-arms on change, keep-running continues if it was running) · x-stopwatch · x-clock[time|seconds|for=timerId]
Inputs (all with name= are reactive vars): input(text|number|range|date|color|checkbox|radio) select textarea button[.primary tone=success|danger|ghost]
 x-segmented[name options value] · x-toggle[name checked] · x-rating[name max] · x-sortable[name] (body lines) · x-sketch[name] (value = PNG data URL) · x-upload[name accept multiple dir] (value = workspace path)
 x-todo[name title add] body lines "- [ ] task" / "- [x] done" (user ticks; add = user can append); .value [{text,done}] .done .total. For plans/checklists the user works through, not for your own progress (that is the todo tool)
 x-choice[name options="A|B|C" answer multi reveal lock layout=grid other skip] or option lines as body; .value .index .correct .answered; reveal shows right/wrong; other = type-your-own row; skip = Skip link (value "skipped")
Media: x-image[src caption] x-video[src] x-audio[src] x-youtube[id|url start] x-embed[src height] x-map[lat lng zoom markers="lat,lng,label|…"]. Workspace paths work as src.
State: <x-state score="0" done="false" picks="{}"> (JSON-parsed initial values)

## Bindings (evaluated as JS; re-run on any change)
{{expr}} in text/attributes · :attr="expr" (:text :class="{on: x}" :value :checked :disabled :hidden) · show="expr"
each="item in list" / "(q, i) in qs" / "n in 5" (repeats element; locals item,i). Use :key="item.id" for editable/reorderable items, including <template x-for="item in items" :key="item.id">; keys must be unique strings/numbers.
@click="stmts" (@input @change @submit @done @tick …; event, el available; async ok) · on="click:fnName" (JS or Python function)
Scope: named inputs, x-state, <script type="data" name="qs">[json]</script> vars, element ids (#t → t.start()), assignments create state (`score = score + 1`).
Helpers: fmt(sec)→mm:ss sum avg count(arr,fn) pct(a,b) round(x,d) clamp range(n) pick shuffle len now date time json + Math.*
 sendToLm(obj|str, "Label"|{label,prompt}) → <ui_event> to you (only on explicit user action; label = what chat shows, prompt = your instruction for the reply). No-JS: <form lm="Submit answers" lm-prompt="Grade and explain mistakes"> sends its inputs; <button lm="Explain" lm-prompt="…"> sends inputs of its card/section · saveIn(path, text|obj) → workspace file · py(code)→stdout (server Python) · shell(command, opts) / processRun(command, opts) → sandboxed `{ok,code,out}` · processLogs(name, {follow:true}) → tail an existing agent process (including a host process started with explicit Host terminal access) without launching a new host command · backend(kind, input, opts) for `python|bash|process|resource` · backendStream(kind, input, onChunk, opts) for live stdout/snapshots · resource() → one system snapshot · watchResources(ms, "resources") → live `resources.history.cpu|memory|load` for charts
 form(sel?) → {name:value} · notify(text) · every(ms,fn) after(ms,fn) · open(pathOrUrl) → canvas · state(k,init)

## Logic
<script> JS: top-level functions/vars are global and callable from bindings. Runs after markup finishes. Use `backendStream` when a Bash/Python/process producer should paint rows or chart points as output arrives; parse newline-delimited JSON in the callback and assign state instead of writing a backend-specific chart component.
<script type="python"> (Pyodide; numpy/pandas/sympy auto-load): S (state: S.score), el(sel), els(sel), form(), send_to_lm(d), save_in(p,t), notify(t), every(ms,f), after(ms,f), render(). Bind with on="click:fn". Use Python only when numerics need it; server Python/Bash access is through the backend bridge above.

## Relations <style type="rel">
selector { prop: value } · selectors: .class #id tag root · nesting `.a { .b {} }` · `portrait { … }` `landscape { … }` overrides
weight positive-number (space only) · type caption|body|title|display (typography only) · size xs|s|m|l|xl|xxl or 1..5 (legacy coupled scale; preserved for old blocks) · orient horizontal|vertical · group name (siblings share a row, wrap in portrait) · place top|bottom|center|start|end (start/end = side column on wide screens) · columns n|auto · span n · width fill|hug · max narrow|medium|wide|full · align start|center|end · gap tight|normal|loose · density compact|comfortable · emphasis low|high · tone accent|success|danger|warning|info|neutral · sticky top|bottom · ratio square|wide|tall · hide true

## Composition notes
Multi-step/paged flows: x-deck with one x-slide per step; a result slide shown via show="submitted". Timed tests: x-timer autostart @done="submit()". Scoring: x-choice answer=… then `$$('x-choice').filter(c => c.correct).length`. Reveal after submit with `:reveal="submitted"`. Send results with sendToLm only if the user should get analysis.
Canvas-sized tools: <canvas title="Name"><ui>…</ui></canvas>. Fill-screen layouts adapt to portrait/landscape via rel.
Keep data in <script type="data"> JSON, not repeated markup. Short semantic class names.


## Native flowcharts
Use `x-flowchart`, not hand-placed coordinates, for process/decision diagrams. Native surfaces and typography; layout is calculated in a worker. Example:

<ui><x-flowchart title="Study loop" direction="right">
A("Read") --> B{"Understood?"}
B -->|Yes| C["Practice"]
B -->|No| A
</x-flowchart></ui>

Shapes: ID["Step"], ID{"Decision"}, ID("Terminal"). Arrows: `-->` or `-->|label|`. Separate statements with newlines/semicolons. Optional `flowchart TD|LR|BT|RL` header. Define every node explicitly at least once. IDs are unique; repeat a reference without redefining its label. Labels are plain text, not HTML; escape HTML-sensitive characters. No styling directives, subgraphs, HTML labels, or scripts. Limits: 100 nodes, 200 edges, 200 characters per label. Split larger graphs into meaningful blocks. JSON is also accepted: `{nodes:[{id,label,kind:"step|decision|terminal"}],edges:[{from,to,label?}]}`. `:data="json(graph)"` updates a graph.

Wide graphs stay readable instead of shrinking to unreadable text. The user can pan, zoom, Fit, Reset, and open the text outline. Keyboard: arrow keys pan, +/- zoom, F fits, Home resets; focus a node and Enter to center it. A malformed update retains the previous drawing and reports the problem. Flowcharts do not validate circuit behavior; use the appropriate domain representation for circuits.

## Composed blocks and adaptation
An **element** is one functional part (timer, button, progress indicator); a **block** composes elements into a useful tool. Nest `x-split` horizontally/vertically for proportional arrangements. It measures its own available width, stacking children when their minimum widths cannot fit. Weights allocate space without changing font sizes. `x-grid` also responds to its own width. Avoid fixed viewport grids.

Wrap independently reusable tools in `<x-block id="stable-name" x-data="{count:0}">…</x-block>`. Local state, named inputs, form() and $refs resolve inside that block. Give DOM IDs unique names across the whole document; use local `x-ref` for reusable internal references. Nested x-data groups inherit their parent's state; writes to inherited declared keys update the parent. Top-level legacy x-data still exposes its first group as a global alias for old documents. Explicit x-blocks do not export implicit globals. Plain scripts, arbitrary JS, Python, and backend helpers are still supported.

Backend requests return a promise with `.cancel()`; pass `{signal: controller.signal}` as opts for AbortController cancellation. Cancellation/unmount closes the stream and stops invocation-owned subprocesses; cancelling a named-process log subscription only stops tailing, not the existing process. The configured workspace execution policy still applies; without bubblewrap the app's sandbox is **not** OS-enforced isolation.

The **Blocks lab** at `/blocks/playground.html` uses the production iframe runtime: editable examples, local catalog search, portrait/landscape/extreme sizes, nested compositions, live state, theme changes, source export, diagnostics, and explicitly opt-in backend execution. Run resets the instance; resizing does not. Chat's “Open a copy in canvas” creates a new independent instance; persistent state transfer/remount serialization is not provided yet.
