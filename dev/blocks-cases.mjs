// Model-realistic BlocksUI sources. Each `expect` runs in the page and must return true (or a diagnostic).
// Covers our own syntax AND the Alpine/Vue habits models fall back on, because the runtime accepts both.
const txt = (sel) => `(document.querySelector(${JSON.stringify(sel)})||{}).textContent`;
export const cases = [
  {
    name: "counter native",
    src: `<x-state count="0"></x-state><button @click="count++">Click Me ({{count}})</button><x-stat label="Clicks" :value="count"></x-stat>`,
    steps: [{ click: "button" }, { click: "button", wait: 900 }],
    expect: () => document.querySelector("button").textContent.trim() === "Click Me (2)" && document.querySelector("x-stat .v").textContent.trim() === "2" || document.getElementById("root").innerText,
  },
  {
    name: "counter without declared state",
    src: `<button @click="clicks += 1">Click Me ({{clicks}})</button><p>Total: {{ total }}</p><script>let total = 5</script>`,
    steps: [{ click: "button" }],
    expect: () => document.querySelector("button").textContent.trim() === "Click Me (1)" && /Total: 5/.test(document.getElementById("root").innerText) || document.getElementById("root").innerText,
  },
  {
    name: "stat bound to an object shows readable text",
    src: `<x-state stats='{"sessions":3,"focus":"75 min"}'></x-state><x-stat label="Today" :value="stats"></x-stat><x-stat label="Sessions" :value="stats.sessions"></x-stat>`,
    wait: 900,
    expect: () => { const v = [...document.querySelectorAll("x-stat .v")].map((e) => e.textContent.trim()); return (v[0] === "sessions: 3 \u00b7 focus: 75 min" && v[1] === "3") || v.join(" | "); },
  },
  {
    name: "stat with bare state name",
    src: `<x-state total="7"></x-state><x-stat label="Total" value="total"></x-stat>`,
    wait: 1000,
    expect: () => document.querySelector("x-stat .v").textContent.trim() === "7" || document.querySelector("x-stat").innerText,
  },
  {
    name: "alpine counter",
    src: `<div x-data="{ count: 0 }"><button @click="count++">+</button><span id="o" x-text="count"></span></div>`,
    steps: [{ click: "+" }, { click: "+" }],
    expect: () => document.getElementById("o").textContent === "2" || document.getElementById("o").textContent,
  },
  {
    name: "alpine methods getters this",
    src: `<div x-data="{ left: 1500, running: false, iv: null,
        get display() { return String(Math.floor(this.left/60)).padStart(2,'0') + ':' + String(this.left%60).padStart(2,'0') },
        setMode(m) { this.left = m*60 }, start() { this.running = true } }">
      <h1 id="d" x-text="display"></h1>
      <button @click="setMode(5)">Short</button><button @click="start()">Start</button><p id="r" x-show="running">running</p></div>`,
    steps: [{ click: "Short" }, { click: "Start" }],
    expect: () => document.getElementById("d").textContent === "05:00" && !document.getElementById("r").hidden && getComputedStyle(document.getElementById("r")).display !== "none" || document.getElementById("root").innerText,
  },
  {
    name: "alpine x-for template objects",
    src: `<ul x-data="{ tasks: [{name:'Write'},{name:'Read'}] }"><template x-for="t in tasks" :key="t.name"><li x-text="t.name"></li></template></ul><button @click="tasks.push({name:'Ship'})">add</button>`,
    steps: [{ click: "add" }],
    expect: () => [...document.querySelectorAll("li")].map((l) => l.textContent).join(",") === "Write,Read,Ship" || [...document.querySelectorAll("li")].map((l) => l.textContent).join(","),
  },
  {
    name: "vue v-for v-if v-model",
    src: `<div><input id="n" v-model="name" placeholder="name"><p id="h" v-if="name">Hello {{ name }}</p><p id="e" v-else>Type a name</p>
      <li v-for="(s, i) in stats" :key="i">{{ i + 1 }}. {{ s.label }}: {{ s.value }}</li></div>
      <script type="data" name="stats">[{"label":"Focus","value":3},{"label":"Breaks","value":2}]</script>`,
    steps: [{ type: ["#n", "Ada"] }],
    expect: () => document.getElementById("h").textContent.trim() === "Hello Ada" && document.getElementById("e").hidden && [...document.querySelectorAll("li")].map((l) => l.textContent.trim()).join("|") === "1. Focus: 3|2. Breaks: 2" || document.getElementById("root").innerText,
  },
  {
    name: "objects never print [object Object]",
    src: `<x-state session='{"label":"Focus","value":25}' list='["a","b"]'></x-state><p id="a" x-text="session"></p><p id="b">{{ list }}</p><x-stat each="s in stats" :label="s.label" :value="s.value"></x-stat>
      <script type="data" name="stats">[{"label":"Sessions","value":4},{"label":"Minutes","value":100}]</script>`,
    wait: 1100,
    expect: () => !/object Object|\{"|\["/.test(document.getElementById("root").innerText) && document.querySelectorAll("x-stat").length === 2 || document.getElementById("root").innerText,
  },
  {
    name: "pomodoro timer buttons",
    src: `<x-state mode="focus"></x-state>
      <x-segmented name="mode" options="focus|short|long"></x-segmented>
      <x-timer id="timer" :seconds="mode === 'focus' ? 1500 : mode === 'short' ? 300 : 900"></x-timer>
      <button @click="timer.start()">Start</button><button @click="timer.reset()">Reset</button>
      <button id="plus" @click="timer.add(60)">+1 min</button>`,
    steps: [{ click: "short" }, { click: "#plus" }],
    expect: () => document.getElementById("timer").textContent.trim() === "06:00" || document.getElementById("timer").textContent,
  },
  {
    name: "pomodoro plain js",
    src: `<h1 id="t">25:00</h1><button id="s" onclick="startTimer()">Start</button><button onclick="setMode(5)">Short Break</button>
      <script>let left = 1500, iv = null;
      function draw(){ document.getElementById('t').textContent = String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0') }
      function setMode(m){ clearInterval(iv); left = m*60; draw() }
      function startTimer(){ iv = setInterval(()=>{ left--; draw() }, 1000) }</script>`,
    steps: [{ click: "Short Break" }],
    expect: () => document.getElementById("t").textContent === "05:00" || document.getElementById("t").textContent,
  },
  {
    name: "chart series comma names",
    src: `<x-chart type="line" labels="1,2,3,4" series="Electron concentration, Hole concentration" data="1e16,2e16,3e16,4e16|10,20,30,40"></x-chart>`,
    wait: 500,
    expect: () => [...document.querySelectorAll("x-chart .legend span")].map((s) => s.textContent).join("|") === "Electron concentration|Hole concentration (right axis)" || document.querySelector("x-chart").innerText,
  },
  {
    name: "chart json objects",
    src: `<x-chart type="bar" :data="rows" x="month" y="sales,costs"></x-chart><script type="data" name="rows">[{"month":"Jan","sales":10,"costs":4},{"month":"Feb","sales":14,"costs":6}]</script>`,
    wait: 500,
    expect: () => document.querySelectorAll("x-chart rect").length === 4 && [...document.querySelectorAll("x-chart .legend span")].map((s) => s.textContent).join("|") === "sales|costs" || document.querySelector("x-chart").innerHTML.slice(0, 300),
  },
  {
    name: "graph parametric implicit polar",
    src: `<x-state a="3" b="2"></x-state><x-graph fn="x=a*cos(t); y=b*sin(t)"></x-graph><x-graph fn="x^2 + y^2 = 16"></x-graph><x-graph fn="r = 2*sin(3*theta)"></x-graph><x-graph fn="y = x^2; y=2x+1"></x-graph>`,
    wait: 600,
    expect: () => { const g = [...document.querySelectorAll("x-graph")]; const lens = g.map((e) => [...e.querySelectorAll("path")].map((p) => (p.getAttribute("d") || "").length).reduce((a, b) => a + b, 0)); const lg = g[0].querySelector(".legend"); return lens.every((l) => l > 200) && (!lg || !/y = x=/.test(lg.textContent)) || { lens, legend: lg && lg.textContent }; },
  },
  {
    name: "graph keeps aspect when narrow",
    width: 360,
    src: `<x-graph fn="sin(x)" points="0,0,origin"></x-graph>`,
    wait: 600,
    expect: () => { const s = document.querySelector("x-graph svg"); const vb = s.viewBox.baseVal, r = s.getBoundingClientRect(); return Math.abs(vb.width / vb.height - r.width / r.height) < 0.02 || { vb: [vb.width, vb.height], box: [r.width, r.height] }; },
  },
  {
    name: "choice answer other skip",
    src: `<x-choice name="q1" options="Paris|Rome|Berlin" answer="Paris" other skip></x-choice><p id="v">{{ q1 }}</p>`,
    steps: [{ click: "Rome" }],
    expect: () => document.getElementById("v").textContent === "Rome" && !!document.querySelector("x-choice .other") && !!document.querySelector("x-choice .skip") || document.getElementById("root").innerText,
  },
  {
    name: "form lm submit",
    src: `<form lm="Submit answers" lm-prompt="Grade them"><x-choice name="q1" options="A|B"></x-choice><input name="why" value="because"><button type="submit">Submit</button></form>`,
    steps: [{ click: "B" }, { click: "Submit" }],
    expect: () => (window.__lm && window.__lm.data.q1 === "B" && window.__lm.data.why === "because") || JSON.stringify(window.__lm || null),
  },
  {
    name: "modifiers and x-on",
    src: `<x-state n="0"></x-state><form @submit.prevent="n = n + 1"><button id="b" type="submit">go</button></form><button id="c" x-on:click="n += 10">ten</button><p id="o" x-text="n"></p>`,
    steps: [{ click: "#b" }, { click: "#c" }],
    expect: () => document.getElementById("o").textContent === "11" || document.getElementById("o").textContent,
  },
  {
    name: "class and style bindings",
    src: `<x-state on="true"></x-state><div id="d" :class="{ active: on, off: !on }" :style="{ color: 'red', fontSize: '20px' }">x</div><div id="e" :class="['a', on && 'b']">y</div>`,
    expect: () => { const d = document.getElementById("d"), e = document.getElementById("e"); return d.className === "active" && d.style.fontSize === "20px" && e.className === "a b" || [d.className, d.getAttribute("style"), e.className]; },
  },
  {
    name: "tikz block",
    src: `<x-tikz>\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}</x-tikz>`,
    wait: 700,
    expect: () => !!document.querySelector("x-tikz svg") || document.querySelector("x-tikz").innerHTML.slice(0, 200),
  },
  {
    name: "self-check reports unbound names", wait: 1400,
    src: `<p>Score: {{ scroe }}</p><x-state score="1"></x-state>`,
    expect: () => (window.__issues || []).some((i) => /scroe/.test(i)) || JSON.stringify(window.__issues || null),
  },
];

// The examples the system prompt teaches must render cleanly: they are read from SYSTEM.md itself.
import fs from "node:fs";
const SYS = fs.readFileSync(new URL("../workspace-template/system/SYSTEM.md", import.meta.url), "utf8");
[...SYS.matchAll(/^<ui>([\s\S]*?)<\/ui>/gm)].filter((m) => m[1].includes("<")).forEach((m, i) => {
  const tag = m[1].match(/<(x-[\w-]+)/)?.[1] || "html";
  cases.push({
    name: `system prompt example ${i + 1} ${tag}`, wait: 1200, src: m[1],
    expect: () => { const r = document.getElementById("root"); const el = r.querySelector("x-chart svg, x-graph canvas, x-graph svg, x-choice .opt, x-tikz svg, x-timer"); return (!!el && !(window.__issues || []).length) || "missing render or issues: " + JSON.stringify(window.__issues || []) + " " + r.innerHTML.slice(0, 200); },
  });
});
