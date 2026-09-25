---
name: blocks
description: Blocks generative UI spec: extended HTML tags, bindings, python/js logic, relational style language. Required before writing <ui>.
---
# Blocks
Write UI as: <ui> extended-HTML + optional <script> (JS) or <script type="python"> + optional <style type="rel"> </ui>.
The system owns all visual design, spacing, theme, animation, responsive layout. You only declare structure, bindings, relations. Never write CSS/inline style.

## Layout tags
x-stack (auto flow: row if room, else column) · x-row · x-col · x-grid cols="3" · x-card title="" · x-divider · x-spacer
Root is laid out as x-col. Siblings of same group share a row.

## Content tags
h1-h3 p small ul ol table (native) · x-stat value="42" label="" delta="+3%" · x-badge tone="accent|success|danger" · x-icon name="timer" (lucide names) · x-kbd · x-image src="" · x-youtube id=""
x-math tex="E=mc^2" (display) · x-progress value="0.4" · x-ring value="0.7" label=""

## Input tags (native, themed)
button (tone="accent|danger|ghost") · input type=text|number|range|date|color|checkbox|radio · select/option · textarea · label
x-segmented name="mode" options="Focus,Break" value="Focus" · x-toggle name="" checked
Every input with name="" is collected by form helpers.

## Time
x-clock (analog; live unless time="HH:MM:SS"; attr seconds="1500" countdown face shows remaining)
x-timer id="t" seconds="1500" (digital mm:ss). JS API: el.start() el.stop() el.reset(s) el.set(s); event "done", "tick".

## Data viz (animated draw-in)
x-chart type="line|bar|area|pie|donut|scatter" data="3,5,2" labels="Mon,Tue,Wed" series="Name" (multiple series: data="1,2,3|2,3,1" series="A|B")
x-sparkline data="" · x-plot fn="sin(x)*x" xmin="-10" xmax="10" (multiple fns separated by ;) · x-table csv="a,b\n1,2"
x-mermaid: flowchart/sequence/mindmap/timeline source as text content.

## Science
x-smiles smiles="CC(=O)Oc1ccccc1C(=O)O" (2D structure) · x-math · x-plot
x-draw w="300" h="200": lines of primitives (units px):
  rect x y w h "label" | circle x y r "label" | line x1 y1 x2 y2 | arrow x1 y1 x2 y2 "label" | text x y "t"
  pulley x y r | spring x1 y1 x2 y2 | mass x y "m1" | incline x y w h | ground y | dashed x1 y1 x2 y2 | angle x y r deg1 deg2 "θ"

## Logic
JS (<script>): plain DOM plus helpers:
 $(sel) $$ (sel) · on(sel,event,fn) · form() -> {name:value} of all named inputs · sendToLm(obj|string) sends <ui_event> to the chat (use on submit)
 saveIn(path, text) writes workspace file · py(code) -> Promise<stdout> runs server python in workspace (numpy etc)
 state(key, init) -> {get(), set(v)} (object, not a value) · every(ms,fn) · notify(text)
Python (<script type="python">, runs in browser via Pyodide): functions bound by attribute on="click:start" (also change:, input:). Helpers in scope: el(sel) (returns DOM element), els(sel), form(), send_to_lm(obj), save_in(path,text), every(ms,fn), notify(text). JS on="" handlers resolve to window functions if no python present.

## Relational style language (<style type="rel">)
Only relations, no absolute values. Selectors: .class, #id, tag, `root`.
 size: 1x..5x (relative visual weight vs siblings; text/clock scale with it)
 orient: horizontal|vertical (horizontal = spans row width; on containers = child direction)
 group: name (same group -> same row, split by size)
 place: top|bottom|start|end|center (order within parent)
 emphasis: low|normal|high · tone: accent|neutral|success|danger
 gap: tight|normal|loose (containers) · width: fill|hug · align: start|center|end
 portrait { selector { ... } } / landscape { ... } override per canvas orientation.
Nesting: `.a { .b { } }` scopes .b inside .a.

## Example: pomodoro
<ui>
<x-clock class="clock" seconds="1500"></x-clock>
<x-timer id="t" class="time" seconds="1500"></x-timer>
<label>Focus <input type="range" class="focus" name="focus" min="5" max="60" value="25"></label>
<label>Break <input type="range" class="break" name="brk" min="1" max="30" value="5"></label>
<button tone="accent" class="go" on="click:start">Start</button><button class="go" on="click:stop">Stop</button>
<script>
function start(){const t=$('#t');t.set(form().focus*60);$('.clock').setAttribute('seconds',form().focus*60);t.start()}
function stop(){$('#t').stop()}
on('#t','done',()=>notify('Focus done'))
</script>
<style type="rel">
root { gap: loose }
.clock { size: 3x; place: top }
.time { size: 2x }
.focus, .break { orient: horizontal; group: sliders; size: 1x }
.go { group: actions }
landscape { .clock { place: start } }
</style>
</ui>
Rules: short, semantic class names; one <ui> per idea; keep data inline and small; for forms always end with a submit button calling sendToLm(form()).
