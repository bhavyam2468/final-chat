/* Blocks runtime v1 — extended HTML + relational styles + JS/Python logic.
   Standalone: include runtime.css + runtime.js, put markup in #root, rel styles in <script type="text/rel">. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const FRAME = window.name || "blk";
  const post = (type, data) => parent.postMessage({ src: "blocks", frame: FRAME, type, ...data }, "*");
  const svg = (tag, attrs = {}, parentEl) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parentEl) parentEl.appendChild(e); return e; };
  const num = (v, d = 0) => (v === null || v === undefined || v === "" || isNaN(+v) ? d : +v);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const PAL = () => [css("--fg"), css("--accent"), "#6f8a9c", "#8f7aa8", "#7c9a6d", "#c29a4a"];
  const loaded = {};
  const load = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement(src.endsWith(".css") ? "link" : "script"); if (src.endsWith(".css")) { s.rel = "stylesheet"; s.href = src; res(); } else { s.src = src; s.onload = res; s.onerror = rej; } document.head.appendChild(s); }));
  const pathLen = (p) => { try { return Math.ceil(p.getTotalLength()) + 2; } catch { return 2000; } };
  const drawIn = (p) => { requestAnimationFrame(() => { p.style.setProperty("--len", pathLen(p)); p.classList.add("draw"); }); };
  const define = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };

  class Base extends HTMLElement {
    static get observedAttributes() { return ["value", "data", "seconds", "time", "fn", "tex", "smiles", "options", "checked", "labels", "type", "csv", "cols"]; }
    connectedCallback() { if (!this._init) { this._init = true; this._src = this.textContent; this.init && this.init(); } this.render && this.render(); }
    attributeChangedCallback() { if (this._init && this.render) this.render(); }
  }

  define("x-grid", class extends Base { render() { this.style.setProperty("--cols", this.getAttribute("cols") || 2); } });
  define("x-card", class extends Base { init() { const t = this.getAttribute("title"); if (t) { const h = document.createElement("div"); h.className = "t"; h.textContent = t; this.prepend(h); } } });
  define("x-stat", class extends Base { render() { const d = this.getAttribute("delta"); this.innerHTML = `<span class="v">${this.getAttribute("value") ?? ""}</span><span class="l">${this.getAttribute("label") ?? ""}</span>${d ? `<span class="d ${d.trim().startsWith("-") ? "neg" : ""}">${d}</span>` : ""}`; } });
  define("x-badge", class extends Base { render() { const t = this.getAttribute("tone"); if (t) this.style.setProperty("--tone", `var(--${t === "neutral" ? "muted" : t})`); } });
  define("x-icon", class extends Base { render() { const n = this.getAttribute("name"); if (!n || this._n === n) return; this._n = n; fetch(`https://unpkg.com/lucide-static@0.469.0/icons/${n}.svg`).then((r) => r.ok ? r.text() : "").then((t) => { this.innerHTML = t; }).catch(() => {}); } });
  define("x-progress", class extends Base { render() { if (!this._i) { this._i = document.createElement("i"); this.appendChild(this._i); this._i.style.width = "0"; } requestAnimationFrame(() => (this._i.style.width = Math.max(0, Math.min(1, num(this.getAttribute("value")))) * 100 + "%")); } });
  define("x-ring", class extends Base { render() {
    const v = Math.max(0, Math.min(1, num(this.getAttribute("value")))), C = 2 * Math.PI * 42;
    if (!this._s) { this._s = svg("svg", { viewBox: "0 0 100 100" }, this); svg("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "var(--line)", "stroke-width": 6 }, this._s);
      this._c = svg("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "var(--tone)", "stroke-width": 6, "stroke-linecap": "round", transform: "rotate(-90 50 50)", "stroke-dasharray": C, "stroke-dashoffset": C }, this._s);
      this._c.style.transition = "stroke-dashoffset .9s cubic-bezier(.2,.7,.2,1)"; this._t = svg("text", { x: 50, y: 55, "text-anchor": "middle", "font-size": 16, "font-weight": 600, fill: "var(--fg)" }, this._s); }
    this._t.textContent = this.getAttribute("label") ?? Math.round(v * 100) + "%"; requestAnimationFrame(() => this._c.setAttribute("stroke-dashoffset", C * (1 - v)));
  } });

  const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(x).padStart(2, "0"); };
  define("x-timer", class extends Base {
    init() { this.total = num(this.getAttribute("seconds"), 60); this.left = this.total; this.running = false; }
    render() { if (!this.running && this.hasAttribute("seconds") && num(this.getAttribute("seconds")) !== this.total) { this.total = this.left = num(this.getAttribute("seconds")); } this.textContent = fmt(this.left); }
    tick() { this.textContent = fmt(this.left); this.dispatchEvent(new CustomEvent("tick", { bubbles: true, detail: { id: this.id, left: this.left, total: this.total } })); }
    start() { if (this.running) return; this.running = true; this._last = Date.now(); this._iv = setInterval(() => { const n = Date.now(); this.left -= (n - this._last) / 1000; this._last = n; if (this.left <= 0) { this.left = 0; this.stop(); this.tick(); this.dispatchEvent(new CustomEvent("done", { bubbles: true })); return; } this.tick(); }, 250); }
    stop() { this.running = false; clearInterval(this._iv); }
    reset(s) { this.stop(); this.total = this.left = s ?? this.total; this.tick(); }
    set(s) { this.reset(s); }
  });
  define("x-clock", class extends Base {
    init() { const s = this._s = svg("svg", { viewBox: "0 0 100 100" }, this);
      svg("circle", { cx: 50, cy: 50, r: 47, fill: "var(--surface)", stroke: "var(--line)" }, s);
      for (let i = 0; i < 60; i++) { const a = (i / 60) * 2 * Math.PI, r1 = i % 5 ? 43 : 40; svg("line", { x1: 50 + Math.sin(a) * r1, y1: 50 - Math.cos(a) * r1, x2: 50 + Math.sin(a) * 45, y2: 50 - Math.cos(a) * 45, stroke: i % 5 ? "var(--line)" : "var(--muted)", "stroke-width": i % 5 ? .6 : 1.2 }, s); }
      const C = 2 * Math.PI * 36; this._C = C;
      this._arc = svg("circle", { cx: 50, cy: 50, r: 36, fill: "none", stroke: "var(--accent)", "stroke-width": 3, opacity: .85, transform: "rotate(-90 50 50)", "stroke-dasharray": C, "stroke-dashoffset": C }, s);
      this._arc.style.transition = "stroke-dashoffset .3s linear";
      this._h = svg("line", { x1: 50, y1: 50, x2: 50, y2: 28, stroke: "var(--fg)", "stroke-width": 2.6, "stroke-linecap": "round" }, s);
      this._m = svg("line", { x1: 50, y1: 50, x2: 50, y2: 16, stroke: "var(--fg)", "stroke-width": 1.8, "stroke-linecap": "round" }, s);
      this._sec = svg("line", { x1: 50, y1: 56, x2: 50, y2: 12, stroke: "var(--accent)", "stroke-width": .8 }, s);
      svg("circle", { cx: 50, cy: 50, r: 2, fill: "var(--fg)" }, s);
      document.addEventListener("tick", (e) => { const f = this.getAttribute("for"); if (!this.hasAttribute("seconds") || (f && f !== e.detail.id)) return; this.show(e.detail.left, e.detail.total); });
      if (!this.hasAttribute("seconds") && !this.hasAttribute("time")) { const up = () => { const d = new Date(); this.hands(d.getHours(), d.getMinutes(), d.getSeconds() + d.getMilliseconds() / 1000); }; up(); setInterval(up, 200); }
    }
    hands(h, m, s) { const rot = (el, deg) => el.setAttribute("transform", `rotate(${deg} 50 50)`); rot(this._h, ((h % 12) + m / 60) * 30); rot(this._m, (m + s / 60) * 6); rot(this._sec, s * 6); }
    show(left, total) { const m = Math.floor(left / 60), s = left % 60; this.hands(0, m, s); this._h.style.opacity = 0; this._arc.setAttribute("stroke-dashoffset", this._C * (1 - left / Math.max(1, total))); }
    render() { if (this.hasAttribute("time")) { const [h, m, s] = this.getAttribute("time").split(":").map(Number); this.hands(h || 0, m || 0, s || 0); } else if (this.hasAttribute("seconds")) { const t = num(this.getAttribute("seconds")); this.show(t, t); } }
  });

  function parseSeries(el) {
    const d = (el.getAttribute("data") || "").split("|").map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
    const names = (el.getAttribute("series") || "").split("|");
    const labels = (el.getAttribute("labels") || "").split(",").map((x) => x.trim()).filter(Boolean);
    return { series: d.map((arr, i) => ({ name: names[i] || "", values: arr })), labels };
  }
  define("x-chart", class extends Base { render() {
    this.innerHTML = ""; const type = this.getAttribute("type") || "line"; const { series, labels } = parseSeries(this); const pal = PAL();
    const W = 320, H = 180, P = { l: 28, r: 8, t: 8, b: 20 };
    if (type === "pie" || type === "donut") {
      const vals = series[0]?.values.map(Number) || [], tot = vals.reduce((a, b) => a + b, 0) || 1; const s = svg("svg", { viewBox: "0 0 200 200" }, this); s.style.maxWidth = "240px"; s.style.margin = "0 auto";
      const r = 60, C = 2 * Math.PI * r; let acc = 0;
      vals.forEach((v, i) => { const c = svg("circle", { cx: 100, cy: 100, r, fill: "none", stroke: pal[i % pal.length], "stroke-width": type === "donut" ? 26 : 120, "stroke-dasharray": `0 ${C}`, transform: `rotate(${-90 + (acc / tot) * 360} 100 100)` }, s); if (type === "pie") c.setAttribute("r", 30), c.setAttribute("stroke-width", 60);
        const rr = type === "pie" ? 30 : r, CC = 2 * Math.PI * rr, len = (v / tot) * CC; c.setAttribute("stroke-dasharray", `0 ${CC}`); c.style.transition = `stroke-dasharray .8s cubic-bezier(.2,.7,.2,1) ${i * 0.12}s`; requestAnimationFrame(() => requestAnimationFrame(() => c.setAttribute("stroke-dasharray", `${len} ${CC}`))); acc += v; });
      const lg = document.createElement("div"); lg.className = "legend"; lg.innerHTML = vals.map((v, i) => `<span><i style="background:${pal[i % pal.length]}"></i>${labels[i] || i + 1} · ${Math.round((v / tot) * 100)}%</span>`).join(""); this.appendChild(lg); return;
    }
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}` }, this);
    const pts = type === "scatter" ? series.flatMap((se) => se.values.map((p) => p.split(":").map(Number))) : null;
    const all = pts ? pts.map((p) => p[1]) : series.flatMap((x) => x.values.map(Number));
    const max = Math.max(...all, 0), min = Math.min(...all, 0), rng = max - min || 1;
    const n = Math.max(...series.map((x) => x.values.length), 1);
    const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - min) / rng);
    for (let k = 0; k <= 3; k++) { const v = min + (rng * k) / 3; svg("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: "ax" }, s); svg("text", { x: P.l - 4, y: y(v) + 3, "text-anchor": "end", class: "lbl" }, s).textContent = +v.toFixed(v % 1 ? 1 : 0); }
    if (pts) { const xs = pts.map((p) => p[0]), xmin = Math.min(...xs), xr = Math.max(...xs) - xmin || 1; pts.forEach((p, i) => { const c = svg("circle", { cx: P.l + ((p[0] - xmin) / xr) * (W - P.l - P.r), cy: y(p[1]), r: 3, fill: pal[1], class: "pop" }, s); c.style.animationDelay = i * 20 + "ms"; }); return; }
    const x = (i) => P.l + (type === "bar" ? ((i + 0.5) * (W - P.l - P.r)) / n : n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
    labels.forEach((l, i) => { if (i < n && (n < 12 || i % Math.ceil(n / 8) === 0)) svg("text", { x: x(i), y: H - 5, "text-anchor": "middle", class: "lbl" }, s).textContent = l; });
    series.forEach((se, si) => { const col = pal[si % pal.length], v = se.values.map(Number);
      if (type === "bar") { const bw = ((W - P.l - P.r) / n) * 0.7 / series.length; v.forEach((val, i) => { const r = svg("rect", { x: x(i) - (bw * series.length) / 2 + si * bw, y: y(Math.max(val, 0)), width: bw - 2, height: Math.abs(y(val) - y(0)), rx: 2, fill: col, class: "grow" }, s); r.style.animationDelay = i * 40 + si * 80 + "ms"; }); }
      else { const d = v.map((val, i) => `${i ? "L" : "M"}${x(i)},${y(val)}`).join(" ");
        if (type === "area") { const a = svg("path", { d: `${d} L${x(v.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, fill: col, opacity: 0.12, class: "pop" }, s); a.style.animationDelay = ".6s"; }
        drawIn(svg("path", { d, fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, s)); }
    });
    if (series.length > 1) { const lg = document.createElement("div"); lg.className = "legend"; lg.innerHTML = series.map((se, i) => `<span><i style="background:${pal[i % pal.length]}"></i>${se.name}</span>`).join(""); this.appendChild(lg); }
  } });
  define("x-sparkline", class extends Base { render() { this.innerHTML = ""; const v = (this.getAttribute("data") || "").split(",").map(Number); const mx = Math.max(...v), mn = Math.min(...v), r = mx - mn || 1; const s = svg("svg", { viewBox: "0 0 100 30", preserveAspectRatio: "none" }, this); drawIn(svg("path", { d: v.map((x, i) => `${i ? "L" : "M"}${(i / (v.length - 1 || 1)) * 100},${28 - ((x - mn) / r) * 26}`).join(" "), fill: "none", stroke: "var(--tone)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }, s)); } });
  define("x-table", class extends Base { render() { const rows = (this.getAttribute("csv") || this._src || "").replace(/\\n/g, "\n").trim().split("\n").map((r) => r.split(",")); if (!rows[0]?.[0]) return; this.innerHTML = `<table><thead><tr>${rows[0].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`; } });

  const compileFn = (src) => { const e = src.replace(/\^/g, "**").replace(/(\d)([a-z(])/gi, "$1*$2"); return new Function("x", `with(Math){return (${e})}`); };
  define("x-plot", class extends Base { render() {
    this.innerHTML = ""; const fns = (this.getAttribute("fn") || this._src || "x").split(";").map((f) => f.trim()).filter(Boolean);
    const x0 = num(this.getAttribute("xmin"), -10), x1 = num(this.getAttribute("xmax"), 10), W = 320, H = 200, N = 400, pal = PAL();
    const data = fns.map((f) => { let g; try { g = compileFn(f); } catch { return []; } return Array.from({ length: N + 1 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / N; let y; try { y = g(x); } catch { y = NaN; } return [x, y]; }); });
    const ys = data.flat().map((p) => p[1]).filter((v) => isFinite(v)); let y0 = num(this.getAttribute("ymin"), Math.min(...ys, -1)), y1 = num(this.getAttribute("ymax"), Math.max(...ys, 1)); if (y1 - y0 > 1e4) { y0 = -10; y1 = 10; }
    const X = (x) => ((x - x0) / (x1 - x0)) * W, Y = (y) => H - ((y - y0) / (y1 - y0)) * H; const s = svg("svg", { viewBox: `0 0 ${W} ${H}` }, this);
    for (let gx = Math.ceil(x0); gx <= x1; gx += Math.max(1, Math.round((x1 - x0) / 10))) svg("line", { x1: X(gx), x2: X(gx), y1: 0, y2: H, class: "ax", opacity: gx === 0 ? 1 : 0.4 }, s);
    if (y0 < 0 && y1 > 0) svg("line", { x1: 0, x2: W, y1: Y(0), y2: Y(0), class: "ax" }, s);
    data.forEach((pts, i) => { let d = "", pen = false; pts.forEach(([x, y]) => { if (!isFinite(y) || y < y0 - (y1 - y0) || y > y1 + (y1 - y0)) { pen = false; return; } d += `${pen ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`; pen = true; }); drawIn(svg("path", { d, fill: "none", stroke: pal[i % pal.length], "stroke-width": 2 }, s)); });
    if (fns.length > 1) { const lg = document.createElement("div"); lg.className = "legend"; lg.innerHTML = fns.map((f, i) => `<span><i style="background:${pal[i % pal.length]}"></i>y = ${f}</span>`).join(""); this.appendChild(lg); }
  } });
  define("x-math", class extends Base { render() { const tex = this.getAttribute("tex") || this._src || ""; load("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"); load("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js").then(() => { this.innerHTML = window.katex.renderToString(tex, { displayMode: true, throwOnError: false }); }); } });
  define("x-smiles", class extends Base { render() { const sm = this.getAttribute("smiles") || this._src?.trim(); if (!sm) return; this.innerHTML = ""; const s = svg("svg", { id: "sm" + Math.random().toString(36).slice(2) }, this); s.style.minHeight = "180px";
    load("https://unpkg.com/smiles-drawer@2.0.1/dist/smiles-drawer.min.js").then(() => { const SD = window.SmilesDrawer; const dark = document.body.dataset.theme === "dark"; const d = new SD.SvgDrawer({ width: 300, height: 200, bondThickness: 1.2 }); SD.parse(sm, (tree) => d.draw(tree, s, dark ? "dark" : "light", false), (e) => { this.innerHTML = `<div class="err">${e}</div>`; }); }); } });
  define("x-mermaid", class extends Base { init() { this._code = this._src.trim(); } render() { const dark = document.body.dataset.theme === "dark";
    import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs").then(async ({ default: m }) => { m.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", fontFamily: "inherit" }); try { const { svg: out } = await m.render("m" + Math.random().toString(36).slice(2), this._code); this.innerHTML = out; this.firstElementChild?.classList.add("pop"); } catch (e) { this.innerHTML = `<div class="err">${e.message || e}</div>`; } }); } });
  define("x-draw", class extends Base { init() { this._code = this._src; } render() {
    this.innerHTML = ""; const W = num(this.getAttribute("w"), 300), H = num(this.getAttribute("h"), 200); const s = svg("svg", { viewBox: `0 0 ${W} ${H}` }, this);
    const defs = svg("defs", {}, s); const mk = svg("marker", { id: "ah", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs); svg("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--accent)" }, mk);
    const st = { fill: "none", stroke: "var(--fg)", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }; let k = 0;
    const T = (x, y, t, a = "middle") => { const e = svg("text", { x, y, "text-anchor": a, "font-size": 12, fill: "var(--fg)", class: "pop" }, s); e.textContent = t; e.style.animationDelay = (k++ * 60) + "ms"; };
    const P = (el) => { drawIn(el); return el; };
    for (const line of this._code.split("\n")) { const m = line.trim().match(/^(\w+)\s+([-\d.\s]+?)(?:\s+"([^"]*)")?$/); if (!m) continue; const [cmd, nums, label] = [m[1], m[2].trim().split(/\s+/).map(Number), m[3]]; const [a, b, c, d, e2] = nums;
      switch (cmd) {
        case "rect": P(svg("rect", { x: a, y: b, width: c, height: d, rx: 3, ...st }, s)); if (label) T(a + c / 2, b + d / 2 + 4, label); break;
        case "mass": P(svg("rect", { x: a - 18, y: b - 18, width: 36, height: 36, rx: 3, ...st, fill: "var(--surface)" }, s)); if (label) T(a, b + 4, label); break;
        case "circle": P(svg("circle", { cx: a, cy: b, r: c, ...st }, s)); if (label) T(a, b + 4, label); break;
        case "pulley": P(svg("circle", { cx: a, cy: b, r: c, ...st }, s)); svg("circle", { cx: a, cy: b, r: 2.5, fill: "var(--fg)" }, s); P(svg("line", { x1: a, y1: b, x2: a, y2: b - c - 12, ...st }, s)); P(svg("line", { x1: a - 14, y1: b - c - 12, x2: a + 14, y2: b - c - 12, ...st, "stroke-width": 3 }, s)); break;
        case "line": P(svg("line", { x1: a, y1: b, x2: c, y2: d, ...st }, s)); if (label) T((a + c) / 2, (b + d) / 2 - 6, label); break;
        case "dashed": svg("line", { x1: a, y1: b, x2: c, y2: d, ...st, "stroke-dasharray": "4 4", opacity: 0.6 }, s); break;
        case "arrow": P(svg("line", { x1: a, y1: b, x2: c, y2: d, ...st, stroke: "var(--accent)", "marker-end": "url(#ah)" }, s)); if (label) T(c + (c >= a ? 8 : -8), d + 4, label, c >= a ? "start" : "end"); break;
        case "text": T(a, b, label || ""); break;
        case "ground": { P(svg("line", { x1: 0, y1: a, x2: W, y2: a, ...st }, s)); for (let x = 4; x < W; x += 12) svg("line", { x1: x, y1: a, x2: x - 6, y2: a + 7, ...st, "stroke-width": 0.8, opacity: 0.5 }, s); break; }
        case "incline": P(svg("path", { d: `M${a},${b + d} L${a + c},${b + d} L${a + c},${b} Z`, ...st }, s)); break;
        case "spring": { const L = Math.hypot(c - a, d - b), n = 10, ang = Math.atan2(d - b, c - a); let p = `M0,0 L${L * 0.1},0`; for (let i = 0; i < n; i++) p += ` L${L * 0.1 + ((i + 0.5) * L * 0.8) / n},${i % 2 ? 7 : -7}`; p += ` L${L * 0.9},0 L${L},0`; P(svg("path", { d: p, ...st, transform: `translate(${a},${b}) rotate(${(ang * 180) / Math.PI})` }, s)); break; }
        case "angle": { const r = c, s1 = (d * Math.PI) / 180, s2 = (e2 * Math.PI) / 180; P(svg("path", { d: `M${a + r * Math.cos(s1)},${b - r * Math.sin(s1)} A${r},${r} 0 0 0 ${a + r * Math.cos(s2)},${b - r * Math.sin(s2)}`, ...st, "stroke-width": 1 }, s)); if (label) T(a + (r + 10) * Math.cos((s1 + s2) / 2), b - (r + 10) * Math.sin((s1 + s2) / 2) + 4, label); break; }
      } }
  } });
  define("x-segmented", class extends Base { render() { const opts = (this.getAttribute("options") || "").split(",").map((x) => x.trim()); if (!this.value) this.value = this.getAttribute("value") || opts[0]; this.innerHTML = ""; opts.forEach((o) => { const b = document.createElement("button"); b.type = "button"; b.textContent = o; if (o === this.value) b.className = "on"; b.onclick = () => { this.value = o; this.render(); this.dispatchEvent(new Event("change", { bubbles: true })); }; this.appendChild(b); }); } });
  define("x-toggle", class extends Base { init() { this.addEventListener("click", () => { this.toggleAttribute("checked"); this.dispatchEvent(new Event("change", { bubbles: true })); }); } get value() { return this.hasAttribute("checked"); } });
  define("x-youtube", class extends Base { render() { this.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${this.getAttribute("id") || this.getAttribute("vid")}" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>`; } });
  define("x-image", class extends Base { render() { this.innerHTML = `<img src="${this.getAttribute("src")}" alt="${this.getAttribute("alt") || ""}">`; } });
  ["x-stack", "x-row", "x-col", "x-divider", "x-spacer", "x-kbd"].forEach((n) => define(n, class extends HTMLElement {}));

  // ---------- helpers exposed to model code ----------
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const on = (sel, ev, fn) => { (typeof sel === "string" ? $$(sel) : [sel]).forEach((el) => el.addEventListener(ev, fn)); };
  const form = () => { const o = {}; $$("[name]").forEach((el) => { const n = el.getAttribute("name"); if (el.type === "checkbox") o[n] = el.checked; else if (el.type === "radio") { if (el.checked) o[n] = el.value; } else o[n] = el.tagName === "X-TOGGLE" ? el.value : el.value ?? el.getAttribute("value"); if (el.type === "range" || el.type === "number") o[n] = +o[n]; }); return o; };
  let reqId = 0; const pending = {};
  const call = (type, data) => new Promise((res) => { const id = ++reqId; pending[id] = res; post(type, { id, ...data }); });
  const notify = (t) => { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); post("notify", { text: t }); };
  const sendToLm = (data) => { post("lm", { data: typeof data === "string" ? data : JSON.parse(JSON.stringify(data)) }); notify("Sent"); };
  const saveIn = (path, text) => call("save", { path, text: typeof text === "string" ? text : JSON.stringify(text, null, 2) });
  const py = (code) => call("py", { code });
  const store = {};
  const state = (k, init) => ({ get: () => (k in store ? store[k] : init), set: (v) => { store[k] = v; post("state", { key: k, value: v }); } });
  const every = (ms, fn) => setInterval(fn, ms);
  Object.assign(window, { $, $$, on, form, sendToLm, saveIn, py, notify, state, every });
  window.addEventListener("message", (e) => { const m = e.data || {}; if (m.type === "reply" && pending[m.id]) { pending[m.id](m.value); delete pending[m.id]; } if (m.type === "theme") applyTheme(m.vars, m.theme); });
  function applyTheme(vars, theme) { for (const k in vars) document.documentElement.style.setProperty(k, vars[k]); document.body.dataset.theme = theme; }

  // ---------- relational style language ----------
  function parseRel(src) {
    const rules = []; let i = 0; src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    function block(scope, mode) {
      while (i < src.length) {
        const close = src.indexOf("}", i), open = src.indexOf("{", i);
        if (close !== -1 && (open === -1 || close < open)) { const body = src.slice(i, close); addProps(scope, mode, body); i = close + 1; return; }
        if (open === -1) return;
        const pre = src.slice(i, open); const lastSemi = Math.max(pre.lastIndexOf(";"), pre.lastIndexOf("\n") > -1 && /[:=]/.test(pre.slice(0, pre.lastIndexOf("\n"))) ? pre.lastIndexOf("\n") : -1);
        if (lastSemi > -1) addProps(scope, mode, pre.slice(0, lastSemi));
        const sel = pre.slice(lastSemi + 1).trim(); i = open + 1;
        if (sel === "portrait" || sel === "landscape") block(scope, sel);
        else block(sel.split(",").map((x) => x.trim()).flatMap((s) => (scope.length ? scope.map((p) => p + " " + s) : [s])), mode);
      }
    }
    function addProps(scope, mode, body) { const props = {}; body.split(/[;\n]/).forEach((l) => { const m = l.match(/^\s*([\w-]+)\s*[:=]\s*(.+?)\s*$/); if (m) props[m[1]] = m[2]; }); if (Object.keys(props).length && scope.length) rules.push({ sels: scope, mode, props }); }
    block([], "all"); return rules;
  }
  const scopeSel = (s) => s.split(/\s+/).map((p) => (p === "root" || p === "background" ? "#root" : p)).join(" ").replace(/^(?!#root)/, "#root ");
  function compileRel(rules) {
    let out = ""; const groups = [], asides = [];
    for (const r of rules) {
      const pre = r.mode === "all" ? "" : `body[data-o=${r.mode}] `;
      const sel = r.sels.map((s) => pre + scopeSel(s)).join(",").replace(/#root #root/g, "#root"); const p = r.props; let d = "";
      if (p.size) { const n = parseFloat(p.size) || 1; d += `--s:${(0.6 + n * 0.4).toFixed(2)};--g:${n};flex-grow:${n};font-size:${(0.8 + n * 0.2).toFixed(2)}em;`; }
      if (p.orient === "horizontal") d += "flex-direction:row;flex-wrap:wrap;align-self:stretch;width:100%;";
      if (p.orient === "vertical") d += "flex-direction:column;";
      if (p.place === "top") d += "order:-2;"; if (p.place === "bottom") d += "order:99;"; if (p.place === "center") d += "align-self:center;margin-inline:auto;";
      if (p.emphasis === "low") d += "opacity:.62;"; if (p.emphasis === "high") d += "font-weight:600;";
      if (p.tone) d += `--tone:var(--${p.tone === "neutral" ? "muted" : p.tone});`;
      if (p.gap) d += `--gap:${{ tight: "8px", normal: "14px", loose: "24px" }[p.gap] || "14px"};gap:var(--gap);`;
      if (p.width === "fill") d += "flex:1 1 auto;width:100%;"; if (p.width === "hug") d += "flex:0 0 auto;width:auto;align-self:" + (p.align || "start") + ";";
      if (p.align) d += `align-self:${p.align === "start" ? "flex-start" : p.align === "end" ? "flex-end" : "center"};text-align:${p.align};`;
      if (d) out += `${sel}{${d}}\n`;
      if (p.group && r.mode === "all") r.sels.forEach((s) => groups.push({ sel: scopeSel(s), name: p.group }));
      if (p.place === "start" || p.place === "end") r.sels.forEach((s) => asides.push({ sel: scopeSel(s), side: p.place, mode: r.mode }));
    }
    return { css: out, groups, asides };
  }

  // ---------- layout engine ----------
  let REL = { css: "", groups: [], asides: [] };
  function formGroups(root) {
    const byName = {};
    REL.groups.forEach(({ sel, name }) => $$(sel).forEach((el) => { (byName[name] ||= []).includes(el) || byName[name].push(el); }));
    for (const name in byName) { const els = byName[name]; if (!els.length) continue; const first = els[0]; const w = document.createElement("div"); w.className = "grp g-" + name + (els.length > 2 ? " wrap" : ""); first.parentNode.insertBefore(w, first); els.forEach((e) => w.appendChild(e.closest("label") && e.closest("label") !== w && e.closest("label").contains(e) ? e.closest("label") : e)); }
    [...root.children].forEach((c, i) => c.style.setProperty("--i", i));
  }
  let topOrder = null;
  function layout() {
    const root = $("#root"); if (!root) return;
    const o = document.body.classList.contains("fill") ? (innerWidth >= innerHeight * 1.05 ? "landscape" : "portrait") : innerWidth > 520 ? "landscape" : "portrait";
    document.body.dataset.o = o;
    // restore
    const main = root.querySelector(":scope>.main"); if (main) { [...main.children].forEach((c) => root.appendChild(c)); main.remove(); }
    if (topOrder) topOrder.forEach((c) => root.appendChild(c));
    root.classList.remove("aside", "end");
    const a = REL.asides.find((x) => x.mode === "all" || x.mode === o); if (!a) return;
    let el = $(a.sel); if (!el) return; while (el.parentElement && el.parentElement !== root) el = el.parentElement;
    const m = document.createElement("div"); m.className = "main"; [...root.children].filter((c) => c !== el).forEach((c) => m.appendChild(c)); root.appendChild(m);
    root.classList.add("aside"); if (a.side === "end") root.classList.add("end");
  }

  function bindOn(pyFns) {
    $$("[on]").forEach((el) => el.getAttribute("on").split(/\s+/).forEach((pair) => { const [ev, fn] = pair.split(":"); if (!fn) return; el.addEventListener(ev, (e) => { if (pyFns && pyFns(fn, e)) return; if (typeof window[fn] === "function") window[fn](e, el); }); }));
    $$('input[type=range]').forEach((r) => { const u = () => r.style.setProperty("--p", ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0))) * 100 + "%"); u(); r.addEventListener("input", u); });
    $$("button[tone]").forEach(() => {});
  }

  async function runPython(code) {
    await load("https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js");
    const pyo = await window.loadPyodide();
    pyo.globals.set("_js", { el: $, els: $$, form: () => pyo.toPy(form()), send_to_lm: (d) => sendToLm(d?.toJs ? Object.fromEntries(d.toJs()) : d), save_in: saveIn, notify, every: (ms, f) => setInterval(() => f(), ms) });
    await pyo.runPythonAsync(`
from pyodide.ffi import create_proxy
el=_js.el; els=_js.els; notify=_js.notify; save_in=_js.save_in
def form(): return _js.form()
def send_to_lm(d): _js.send_to_lm(__import__('pyodide').ffi.to_js(d))
def every(ms, fn): return _js.every(ms, create_proxy(fn))
`);
    await pyo.runPythonAsync(code);
    return (name, e) => { const f = pyo.globals.get(name); if (!f) return false; try { f.length ? f(e) : f(); } catch (err) { try { f(); } catch (er2) { notify(String(er2).slice(0, 120)); } } return true; };
  }

  window.addEventListener("error", (e) => post("error", { text: String(e.message) }));

  window.BlocksBoot = async function () {
    const root = $("#root");
    const relEl = document.querySelector('script[type="text/rel"]');
    REL = compileRel(parseRel(relEl ? relEl.textContent : ""));
    const st = document.createElement("style"); st.textContent = REL.css; document.head.appendChild(st);
    formGroups(root); topOrder = [...root.children]; layout();
    addEventListener("resize", layout);
    const pySrc = document.querySelector('script[type="text/python"]');
    let pyFns = null;
    bindOn((name, e) => (pyFns ? pyFns(name, e) : false));
    const js = document.querySelector('script[type="text/blocks"]');
    if (js) { try { (0, eval)(js.textContent); } catch (err) { root.insertAdjacentHTML("beforeend", `<div class="err">${err}</div>`); } }
    if (pySrc) { try { pyFns = await runPython(pySrc.textContent); } catch (err) { root.insertAdjacentHTML("beforeend", `<div class="err">${err}</div>`); } }
    const ro = new ResizeObserver(() => post("height", { h: Math.ceil(document.documentElement.scrollHeight) })); ro.observe(document.body);
  };
})();
