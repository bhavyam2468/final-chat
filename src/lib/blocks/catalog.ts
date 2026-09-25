export type Comp = { tag: string; tags: string; usage: string };

export const CATALOG: Comp[] = [
  { tag: "x-stack/x-row/x-col/x-grid", tags: "layout container arrange row column grid responsive", usage: '<x-grid cols="3">…</x-grid>' },
  { tag: "x-card", tags: "layout box panel group section container", usage: '<x-card title="Stats">…</x-card>' },
  { tag: "x-stat", tags: "number kpi metric value dashboard", usage: '<x-stat value="42" label="Users" delta="+3%">' },
  { tag: "x-badge", tags: "label tag status pill", usage: '<x-badge tone="success">Done</x-badge>' },
  { tag: "x-icon", tags: "icon symbol lucide glyph", usage: '<x-icon name="flame">' },
  { tag: "x-clock", tags: "time clock analog watch countdown pomodoro dial", usage: '<x-clock seconds="1500">' },
  { tag: "x-timer", tags: "time timer countdown stopwatch digital pomodoro", usage: '<x-timer id="t" seconds="300"> el.start()/stop()/set(s); events tick,done' },
  { tag: "x-progress", tags: "progress bar percentage completion loading", usage: '<x-progress value="0.4">' },
  { tag: "x-ring", tags: "progress circle radial gauge percentage donut", usage: '<x-ring value="0.7" label="70%">' },
  { tag: "x-chart line", tags: "data visualization chart line trend time series graph", usage: '<x-chart type="line" data="1,3,2|2,2,4" labels="a,b,c" series="A|B">' },
  { tag: "x-chart bar", tags: "data visualization chart bar column compare categories histogram", usage: '<x-chart type="bar" data="3,5,2" labels="x,y,z">' },
  { tag: "x-chart pie/donut", tags: "data interpretation chart pie donut circle share proportion percentage", usage: '<x-chart type="pie" data="30,50,20" labels="A,B,C">' },
  { tag: "x-chart scatter/area", tags: "data chart scatter correlation area cumulative", usage: '<x-chart type="scatter" data="1:2,3:4">' },
  { tag: "x-sparkline", tags: "tiny inline trend chart", usage: '<x-sparkline data="1,4,2,5">' },
  { tag: "x-table", tags: "table data csv grid rows", usage: '<x-table csv="a,b\\n1,2">' },
  { tag: "x-plot", tags: "math function graph desmos plot curve calculus trigonometry", usage: '<x-plot fn="sin(x);x^2/10" xmin="-6" xmax="6">' },
  { tag: "x-math", tags: "math latex equation formula tex", usage: '<x-math tex="\\int_0^1 x^2 dx">' },
  { tag: "x-smiles", tags: "chemistry molecule organic structure smiles diagram compound", usage: '<x-smiles smiles="c1ccccc1O">' },
  { tag: "x-draw", tags: "physics diagram pulley spring incline mass force arrow vector geometry drawing shapes", usage: '<x-draw w="300" h="200">pulley 150 40 18\\nmass 120 140 "m1"\\narrow 150 60 150 120 "T"</x-draw>' },
  { tag: "x-mermaid", tags: "flowchart diagram sequence mindmap timeline process graph tree org chart", usage: "<x-mermaid>flowchart LR; A-->B</x-mermaid>" },
  { tag: "x-segmented", tags: "input choice tabs toggle options mode switch", usage: '<x-segmented name="mode" options="A,B" value="A">' },
  { tag: "x-toggle", tags: "input switch boolean on off", usage: '<x-toggle name="dark" checked>' },
  { tag: "input range", tags: "input slider range number value adjust", usage: '<input type="range" name="v" min="0" max="10">' },
  { tag: "input/select/textarea/button", tags: "form input text field dropdown select button submit checkbox radio", usage: '<button tone="accent" on="click:submit">Send</button>' },
  { tag: "x-youtube/x-image", tags: "media video youtube image picture embed", usage: '<x-youtube id="dQw4w9WgXcQ">' },
];

export function searchCatalog(q: string, n = 6) {
  const words = q.toLowerCase().split(/\W+/).filter(Boolean);
  return CATALOG.map((c) => ({ c, s: words.reduce((a, w) => a + (c.tags.includes(w) ? 2 : 0) + (c.tag.includes(w) ? 3 : 0), 0) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => `${x.c.tag}: ${x.c.usage}`).join("\n") || "No match. Layout: x-stack x-card; see skill blocks.";
}
