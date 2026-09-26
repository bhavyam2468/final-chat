---
name: blocks
description: BlocksUI language for <ui>: components, reactive bindings, JS/Python logic, relational layout. Open before writing <ui>.
---
# BlocksUI
`<ui>` = HTML + x-* components + bindings + optional logic + `<style type="rel">` relations. The system owns all visuals (theme, spacing, radius, animation, responsiveness). Never write CSS, inline style, colors or px sizes. It streams: write `<style type="rel">` first, then data, then markup top-down, then `<script>`.

## Restraint
A component existing is not a reason to use it. Use <ui> only when interaction, visualization or live state beats text. Pick the fewest components that do the job; a sentence beats a card, a table beats a chart for <6 numbers. No decorative badges/icons/stats. Never wrap one element in a card.

## Components (attr=default; ui_search for details)
Layout: x-stack x-row x-col x-grid[cols] x-card[title tone] x-section[title subtitle] x-divider[label] x-spacer
 x-tabs>x-tab[label] · x-deck[nav=numbers|dots|steps|none loop]>x-slide[label tone] (one view at a time; el.next() prev() go(i) .index .count; ←/→ keys; nav marks answered slides)
Text: native h1-h4 p small ul ol table details code a · x-md (markdown body) · x-code[lang] · x-callout[tone title] · x-kv ("Key: value" lines) · x-badge[tone] x-kbd x-icon[name=lucide]
Data: x-stat[value label delta unit] (counts up) · x-progress[value max tone] · x-ring[value max label] · x-gauge[value min max label]
 x-chart[type=line|bar|hbar|stacked|area|pie|donut|scatter|radar data labels series title x-label y-label center] data="1,2,3" multi "1,2|3,4" series="A|B"; scatter "x:y,x:y"; JSON ok
 x-sparkline[data] · x-table[csv|data sortable] (or CSV/markdown rows as body) · x-heatmap[data="1,2|3,4" x-labels y-labels] · x-timeline (lines "date | title | detail")
Science: x-math[tex|body inline] · $..$ / $$..$$ in any text renders KaTeX
 x-graph[fn xmin xmax ymin ymax equal points legend height] interactive plot, pan/zoom/hover. fn lines/`;`: `y=a*sin(b*x)`, `r=1+cos(theta)`, `x=cos(t),y=sin(2t)`. Free letters (a,b,…) bind live to same-named inputs/state → sliders drive the graph. points="1,2,A;3,4"
 x-smiles[smiles label] 2D structure · x-mol3d[name|cid|smiles|pdb still] 3D (PubChem/RCSB) · x-mermaid (body) · x-draw[w h] diagram lines: rect x y w h "l" | circle x y r | dot x y | line/dashed/arrow x1 y1 x2 y2 "l" | mass x y "m" | pulley x y r | spring x1 y1 x2 y2 | incline x y w h | ground y | wall x | angle x y r deg1 deg2 "θ" | polygon x y x y… | curve x1 y1 cx cy x2 y2 | wave x1 y x2 amp cycles | lens x y h | resistor x1 y1 x2 y2 | battery x y | text x y "t"
Time: x-timer[id seconds mode=down|up autostart] (.start() .stop() .toggle() .reset(s); .left .elapsed .running; events tick, done) · x-stopwatch · x-clock[time|seconds|for=timerId]
Inputs (all with name= are reactive vars): input(text|number|range|date|color|checkbox|radio) select textarea button[tone=accent|success|danger|ghost]
 x-segmented[name options value] · x-toggle[name checked] · x-rating[name max] · x-sortable[name] (body lines) · x-sketch[name] (value = PNG data URL) · x-upload[name accept multiple dir] (value = workspace path)
 x-todo[name title add] body lines "- [ ] task" / "- [x] done" (user ticks; add = user can append); .value [{text,done}] .done .total. For plans/checklists the user works through, not for your own progress (that is the todo tool)
 x-choice[name options="A|B|C" answer multi reveal lock layout=grid] or option lines as body; .value .index .correct .answered; reveal shows right/wrong
Media: x-image[src caption] x-video[src] x-audio[src] x-youtube[id|url start] x-embed[src height] x-map[lat lng zoom markers="lat,lng,label|…"]. Workspace paths work as src.
State: <x-state score="0" done="false" picks="{}"> (JSON-parsed initial values)

## Bindings (evaluated as JS; re-run on any change)
{{expr}} in text/attributes · :attr="expr" (:text :class="{on: x}" :value :checked :disabled :hidden) · show="expr"
each="item in list" / "(q, i) in qs" / "n in 5" (repeats element; locals item,i)
@click="stmts" (@input @change @submit @done @tick …; event, el available; async ok) · on="click:fnName" (JS or Python function)
Scope: named inputs, x-state, <script type="data" name="qs">[json]</script> vars, element ids (#t → t.start()), assignments create state (`score = score + 1`).
Helpers: fmt(sec)→mm:ss sum avg count(arr,fn) pct(a,b) round(x,d) clamp range(n) pick shuffle len now date time json + Math.*
 sendToLm(obj|str, "Label"|{label,prompt}) → <ui_event> to you (only on explicit user action; label = what chat shows, prompt = your instruction for the reply). No-JS: <form lm="Submit answers" lm-prompt="Grade and explain mistakes"> sends its inputs; <button lm="Explain" lm-prompt="…"> sends inputs of its card/section · saveIn(path, text|obj) → workspace file · py(code)→stdout (server python)
 form(sel?) → {name:value} · notify(text) · every(ms,fn) after(ms,fn) · open(pathOrUrl) → canvas · state(k,init)

## Logic
<script> JS: top-level functions/vars are global and callable from bindings. Runs after markup finishes.
<script type="python"> (Pyodide; numpy/pandas/sympy auto-load): S (state: S.score), el(sel), els(sel), form(), send_to_lm(d), save_in(p,t), notify(t), every(ms,f), after(ms,f), render(). Bind with on="click:fn". Use Python only when numerics need it.

## Relations <style type="rel">
selector { prop: value } · selectors: .class #id tag root · nesting `.a { .b {} }` · `portrait { … }` `landscape { … }` overrides
size xs|s|m|l|xl|xxl or 1..5 (relative weight/scale among siblings) · orient horizontal|vertical · group name (siblings share a row, wrap in portrait) · place top|bottom|center|start|end (start/end = side column on wide screens) · columns n|auto · span n · width fill|hug · max narrow|medium|wide|full · align start|center|end · gap tight|normal|loose · density compact|comfortable · emphasis low|high · tone accent|success|danger|warning|info|neutral · sticky top|bottom · ratio square|wide|tall · hide true

## Composition notes
Multi-step/paged flows: x-deck with one x-slide per step; a result slide shown via show="submitted". Timed tests: x-timer autostart @done="submit()". Scoring: x-choice answer=… then `$$('x-choice').filter(c => c.correct).length`. Reveal after submit with `:reveal="submitted"`. Send results with sendToLm only if the user should get analysis.
Canvas-sized tools: <canvas title="Name"><ui>…</ui></canvas>. Fill-screen layouts adapt to portrait/landscape via rel.
Keep data in <script type="data"> JSON, not repeated markup. Short semantic class names.
