/* BlocksUI component catalog for ui_search: one precise usage line per component (attrs, value, events). */
export type Comp = { tag: string; tags: string; usage: string };

export const CATALOG: Comp[] = [
  { tag: "x-stack/x-row/x-col/x-grid", tags: "layout container arrange row column grid responsive", usage: '<x-row>…</x-row> wraps; <x-grid cols="3"> (≤2 cols in portrait)' },
  { tag: "x-card", tags: "layout box panel group container", usage: '<x-card title="Totals" tone="success">…</x-card>' },
  { tag: "x-section", tags: "layout heading section group subtitle", usage: '<x-section title="Part A" subtitle="Physics">…</x-section>' },
  { tag: "x-divider/x-spacer", tags: "layout separator line rule space", usage: '<x-divider label="or"> · <x-spacer> pushes siblings apart in x-row' },
  { tag: "x-tabs", tags: "layout tabs views switch sections", usage: '<x-tabs><x-tab label="Chart">…</x-tab><x-tab label="Data">…</x-tab></x-tabs> .index' },
  { tag: "x-deck", tags: "pages slides wizard steps paging next previous quiz test flashcards carousel one at a time", usage: '<x-deck id="d" nav="numbers|dots|steps|none" loop><x-slide label="Q1">…</x-slide>…</x-deck> d.next() d.prev() d.go(i) d.index d.count; nav marks slides whose inputs are answered; x-slide tone="warning" flags' },
  { tag: "x-md", tags: "markdown text rich body prose", usage: "<x-md>**bold**, lists, tables</x-md>" },
  { tag: "x-code", tags: "code snippet syntax highlight copy", usage: '<x-code lang="python">print(1)</x-code>' },
  { tag: "x-callout", tags: "note tip warning info alert hint explanation", usage: '<x-callout tone="warning" title="Careful">…</x-callout>' },
  { tag: "x-kv", tags: "key value properties details summary facts", usage: "<x-kv>Mass: 2 kg\nSpeed: 3 m/s</x-kv>" },
  { tag: "x-badge/x-kbd/x-icon", tags: "label tag status pill keyboard shortcut icon lucide", usage: '<x-badge tone="success">Done</x-badge> <x-kbd>Ctrl</x-kbd> <x-icon name="flame">' },
  { tag: "x-stat", tags: "number kpi metric value dashboard score", usage: '<x-stat value="{{score}}" label="Score" delta="+3%" unit="pts"> (animates count-up)' },
  { tag: "x-progress", tags: "progress bar percentage completion", usage: '<x-progress :value="done" :max="total" tone="success">' },
  { tag: "x-ring/x-gauge", tags: "progress circle radial gauge meter percentage", usage: '<x-ring value="0.7" label="70%"> <x-gauge value="72" min="0" max="100" label="km/h">' },
  { tag: "x-chart", tags: "data visualization chart line bar hbar stacked area pie donut scatter radar trend compare histogram share", usage: '<x-chart type="line|bar|hbar|stacked|area|pie|donut|scatter|radar" data="1,3,2|2,2,4" labels="a,b,c" series="A|B" title="" x-label="" y-label="" center="(donut)"> scatter data="1:2,3:4"; data may be JSON; bind with :data="json(arr)"' },
  { tag: "x-sparkline", tags: "tiny inline trend chart", usage: '<x-sparkline data="1,4,2,5">' },
  { tag: "x-table", tags: "table data csv grid rows sortable", usage: '<x-table sortable>name,score\\nA,3</x-table> or csv="…" or :data="json(rows)" (array of objects or arrays)' },
  { tag: "x-heatmap", tags: "heatmap matrix grid intensity calendar correlation", usage: '<x-heatmap data="1,2,3|4,5,6" x-labels="a,b,c" y-labels="r1,r2">' },
  { tag: "x-timeline", tags: "timeline history events chronology schedule", usage: "<x-timeline>1905 | Relativity | special theory\n1915 | GR</x-timeline>" },
  { tag: "x-math", tags: "math latex equation formula tex", usage: '<x-math tex="\\int_0^1 x^2 dx"> or $inline$ / $$display$$ in any text' },
  { tag: "x-graph", tags: "math function graph desmos plot curve calculus trigonometry polar parametric slider interactive", usage: '<x-graph fn="y=a*sin(b*x); x^2/4" xmin="-6" xmax="6" points="0,0,O"> free letters bind to inputs: <input type="range" name="a" min="0" max="5" step="0.1">; r=1+cos(theta); x=cos(t),y=sin(t); equal = 1:1 axes; drag pans, wheel zooms, dblclick resets' },
  { tag: "x-smiles", tags: "chemistry molecule organic structure smiles 2d compound", usage: '<x-smiles smiles="CC(=O)Oc1ccccc1C(=O)O" label="Aspirin">' },
  { tag: "x-mol3d", tags: "chemistry molecule 3d structure protein pubchem pdb rotate", usage: '<x-mol3d name="caffeine"> or cid="2519" smiles="…" pdb="1CRN"; still = no spin' },
  { tag: "x-draw", tags: "physics diagram pulley spring incline mass force arrow vector geometry circuit optics wave drawing", usage: '<x-draw w="320" h="200">ground 180\\nincline 40 80 200 100\\nmass 150 110 "m"\\narrow 150 110 150 160 "mg"\\nangle 240 180 30 150 180 "θ"</x-draw>' },
  { tag: "x-tikz", tags: "tikz latex physics diagram free body force pulley incline circuit circuitikz geometry pgfplots feynman chemfig commutative textbook figure", usage: '<x-tikz caption="Atwood machine">\\draw[thick] (0,0) circle (0.5); \\draw (-0.5,0) -- (-0.5,-2) node[below]{$m_1$};</x-tikz> Body = TikZ commands, a tikzpicture, or a full document; rendered on the server to a theme-aware SVG (black→text colour, grey tints→background mix). Packages: circuitikz pgfplots tikz-cd tikz-3dplot chemfig tikz-feynhand; libraries arrows.meta calc positioning patterns decorations angles quotes. Best for physics, circuits, geometry: textbook-quality, labels never overlap if you place them with anchors (above/below/left/right). TeX errors show in the block.' },
  { tag: "x-mermaid", tags: "flowchart diagram sequence mindmap process tree org chart state", usage: "<x-mermaid>flowchart LR\nA-->B</x-mermaid>" },
  { tag: "x-todo", tags: "checklist todo tasks plan steps study plan tick checkbox", usage: '<x-todo name="plan" title="Week 1" add>- [x] Read ch. 1\\n- [ ] Problems 1-10</x-todo> .value=[{text,done}] .done .total; add = user can add/remove; change event' },
  { tag: "x-timer/x-stopwatch", tags: "time timer countdown stopwatch exam test deadline", usage: '<x-timer id="t" seconds="3600" autostart @done="submit()"> t.start() t.stop() t.toggle() t.reset(s); t.left t.elapsed t.running; events tick, done; mode="up" counts up; :seconds="expr" re-arms when it changes (keep-running = continue if it was running)' },
  { tag: "x-clock", tags: "time clock analog dial", usage: '<x-clock> live · time="14:30" · for="t" mirrors a timer' },
  { tag: "x-choice", tags: "quiz mcq multiple choice options question answer test exam select", usage: '<x-choice name="q1" answer="B" reveal? lock? multi? layout="grid">option A\noption B\noption C</x-choice> or options="A|B|C"; answer = text, letter or 1-based index; .value .index .correct .answered; :reveal="submitted" shows right/wrong; other = free-text answer row, skip = Skip link (value "skipped")' },
  { tag: "x-segmented/x-toggle", tags: "input choice switch boolean mode options", usage: '<x-segmented name="mode" options="Day,Week" value="Day"> <x-toggle name="grid" checked>' },
  { tag: "x-rating", tags: "rating stars feedback score", usage: '<x-rating name="r" max="5">' },
  { tag: "x-sortable", tags: "order rank sort drag reorder sequence", usage: '<x-sortable name="order">first\nsecond\nthird</x-sortable> value = array in current order' },
  { tag: "x-sketch", tags: "draw sketch handwriting canvas whiteboard scratchpad", usage: '<x-sketch name="work"> value = PNG data URL' },
  { tag: "x-upload", tags: "file upload attach input", usage: '<x-upload name="f" accept="image/*" dir="uploads"> value = workspace path' },
  { tag: "native inputs", tags: "form input text number range slider date color checkbox radio select textarea button submit", usage: '<label>Mass <input type="range" name="m" min="1" max="10" value="2"></label> <button tone="accent" @click="sendToLm(form())">Send</button>' },
  { tag: "x-image/x-video/x-audio", tags: "media image picture gif video audio sound", usage: '<x-image src="uploads/a.png" caption=""> (workspace paths or URLs)' },
  { tag: "x-youtube/x-embed/x-map", tags: "media youtube video embed iframe map location geography", usage: '<x-youtube id="dQw4w9WgXcQ" start="30"> <x-embed src="https://…" height="400"> <x-map markers="28.6,77.2,Delhi|19,72.8,Mumbai">' },
  { tag: "x-state", tags: "state variables initial data reactive store", usage: '<x-state score="0" submitted="false" answers="{}">' },
  { tag: "bindings", tags: "reactive binding each loop repeat show hide if condition click event handler template interpolation", usage: '{{expr}} :attr="expr" show="expr" each="(q,i) in qs" @click="score++" on="click:fn"; data: <script type="data" name="qs">[…]</script>' },
];

export function searchCatalog(q: string, n = 6) {
  const words = q.toLowerCase().split(/\W+/).filter(Boolean);
  return CATALOG.map((c) => ({ c, s: words.reduce((a, w) => a + (c.tags.includes(w) ? 2 : 0) + (c.tag.includes(w) ? 3 : 0), 0) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => `${x.c.tag}: ${x.c.usage}`).join("\n") || "No match. See skill blocks for the full list.";
}
