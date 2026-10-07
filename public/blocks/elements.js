/* Blocks elements — the component library. Primitives and wrappers only; no templates.
 * Every element: themed by host CSS variables, animated on first paint, re-renders on attribute change,
 * exposes `.value` when it is an input (collected by form() and reactive scope via name="").
 */
(function () {
  "use strict";
  const B = window.Blocks;
  const { num, css, svg, load, esc, fileUrl, fmt, PAL } = B;
  const define = (name, cls, opts = {}) => {
    if (opts.void) B.VOIDX.add(name);
    if (opts.container) B.CONTAINERS.add(name);
    if (!customElements.get(name)) customElements.define(name, cls);
  };
  const drawIn = (p, delay = 0.1) => requestAnimationFrame(() => { let L = 2000; try { L = Math.ceil(p.getTotalLength()) + 2; } catch {} p.style.setProperty("--len", L); p.style.animationDelay = delay + "s"; p.classList.add("draw"); });
  const change = (el) => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const lines = (s) => String(s || "").replace(/\\n/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
  const list = (s, sep) => String(s || "").split(sep || (String(s).includes("|") ? "|" : ",")).map((x) => x.trim()).filter((x) => x !== "");
  const parseVal = (v) => { if (v === null || v === undefined) return v; try { return JSON.parse(v); } catch { return v; } };

  const SKIP = /^(class|style|hidden|id|name|tabindex|role|running|answered|checked|show|each|on|data-.*|aria-.*|@.*|:.*)$/;
  class Base extends HTMLElement {
    connectedCallback() {
      if (!this._init) {
        this._init = true;
        this._src = this.textContent;
        if (this.constructor.owns) { this.__owns = true; this.textContent = ""; }
        this.init && this.init();
        new MutationObserver(() => this.queue()).observe(this, { attributes: true });
      }
      this.queue(true);
    }
    sig() { return [...this.attributes].filter((a) => !SKIP.test(a.name)).map((a) => a.name + "=" + a.value).join("\u0001"); }
    queue(now) {
      const s = this.sig();
      if (s === this._sig) return;
      if (now) { this._sig = s; this.render && this.render(); return; }
      if (this._q) return;
      this._q = requestAnimationFrame(() => { this._q = 0; const s2 = this.sig(); if (s2 === this._sig) return; this._sig = s2; this.render && this.render(); });
    }
    refresh(force) { if (force) { this._sig = null; this.queue(true); } }
    a(n, d) { const v = this.getAttribute(n); return v === null ? d : v; }
    n(n, d) { return num(this.getAttribute(n), d); }
    get tone() { return this.getAttribute("tone"); }
  }
  B.Base = Base; B.define = define;

  // skeleton shapes for elements still streaming
  const VIZ = /chart|graph|plot|draw|smiles|mol|mermaid|map|heatmap|sketch|image|video|youtube|embed|clock|ring|gauge|table|timeline|md|code|flow|tree/;
  B.skelKind = (t) => (VIZ.test(t) ? "viz" : /choice|sortable|kv|callout|list/.test(t) ? "list" : /input|select|textarea|segmented|toggle|rating|timer|stat|button|upload/.test(t) ? "line" : "block");

  // ================================================================ layout
  define("x-stack", class extends HTMLElement {}, { container: true });
  define("x-row", class extends HTMLElement {}, { container: true });
  define("x-col", class extends HTMLElement {}, { container: true });
  define("x-grid", class extends Base { render() { this.style.setProperty("--cols", this.a("cols", 2)); } }, { container: true });
  // reactive header from title=… (attribute is consumed so the browser shows no tooltip over the whole box)
  function header(el, cls, tag, html) {
    const t = el.getAttribute("title");
    if (t !== null) { el._title = t; el.removeAttribute("title"); }
    const sub = el.getAttribute("subtitle");
    if (el._title == null && !sub) return;
    if (!el._h) { el._h = document.createElement(tag); el._h.className = cls; el.prepend(el._h); }
    const out = html(el._title || "", sub || "");
    if (el._h.innerHTML !== out) el._h.innerHTML = out;
  }
  define("x-card", class extends Base { render() { header(this, "x-card-t", "div", (t) => esc(t)); } }, { container: true });
  define("x-section", class extends Base { render() { header(this, "x-sec-h", "header", (t, s) => (t ? `<h2>${esc(t)}</h2>` : "") + (s ? `<p>${esc(s)}</p>` : "")); } }, { container: true });
  define("x-divider", class extends Base { render() { const l = this.getAttribute("label"); this.innerHTML = l ? `<span>${esc(l)}</span>` : ""; } }, { void: true });
  define("x-spacer", class extends HTMLElement {}, { void: true });

  // tabs: <x-tabs><x-tab label="A">…</x-tab>…</x-tabs>
  define("x-tabs", class extends Base {
    init() {
      this._bar = document.createElement("div"); this._bar.className = "x-tabs-bar"; this.prepend(this._bar);
      this.index = this.n("index", 0);
      new MutationObserver(() => this.build()).observe(this, { childList: true });
    }
    tabs() { return [...this.children].filter((c) => c !== this._bar); }
    build() {
      const tabs = this.tabs();
      if (this._bar.childElementCount !== tabs.length) this._bar.innerHTML = tabs.map((t, i) => `<button type="button" data-i="${i}">${esc(t.getAttribute("label") || "Tab " + (i + 1))}</button>`).join("");
      [...this._bar.children].forEach((b, i) => { b.classList.toggle("on", i === this.index); b.onclick = () => this.go(i); });
      tabs.forEach((t, i) => { const on = i === this.index; if (t.hidden === on) { t.hidden = !on; if (on) { t.classList.remove("x-tab-in"); void t.offsetWidth; t.classList.add("x-tab-in"); } } });
    }
    go(i) { this.index = Math.max(0, Math.min(this.tabs().length - 1, i)); this.build(); change(this); }
    get value() { return this.index; }
    render() { this.build(); }
  }, { container: true });
  define("x-tab", class extends HTMLElement {}, { container: true });

  // deck: one child at a time. <x-deck nav="numbers|dots|steps|none"> children… </x-deck>
  define("x-deck", class extends Base {
    init() {
      this.index = this.n("index", 0);
      this._view = document.createElement("div"); this._view.className = "x-deck-view";
      this._nav = document.createElement("div"); this._nav.className = "x-deck-nav";
      this.append(this._nav);
      new MutationObserver(() => this.build()).observe(this, { childList: true });
      this.addEventListener("change", (e) => { if (e.target !== this) this.marks(); });
      this.addEventListener("keydown", (e) => { if (e.target.closest("input,textarea,select")) return; if (e.key === "ArrowRight") this.next(); if (e.key === "ArrowLeft") this.prev(); });
      this.tabIndex = -1;
    }
    slides() { return [...this.children].filter((c) => c !== this._nav && c !== this._view); }
    get count() { return this.slides().length; }
    get value() { return this.index; }
    build() {
      const sl = this.slides(), mode = this.a("nav", sl.length > 12 ? "dots" : "numbers");
      if (this._nav.nextSibling) this.append(this._nav);
      sl.forEach((s, i) => { const on = i === this.index; if (s.hidden === on || s._b === undefined) { s._b = 1; s.hidden = !on; if (on) { s.classList.remove("x-slide-in", "x-slide-back"); void s.offsetWidth; s.classList.add(this._back ? "x-slide-back" : "x-slide-in"); } } });
      if (mode === "none") { this._nav.hidden = true; return; }
      const items = sl.map((s, i) => `<button type="button" class="x-dn${mode === "dots" ? " dot" : ""}" data-i="${i}" aria-label="${i + 1}">${mode === "dots" ? "" : mode === "steps" ? esc(s.getAttribute("label") || i + 1) : i + 1}</button>`).join("");
      this._nav.innerHTML = `<button type="button" class="x-dp" aria-label="Previous">‹</button><div class="x-dl">${items}</div><button type="button" class="x-dx" aria-label="Next">›</button>`;
      this._nav.querySelector(".x-dp").onclick = () => this.prev();
      this._nav.querySelector(".x-dx").onclick = () => this.next();
      this._nav.querySelectorAll(".x-dn").forEach((b) => (b.onclick = () => this.go(+b.dataset.i)));
      this.marks();
    }
    marks() {
      const sl = this.slides();
      this._nav.querySelectorAll(".x-dn").forEach((b, i) => {
        b.classList.toggle("on", i === this.index);
        const s = sl[i]; if (!s) return;
        const answered = [...s.querySelectorAll("[name]")].some((x) => { const v = x.value; return x.type === "radio" || x.type === "checkbox" ? x.checked : Array.isArray(v) ? v.length : v !== undefined && v !== null && v !== "" && x.tagName !== "INPUT"; });
        b.classList.toggle("done", answered);
        const flag = s.getAttribute("tone"); b.dataset.tone = flag || "";
      });
      const p = this._nav.querySelector(".x-dp"), x = this._nav.querySelector(".x-dx");
      if (p) p.disabled = this.index === 0; if (x) x.disabled = this.index >= sl.length - 1;
    }
    go(i) { const n = this.slides().length; const j = this.hasAttribute("loop") ? (i + n) % n : Math.max(0, Math.min(n - 1, i)); this._back = j < this.index; this.index = j; this.build(); change(this); }
    next() { this.go(this.index + 1); } prev() { this.go(this.index - 1); }
    render() { this.build(); }
  }, { container: true });
  define("x-slide", class extends HTMLElement {}, { container: true });

  // ================================================================ content
  define("x-badge", class extends Base { render() { const t = this.tone; this.style.setProperty("--tone", t ? `var(--${t === "neutral" ? "muted" : t})` : "var(--muted)"); } });
  define("x-kbd", class extends HTMLElement {});
  define("x-icon", class extends Base {
    render() { const n = this.getAttribute("name"); if (!n || this._n === n) return; this._n = n; B.libFetch("lucide", `${encodeURIComponent(n)}.svg`).then((r) => (r.ok ? r.text() : "")).then((t) => { this.innerHTML = t; }).catch(() => {}); }
  }, { void: true });
  define("x-callout", class extends Base { render() { header(this, "x-callout-t", "div", (t) => esc(t)); } }, { container: true });
  define("x-kv", class extends Base {
    static owns = true;
    render() { this.innerHTML = lines(this.getAttribute("data") || this._src).map((l) => { const i = l.indexOf(":"); return i < 0 ? `<div class="k">${esc(l)}</div><div></div>` : `<div class="k">${esc(l.slice(0, i))}</div><div class="v">${esc(l.slice(i + 1).trim())}</div>`; }).join(""); B.typeset(this); }
  });
  define("x-md", class extends Base {
    static owns = true;
    render() {
      const src = this.getAttribute("text") || this._src || "";
      const put = () => { this.innerHTML = window.marked ? window.marked.parse(src.replace(/^\n+/, "").replace(/^[ \t]+/gm, "")) : `<p>${esc(src)}</p>`; B.typeset(this); };
      if (window.marked) put(); else B.loadLib("marked", "marked.umd.js").then(put, put);
    }
  });
  define("x-code", class extends Base {
    static owns = true;
    render() {
      const code = (this._src || "").replace(/^\n/, "").replace(/\s+$/, ""), lang = this.a("lang", "");
      this.innerHTML = `<div class="x-code-h"><span>${esc(lang)}</span><button type="button">Copy</button></div><pre><code>${esc(code)}</code></pre>`;
      this.querySelector("button").onclick = (e) => { navigator.clipboard.writeText(code); e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy"), 1200); };
      B.loadLib("hljs", "highlight.min.js").then(() => { const c = this.querySelector("code"); try { c.innerHTML = lang && window.hljs.getLanguage(lang) ? window.hljs.highlight(code, { language: lang }).value : window.hljs.highlightAuto(code).value; } catch {} }).catch(() => {});
    }
  });

  // ================================================================ data display
  define("x-stat", class extends Base {
    render() {
      let raw = this.a("value", ""); const d = this.getAttribute("delta"), unit = this.a("unit", "");
      if (/^[[{]/.test(raw.trim())) { try { raw = B.show(JSON.parse(raw)); } catch {} } // bound object/array: readable text, never raw JSON
      this.innerHTML = `<span class="v"></span><span class="l">${esc(this.a("label", ""))}</span>${d ? `<span class="d ${d.trim().startsWith("-") ? "neg" : ""}">${esc(d)}</span>` : ""}`;
      const v = this.querySelector(".v"), m = String(raw).match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
      if (!m || this._shown === raw) { v.textContent = raw + (unit ? " " + unit : ""); this._shown = raw; return; }
      const target = parseFloat(m[2].replace(/,/g, "")), dec = (m[2].split(".")[1] || "").length, from = this._last ?? 0, t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3), x = from + (target - from) * e; v.textContent = m[1] + x.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3] + (unit ? " " + unit : ""); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step); this._last = target; this._shown = raw;
    }
  }, { void: true });
  define("x-progress", class extends Base {
    render() {
      if (!this._i) { this._i = document.createElement("i"); this.appendChild(this._i); this._i.style.width = "0"; }
      const max = this.n("max", 1), v = Math.max(0, Math.min(1, this.n("value", 0) / (max || 1)));
      const t = this.tone; if (t) this.style.setProperty("--tone", `var(--${t})`);
      requestAnimationFrame(() => (this._i.style.width = v * 100 + "%"));
    }
  }, { void: true });
  define("x-ring", class extends Base {
    render() {
      const max = this.n("max", 1), v = Math.max(0, Math.min(1, this.n("value", 0) / (max || 1))), C = 2 * Math.PI * 42;
      if (!this._s) {
        this._s = svg("svg", { viewBox: "0 0 100 100" }, this);
        svg("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "var(--line)", "stroke-width": 6 }, this._s);
        this._c = svg("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "var(--tone)", "stroke-width": 6, "stroke-linecap": "round", transform: "rotate(-90 50 50)", "stroke-dasharray": C, "stroke-dashoffset": C }, this._s);
        this._c.style.transition = "stroke-dashoffset .9s cubic-bezier(.2,.7,.2,1)";
        this._t = svg("text", { x: 50, y: 56, "text-anchor": "middle", "font-size": 17, "font-weight": 600, fill: "var(--fg)" }, this._s);
      }
      const t = this.tone; if (t) this.style.setProperty("--tone", `var(--${t})`);
      this._t.textContent = this.getAttribute("label") ?? Math.round(v * 100) + "%";
      requestAnimationFrame(() => requestAnimationFrame(() => this._c.setAttribute("stroke-dashoffset", C * (1 - v))));
    }
  }, { void: true });
  define("x-gauge", class extends Base {
    render() {
      const min = this.n("min", 0), max = this.n("max", 100), v = Math.max(min, Math.min(max, this.n("value", 0))), k = (v - min) / (max - min || 1);
      this.innerHTML = ""; const s = svg("svg", { viewBox: "0 0 120 72" }, this);
      const arc = "M10,64 A50,50 0 0 1 110,64";
      svg("path", { d: arc, fill: "none", stroke: "var(--line)", "stroke-width": 9, "stroke-linecap": "round" }, s);
      const p = svg("path", { d: arc, fill: "none", stroke: "var(--tone)", "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": `0 400` }, s);
      const L = Math.PI * 50; p.style.transition = "stroke-dasharray 1s cubic-bezier(.2,.7,.2,1)";
      requestAnimationFrame(() => requestAnimationFrame(() => p.setAttribute("stroke-dasharray", `${L * k} 400`)));
      svg("text", { x: 60, y: 58, "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: "var(--fg)" }, s).textContent = this.getAttribute("display") ?? v;
      const l = this.getAttribute("label"); if (l) svg("text", { x: 60, y: 71, "text-anchor": "middle", "font-size": 8, fill: "var(--muted)" }, s).textContent = l;
      const t = this.tone; if (t) this.style.setProperty("--tone", `var(--${t})`);
    }
  }, { void: true });

  // charts: type=line|bar|hbar|stacked|area|pie|donut|scatter|radar
  const names = (v) => { v = String(v ?? "").trim(); if (!v) return []; if (v[0] === "[") { try { return JSON.parse(v).map(String); } catch {} } return list(v, v.includes("|") ? "|" : ","); };
  const yOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v.y ?? v.value ?? v.v : v);
  // accepts "1,2|3,4", JSON arrays, rows of records (x= / y= pick keys), [{name, values}], {labels, datasets}, {name: [..]}
  function series(el) {
    const raw = (el.getAttribute("data") || "").trim();
    let nm = names(el.getAttribute("series")), labels = names(el.getAttribute("labels")), d = [];
    if (/^[[{]/.test(raw)) {
      let j; try { j = JSON.parse(raw); } catch { j = []; }
      const rec = (r) => r && typeof r === "object" && !Array.isArray(r);
      if (Array.isArray(j) && j.length && j.every(rec) && !j.some((r) => Array.isArray(r.values) || Array.isArray(r.data))) {
        const keys = Object.keys(j[0]), xk = el.getAttribute("x") || keys.find((k) => typeof j[0][k] === "string") || null;
        const yk = el.getAttribute("y") ? names(el.getAttribute("y")) : keys.filter((k) => k !== xk && typeof j[0][k] === "number");
        if (xk && !labels.length) labels = j.map((r) => String(r[xk]));
        d = yk.map((k) => j.map((r) => r[k])); if (!nm.length) nm = yk;
      } else if (Array.isArray(j) && j.length && rec(j[0])) {
        d = j.map((r) => (r.values || r.data || []).map(yOf)); if (!nm.length) nm = j.map((r) => r.name || r.label || "");
        if (!labels.length && Array.isArray(j[0].labels)) labels = j[0].labels.map(String);
      } else if (Array.isArray(j)) d = el.getAttribute("type") === "scatter" ? (Array.isArray(j[0]) && Array.isArray(j[0][0]) ? j : [j]) : j.every(Array.isArray) ? j : [j];
      else if (rec(j)) {
        if (Array.isArray(j.labels)) labels = j.labels.map(String);
        const sets = j.datasets || j.series;
        if (Array.isArray(sets)) { d = sets.map((r) => (Array.isArray(r) ? r : r.values || r.data || []).map(yOf)); if (!nm.length) nm = sets.map((r) => r.name || r.label || ""); }
        else { const ks = Object.keys(j).filter((k) => Array.isArray(j[k]) && k !== "labels"); d = ks.map((k) => j[k]); if (!nm.length) nm = ks; }
      }
    } else d = raw.split("|").map((x) => x.split(",").map((y) => y.trim()).filter((y) => y !== ""));
    return { series: d.map((arr, i) => ({ name: nm[i] || "", values: arr.map((v) => (el.getAttribute("type") === "scatter" ? v : yOf(v))) })), labels };
  }
  const nice = (lo, hi, n = 4) => { const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0; const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step; const t = []; for (let v = a; v <= b + step / 2; v += step) t.push(+v.toFixed(10)); return t; };
  const short = (v) => { v = +v; const a = Math.abs(v); if (!a) return 0; if (a >= 1e12 || a < 1e-3) return v.toExponential(a >= 1e12 ? 1 : 1).replace("e+", "e"); if (a >= 1e9) return +(v / 1e9).toFixed(1) + "B"; if (a >= 1e6) return +(v / 1e6).toFixed(1) + "M"; if (a >= 1e4) return +(v / 1e3).toFixed(1) + "k"; return +v.toFixed(a < 1 ? 3 : 2); };
  B.short = short;
  define("x-chart", class extends Base {
    render() {
      this.innerHTML = ""; this.dataset.themed = "";
      const type = this.a("type", "line"), { series: S, labels } = series(this), pal = PAL();
      const legend = (items) => { const lg = document.createElement("div"); lg.className = "legend"; lg.innerHTML = items.map(([n, c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join(""); this.appendChild(lg); };
      const title = this.getAttribute("title"); if (title) { const h = document.createElement("div"); h.className = "x-chart-t"; h.textContent = title; this.appendChild(h); }
      if (type === "pie" || type === "donut") {
        const vals = (S[0]?.values || []).map(Number), tot = vals.reduce((a, b) => a + b, 0) || 1;
        const s = svg("svg", { viewBox: "0 0 200 200", class: "pie" }, this);
        const r = type === "donut" ? 70 : 45, w = type === "donut" ? 26 : 90, C = 2 * Math.PI * r; let acc = 0;
        vals.forEach((v, i) => {
          const c = svg("circle", { cx: 100, cy: 100, r, fill: "none", stroke: pal[i % pal.length], "stroke-width": w, "stroke-dasharray": `0 ${C}`, transform: `rotate(${-90 + (acc / tot) * 360} 100 100)` }, s);
          svg("title", {}, c).textContent = `${labels[i] || i + 1}: ${v}`;
          c.style.transition = `stroke-dasharray .8s cubic-bezier(.2,.7,.2,1) ${i * 0.1}s`;
          requestAnimationFrame(() => requestAnimationFrame(() => c.setAttribute("stroke-dasharray", `${(v / tot) * C} ${C}`))); acc += v;
        });
        if (type === "donut" && this.getAttribute("center")) svg("text", { x: 100, y: 107, "text-anchor": "middle", "font-size": 20, "font-weight": 600, fill: "var(--fg)" }, s).textContent = this.getAttribute("center");
        legend(vals.map((v, i) => [`${labels[i] || i + 1} · ${Math.round((v / tot) * 100)}%`, pal[i % pal.length]])); return;
      }
      if (type === "radar") {
        const n = labels.length || S[0]?.values.length || 3, max = this.n("max", Math.max(...S.flatMap((x) => x.values.map(Number)), 1));
        const s = svg("svg", { viewBox: "-20 -10 240 220" }, this), cx = 100, cy = 100, R = 80;
        const pt = (i, v) => [cx + Math.sin((i / n) * 2 * Math.PI) * R * v, cy - Math.cos((i / n) * 2 * Math.PI) * R * v];
        [0.25, 0.5, 0.75, 1].forEach((k) => svg("polygon", { points: Array.from({ length: n }, (_, i) => pt(i, k).join(",")).join(" "), class: "ax", fill: "none" }, s));
        for (let i = 0; i < n; i++) { const [x, y] = pt(i, 1.14); svg("text", { x, y: y + 3, "text-anchor": "middle", class: "lbl" }, s).textContent = labels[i] || ""; }
        S.forEach((se, si) => { const p = svg("polygon", { points: se.values.map((v, i) => pt(i, num(v) / max).join(",")).join(" "), fill: pal[si % pal.length], "fill-opacity": 0.14, stroke: pal[si % pal.length], "stroke-width": 1.8, class: "pop" }, s); p.style.animationDelay = si * 0.15 + "s"; });
        if (S.length > 1) legend(S.map((se, i) => [se.name || `Series ${i + 1}`, pal[i % pal.length]])); return;
      }
      const W = 360, H = 200, P = { l: 36, r: 10, t: 10, b: 26 };
      const s = svg("svg", { viewBox: `0 0 ${W} ${H}` }, this);
      if (type === "scatter") {
        const pts = S.flatMap((se, si) => se.values.map((p) => [...(Array.isArray(p) ? p.map(Number) : p && typeof p === "object" ? [+p.x, +p.y] : String(p).split(/[:;]/).map(Number)), si])).filter((p) => isFinite(p[0]) && isFinite(p[1]));
        const xs = nice(Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))), ys = nice(Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])));
        const X = (v) => P.l + ((v - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * (W - P.l - P.r), Y = (v) => H - P.b - ((v - ys[0]) / (ys[ys.length - 1] - ys[0] || 1)) * (H - P.t - P.b);
        ys.forEach((v) => { svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: "ax" }, s); svg("text", { x: P.l - 5, y: Y(v) + 3, "text-anchor": "end", class: "lbl" }, s).textContent = short(v); });
        xs.forEach((v) => (svg("text", { x: X(v), y: H - 8, "text-anchor": "middle", class: "lbl" }, s).textContent = short(v)));
        pts.forEach((p, i) => { const c = svg("circle", { cx: X(p[0]), cy: Y(p[1]), r: 3.4, fill: pal[p[2] % pal.length], class: "pop" }, s); c.style.animationDelay = Math.min(i * 15, 800) + "ms"; svg("title", {}, c).textContent = `${p[0]}, ${p[1]}`; });
        this.axisLabels(s, W, H); if (S.length > 1) legend(S.map((se, i) => [se.name || `Series ${i + 1}`, pal[i % pal.length]])); return;
      }
      const n = Math.max(...S.map((x) => x.values.length), 1), stacked = type === "stacked", horiz = type === "hbar";
      const sums = Array.from({ length: n }, (_, i) => S.reduce((a, se) => a + num(se.values[i]), 0));
      const all = stacked ? sums : S.flatMap((x) => x.values.map(Number));
      // a series 50× smaller than the rest gets its own right-hand axis instead of flattening into the baseline
      const mag = S.map((se) => Math.max(...se.values.map((x) => Math.abs(num(x))), 0)), top = Math.max(...mag, 0);
      const right = new Set(!stacked && !horiz && type !== "bar" && S.length > 1 ? mag.map((m, i) => (m > 0 && m < top / 50 ? i : -1)).filter((i) => i >= 0) : []);
      const leftVals = stacked ? sums : S.flatMap((x, i) => (right.has(i) ? [] : x.values.map(Number)));
      const ticks = nice(Math.min(0, ...(right.size ? leftVals : all)), Math.max(0, ...(right.size ? leftVals : all))), lo = ticks[0], hi = ticks[ticks.length - 1];
      const rVals = S.flatMap((x, i) => (right.has(i) ? x.values.map(Number) : []));
      const rt = right.size ? nice(Math.min(0, ...rVals), Math.max(0, ...rVals)) : null;
      P.l = Math.max(30, 8 + 6 * Math.max(...ticks.map((t) => String(short(t)).length))); if (rt) P.r = Math.max(30, 8 + 6 * Math.max(...rt.map((t) => String(short(t)).length)));
      if (horiz) {
        const L = 70, bh = ((H - P.t - P.b) / n) * 0.7, X = (v) => L + ((v - lo) / (hi - lo || 1)) * (W - L - P.r), Y = (i) => P.t + ((i + 0.5) * (H - P.t - P.b)) / n;
        ticks.forEach((v) => { svg("line", { x1: X(v), x2: X(v), y1: P.t, y2: H - P.b, class: "ax" }, s); svg("text", { x: X(v), y: H - 8, "text-anchor": "middle", class: "lbl" }, s).textContent = short(v); });
        S.forEach((se, si) => se.values.forEach((v, i) => { const r = svg("rect", { x: X(Math.min(0, v)), y: Y(i) - bh / 2 + (si * bh) / S.length, width: Math.abs(X(v) - X(0)), height: bh / S.length - 2, rx: 3, fill: pal[si % pal.length], class: "growx" }, s); r.style.animationDelay = i * 40 + "ms"; svg("title", {}, r).textContent = `${labels[i] || ""} ${v}`; }));
        labels.forEach((l, i) => (svg("text", { x: L - 6, y: Y(i) + 3, "text-anchor": "end", class: "lbl" }, s).textContent = l.slice(0, 12)));
        if (S.length > 1) legend(S.map((se, i) => [se.name || `Series ${i + 1}`, pal[i % pal.length]])); return;
      }
      const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo || 1));
      const Yr = rt ? (v) => P.t + (H - P.t - P.b) * (1 - (v - rt[0]) / (rt[rt.length - 1] - rt[0] || 1)) : Y;
      if (rt) rt.forEach((v) => (svg("text", { x: W - P.r + 5, y: Yr(v) + 3, "text-anchor": "start", class: "lbl" }, s).textContent = short(v)));
      ticks.forEach((v) => { svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: "ax" }, s); svg("text", { x: P.l - 5, y: Y(v) + 3, "text-anchor": "end", class: "lbl" }, s).textContent = short(v); });
      const bar = type === "bar" || stacked, X = (i) => P.l + (bar ? ((i + 0.5) * (W - P.l - P.r)) / n : n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
      labels.forEach((l, i) => { if (i < n && (n <= 12 || i % Math.ceil(n / 10) === 0)) svg("text", { x: X(i), y: H - 8, "text-anchor": "middle", class: "lbl" }, s).textContent = l; });
      const base = Array(n).fill(0), Y0 = Y;
      S.forEach((se, si) => {
        const col = pal[si % pal.length], v = se.values.map(Number), Y = right.has(si) ? Yr : Y0;
        if (bar) {
          const bw = ((W - P.l - P.r) / n) * 0.66 / (stacked ? 1 : S.length);
          v.forEach((val, i) => {
            const y0 = stacked ? base[i] : 0, y1 = y0 + val; base[i] = stacked ? y1 : 0;
            const r = svg("rect", { x: X(i) - (stacked ? bw / 2 : (bw * S.length) / 2 - si * bw), y: Y(Math.max(y0, y1)), width: bw - 2, height: Math.max(0.5, Math.abs(Y(y1) - Y(y0))), rx: 3, fill: col, class: "grow" }, s);
            r.style.animationDelay = i * 40 + si * 70 + "ms"; svg("title", {}, r).textContent = `${se.name ? se.name + " · " : ""}${labels[i] || ""} ${val}`;
          });
        } else {
          const d = v.map((val, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(" ");
          if (type === "area") { const a = svg("path", { d: `${d} L${X(v.length - 1)},${Y(Math.max(lo, 0))} L${X(0)},${Y(Math.max(lo, 0))} Z`, fill: col, opacity: 0.13, class: "pop" }, s); a.style.animationDelay = ".7s"; }
          drawIn(svg("path", { d, fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, s), 0.1 + si * 0.15);
          if (n <= 24) v.forEach((val, i) => { const c = svg("circle", { cx: X(i), cy: Y(val), r: 2.6, fill: "var(--bg)", stroke: col, "stroke-width": 1.5, class: "pop" }, s); c.style.animationDelay = 0.9 + i * 0.02 + "s"; svg("title", {}, c).textContent = `${labels[i] || i}: ${val}`; });
        }
      });
      this.axisLabels(s, W, H);
      if (S.length > 1) legend(S.map((se, i) => [(se.name || `Series ${i + 1}`) + (right.has(i) ? " (right axis)" : ""), pal[i % pal.length]]));
    }
    axisLabels(s, W, H) {
      const xl = this.getAttribute("x-label"), yl = this.getAttribute("y-label");
      if (xl) svg("text", { x: W / 2, y: H + 12, "text-anchor": "middle", class: "lbl" }, s).textContent = xl;
      if (yl) svg("text", { x: -H / 2, y: 9, transform: "rotate(-90)", "text-anchor": "middle", class: "lbl" }, s).textContent = yl;
    }
  }, { void: true });
  define("x-sparkline", class extends Base {
    render() { this.innerHTML = ""; const v = list(this.getAttribute("data")).map(Number); const mx = Math.max(...v), mn = Math.min(...v), r = mx - mn || 1; const s = svg("svg", { viewBox: "0 0 100 30", preserveAspectRatio: "none" }, this); drawIn(svg("path", { d: v.map((x, i) => `${i ? "L" : "M"}${(i / (v.length - 1 || 1)) * 100},${28 - ((x - mn) / r) * 26}`).join(" "), fill: "none", stroke: "var(--tone)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }, s)); }
  }, { void: true });
  define("x-table", class extends Base {
    static owns = true;
    render() {
      let rows;
      const d = this.getAttribute("data");
      if (d) { try { const j = JSON.parse(d); rows = Array.isArray(j[0]) ? j : [Object.keys(j[0] || {}), ...j.map((o) => Object.values(o))]; } catch { rows = []; } }
      else { const src = (this.getAttribute("csv") || this._src || "").replace(/\\n/g, "\n").trim(); const sep = src.includes("\t") ? "\t" : src.split("\n")[0].includes("|") ? "|" : ","; rows = src.split("\n").map((r) => r.replace(/^\||\|$/g, "").split(sep).map((c) => c.trim())).filter((r) => !r.every((c) => /^:?-+:?$/.test(c))); }
      if (!rows.length) return;
      this._rows = rows; this._sort = this._sort || null; this.paint();
    }
    paint() {
      const [head, ...body] = this._rows; let b = body;
      if (this._sort) { const [c, dir] = this._sort; b = [...body].sort((x, y) => { const p = parseFloat(x[c]), q = parseFloat(y[c]); const r = !isNaN(p) && !isNaN(q) ? p - q : String(x[c]).localeCompare(String(y[c])); return dir * r; }); }
      this.innerHTML = `<table><thead><tr>${head.map((h, i) => `<th data-c="${i}">${esc(h)}${this._sort && this._sort[0] === i ? (this._sort[1] > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${b.map((r, ri) => `<tr style="--i:${Math.min(ri, 20)}">${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      if (this.hasAttribute("sortable")) this.querySelectorAll("th").forEach((th) => (th.onclick = () => { const c = +th.dataset.c; this._sort = this._sort && this._sort[0] === c ? [c, -this._sort[1]] : [c, 1]; this.paint(); }));
      B.typeset(this);
    }
  });
  define("x-heatmap", class extends Base {
    render() {
      const rows = String(this.getAttribute("data") || "").split("|").map((r) => r.split(",").map(Number));
      const xl = list(this.getAttribute("x-labels") || ""), yl = list(this.getAttribute("y-labels") || "");
      const all = rows.flat().filter((x) => !isNaN(x)), mn = Math.min(...all), mx = Math.max(...all);
      this.innerHTML = `<div class="hm" style="grid-template-columns:${yl.length ? "auto " : ""}repeat(${Math.max(...rows.map((r) => r.length))},1fr)">${xl.length ? (yl.length ? "<span></span>" : "") + xl.map((l) => `<span class="hl">${esc(l)}</span>`).join("") : ""}${rows.map((r, i) => (yl.length ? `<span class="hl y">${esc(yl[i] || "")}</span>` : "") + r.map((v, j) => `<i title="${v}" style="--k:${((v - mn) / (mx - mn || 1)).toFixed(3)};animation-delay:${(i + j) * 12}ms"></i>`).join("")).join("")}</div>`;
    }
  }, { void: true });
  define("x-timeline", class extends Base {
    static owns = true;
    render() { this.innerHTML = lines(this._src).map((l, i) => { const [d, t, x] = l.split("|").map((s) => s.trim()); return `<div class="tl" style="--i:${i}"><span class="tl-d">${esc(d || "")}</span><div><b>${esc(t || "")}</b>${x ? `<p>${esc(x)}</p>` : ""}</div></div>`; }).join(""); B.typeset(this); }
  });

  // ================================================================ math & science
  define("x-math", class extends Base {
    static owns = true;
    render() { const tex = this.getAttribute("tex") || this._src || ""; B.katex().then(() => { this.innerHTML = window.katex.renderToString(tex.trim(), { displayMode: !this.hasAttribute("inline"), throwOnError: false }); }); }
  });

  // interactive function graph (Desmos-like). fn="a*sin(x); x^2+y^2=16; x=cos(t), y=sin(t); r=2sin(3θ)"
  // params come from scope (named inputs / state). Drawn in real pixels: resizing reveals more plane, never stretches.
  const MATHN = new Set(Object.getOwnPropertyNames(Math).concat(["x", "t", "theta", "r", "e", "pi", "ln", "log10", "sec", "csc", "cot"]));
  function compileExpr(src, vars) {
    let e = String(src).replace(/\*\*/g, "^").replace(/\^/g, "**").replace(/π/g, "PI").replace(/θ/g, "theta").replace(/\bpi\b/g, "PI").replace(/\bln\(/g, "log(").replace(/√\(?/g, "sqrt(").replace(/·|×/g, "*")
      .replace(/(\d)\s*([a-zA-Z(])/g, "$1*$2").replace(/\)\s*([a-zA-Z(\d])/g, ")*$1").replace(/\|([^|]+)\|/g, "abs($1)");
    const own = new Set(vars.split(",").map((x) => x.trim()));
    const free = [...new Set((e.match(/\b[a-zA-Z_]\w*\b/g) || []).filter((w) => !own.has(w) && !MATHN.has(w) && !MATHN.has(w.toLowerCase())))];
    const pro = free.map((w) => `const ${w}=+v[${JSON.stringify(w)}]||0;`).join("");
    // eslint-disable-next-line no-new-func
    const f = new Function(vars, "v", `with(Math){const e=E,sec=(z)=>1/cos(z),csc=(z)=>1/sin(z),cot=(z)=>1/tan(z);${pro}return (${e});}`);
    return { f, free };
  }
  // split "a, b" at the top-level comma only
  const topSplit = (s) => { let d = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "(" || c === "[") d++; else if (c === ")" || c === "]") d--; else if (c === "," && !d) return [s.slice(0, i), s.slice(i + 1)]; } return [s]; };
  function parseFns(src) {
    const parts = String(src).split(/;|\n/).map((s) => s.trim()).filter(Boolean), out = [];
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i]; let m;
      const X = /^x\s*(?:\(\s*t\s*\))?\s*=\s*(.+)$/, Y = /^y\s*(?:\(\s*t\s*\))?\s*=\s*(.+)$/;
      const pair = (a, b, label) => { const fx = compileExpr(a, "t"), fy = compileExpr(b, "t"); out.push({ kind: "param", fx: fx.f, fy: fy.f, free: [...fx.free, ...fy.free], label }); };
      const two = topSplit(s);
      if (two.length === 2 && X.test(two[0].trim()) && Y.test(two[1].trim())) { pair(two[0].trim().match(X)[1], two[1].trim().match(Y)[1], s); continue; }
      if ((m = s.match(X)) && /\bt\b/.test(m[1]) && parts[i + 1] && Y.test(parts[i + 1])) { pair(m[1], parts[i + 1].match(Y)[1], `${s}, ${parts[i + 1]}`); i++; continue; }
      if ((m = s.match(/^\(\s*(.+)\s*\)$/)) && topSplit(m[1]).length === 2 && /\bt\b/.test(m[1])) { const [a, b] = topSplit(m[1]); pair(a, b, s); continue; }
      if ((m = s.match(/^r\s*(?:\(\s*(?:θ|theta)\s*\))?\s*=\s*(.+)$/))) { const R = compileExpr(m[1], "theta"); out.push({ kind: "polar", f: R.f, free: R.free, label: s }); continue; }
      const fm = s.match(/^(?:y|[a-z]\s*\(\s*x\s*\))\s*=\s*(.+)$/);
      if (fm && !/(^|[^\w])y([^\w]|$)/.test(fm[1])) { const c = compileExpr(fm[1], "x"); out.push({ kind: "fn", f: c.f, free: c.free, label: s.startsWith("y") ? s : "y = " + fm[1] }); continue; }
      const eq = s.match(/^([^=<>]+?)\s*(?:=|<=|>=|<|>)\s*([^=<>]+)$/);
      if (eq) { const c = compileExpr(`(${eq[1]})-(${eq[2]})`, "x,y"); out.push({ kind: "implicit", f: c.f, free: c.free, label: s }); continue; }
      const c = compileExpr(s, "x"); out.push({ kind: "fn", f: c.f, free: c.free, label: "y = " + s });
    }
    return out;
  }
  define("x-graph", class extends Base {
    static owns = true;
    init() {
      this.dataset.reactive = ""; this.dataset.themed = "";
      this._wrap = document.createElement("div"); this._wrap.className = "gw"; this.appendChild(this._wrap);
      this._wrap.style.height = this.n("height", document.body.classList.contains("fill") ? 340 : 260) + "px";
      this._tip = document.createElement("div"); this._tip.className = "gtip"; this._wrap.appendChild(this._tip);
      let drag = null;
      const px = () => { const r = this._wrap.getBoundingClientRect(); return { r, sx: (this.view.x1 - this.view.x0) / r.width, sy: (this.view.y1 - this.view.y0) / r.height }; };
      this._wrap.addEventListener("pointerdown", (e) => { if (!this.view) return; drag = { x: e.clientX, y: e.clientY, v: { ...this.view } }; this._wrap.setPointerCapture(e.pointerId); });
      this._wrap.addEventListener("pointermove", (e) => {
        if (!this.view) return; const { r, sx, sy } = px();
        if (drag) { const dx = (e.clientX - drag.x) * sx, dy = (e.clientY - drag.y) * sy; this.view = { x0: drag.v.x0 - dx, x1: drag.v.x1 - dx, y0: drag.v.y0 + dy, y1: drag.v.y1 + dy }; this.paint(false); return; }
        const x = this.view.x0 + (e.clientX - r.left) * sx; const ys = (this._fns || []).filter((f) => f.kind === "fn").map((f) => { try { return f.f(x, this._vars); } catch { return NaN; } }).filter(isFinite);
        this._tip.textContent = `x ${x.toFixed(2)}${ys.length ? "  y " + ys.map((y) => y.toFixed(3)).join(", ") : ""}`; this._tip.style.opacity = 1;
      });
      this._wrap.addEventListener("pointerup", () => (drag = null));
      this._wrap.addEventListener("pointerleave", () => (this._tip.style.opacity = 0));
      this._wrap.addEventListener("wheel", (e) => { if (!this.view) return; e.preventDefault(); const { r, sx, sy } = px(), k = Math.exp(e.deltaY * 0.0015), v = this.view; const cx = v.x0 + (e.clientX - r.left) * sx, cy = v.y1 - (e.clientY - r.top) * sy; this.view = { x0: cx - (cx - v.x0) * k, x1: cx + (v.x1 - cx) * k, y0: cy - (cy - v.y0) * k, y1: cy + (v.y1 - cy) * k }; this.paint(false); }, { passive: false });
      this._wrap.addEventListener("dblclick", () => { this.view = null; this.paint(false); });
      // resize keeps units-per-pixel (reveals more plane) instead of stretching the picture
      new ResizeObserver(() => {
        const w = this._wrap.clientWidth, h = this._wrap.clientHeight; if (!w || !h) return;
        if (this.view && this._size && (this._size[0] !== w || this._size[1] !== h)) { const v = this.view, sx = (v.x1 - v.x0) / this._size[0], sy = (v.y1 - v.y0) / this._size[1], cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2; this.view = { x0: cx - (w / 2) * sx, x1: cx + (w / 2) * sx, y0: cy - (h / 2) * sy, y1: cy + (h / 2) * sy }; }
        if (this._fns) this.paint(!this._painted);
      }).observe(this._wrap);
    }
    render() { this._key = null; this.refresh(true); }
    refresh(force) {
      const src = this.getAttribute("fn") || this._src || "x";
      if (!this._fns || this._srcFn !== src) { this._srcFn = src; try { this._fns = parseFns(src); } catch (e) { this._fns = []; B.post && B.post("error", { text: "x-graph: " + e.message }); } this.view = null; }
      const vars = {}; this._fns.forEach((f) => f.free.forEach((k) => { const v = B.evaluate(k); vars[k] = typeof v === "number" ? v : num(v, 0); }));
      const key = JSON.stringify(vars);
      if (!force && key === this._key) return;
      this._key = key; this._vars = vars;
      this.paint(!this._painted);
    }
    fit(W, H) {
      const fns = this._fns, shapes = fns.length && fns.every((f) => f.kind !== "fn");
      const equal = this.hasAttribute("equal") ? this.getAttribute("equal") !== "false" : shapes;
      let x0 = this.n("xmin", NaN), x1 = this.n("xmax", NaN), y0 = this.n("ymin", NaN), y1 = this.n("ymax", NaN);
      if (shapes && !isFinite(x0)) { // frame the curves themselves
        const pts = this.samples({ x0: -10, x1: 10, y0: -10, y1: 10 }, 300, 200).flat().filter((p) => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6);
        if (pts.length) { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...ys), d = Math.max(...ys), pad = Math.max(b - a, d - c, 1e-6) * 0.12; x0 = a - pad; x1 = b + pad; if (!isFinite(y0)) { y0 = c - pad; y1 = d + pad; } }
      }
      if (!isFinite(x0) || !isFinite(x1)) { x0 = -10; x1 = 10; }
      if (!isFinite(y0) || !isFinite(y1)) {
        if (equal) { y0 = -((x1 - x0) * H) / W / 2; y1 = -y0; }
        else {
          const ys = this.samples({ x0, x1, y0: -1, y1: 1 }, W, H).flat().map((p) => p[1]).filter(isFinite).sort((a, b) => a - b);
          let lo = ys.length ? ys[Math.floor(ys.length * 0.02)] : -1, hi = ys.length ? ys[Math.ceil(ys.length * 0.98) - 1] : 1;
          if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.12; y0 = lo - pad; y1 = hi + pad;
        }
      }
      if (equal) { // same units on both axes: grow whichever range is short
        const sx = (x1 - x0) / W, sy = (y1 - y0) / H, s = Math.max(sx, sy), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        x0 = cx - (W / 2) * s; x1 = cx + (W / 2) * s; y0 = cy - (H / 2) * s; y1 = cy + (H / 2) * s;
      }
      return { x0, x1, y0, y1 };
    }
    samples(v, W, H) {
      return this._fns.map((f) => {
        const pts = [], vars = this._vars || {};
        if (f.kind === "fn") { const N = Math.max(200, Math.round(W * 1.5)); for (let i = 0; i <= N; i++) { const x = v.x0 + ((v.x1 - v.x0) * i) / N; let y; try { y = f.f(x, vars); } catch { y = NaN; } pts.push([x, y]); } }
        else if (f.kind === "implicit") return this.contour(f, v, W, H);
        else { const [t0, t1] = f.kind === "polar" ? [this.n("tmin", 0), this.n("tmax", 2 * Math.PI * this.n("turns", 1))] : [this.n("tmin", 0), this.n("tmax", 2 * Math.PI)]; const N = 800; for (let i = 0; i <= N; i++) { const t = t0 + ((t1 - t0) * i) / N; try { if (f.kind === "polar") { const r = f.f(t, vars); pts.push([r * Math.cos(t), r * Math.sin(t)]); } else pts.push([f.fx(t, vars), f.fy(t, vars)]); } catch { pts.push([NaN, NaN]); } } }
        return pts;
      });
    }
    // marching squares over a ~4px grid; returns points with NaN separators between segments
    contour(f, v, W, H) {
      const nx = Math.max(40, Math.round(W / 4)), ny = Math.max(30, Math.round(H / 4)), vars = this._vars || {}, G = [];
      for (let j = 0; j <= ny; j++) { const row = []; const y = v.y0 + ((v.y1 - v.y0) * j) / ny; for (let i = 0; i <= nx; i++) { let z; try { z = f.f(v.x0 + ((v.x1 - v.x0) * i) / nx, y, vars); } catch { z = NaN; } row.push(z); } G.push(row); }
      const out = [], X = (i) => v.x0 + ((v.x1 - v.x0) * i) / nx, Y = (j) => v.y0 + ((v.y1 - v.y0) * j) / ny;
      const lerp = (a, b, za, zb) => a + ((b - a) * za) / (za - zb);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = G[j][i], b = G[j][i + 1], c = G[j + 1][i + 1], d = G[j + 1][i];
        if (![a, b, c, d].every(isFinite)) continue;
        const p = [];
        if (a * b < 0 || (a === 0) !== (b === 0)) p.push([lerp(X(i), X(i + 1), a, b), Y(j)]);
        if (b * c < 0) p.push([X(i + 1), lerp(Y(j), Y(j + 1), b, c)]);
        if (c * d < 0) p.push([lerp(X(i), X(i + 1), d, c), Y(j + 1)]);
        if (d * a < 0) p.push([X(i), lerp(Y(j), Y(j + 1), a, d)]);
        if (p.length >= 2) { const big = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)); if (big > 1e6) continue; out.push(p[0], p[1], [NaN, NaN]); if (p.length === 4) out.push(p[2], p[3], [NaN, NaN]); }
      }
      return out;
    }
    paint(animate) {
      const W = this._wrap.clientWidth, H = this._wrap.clientHeight; if (!W || !H || !this._fns) return;
      this._size = [W, H]; this._painted = true;
      if (!this.view) this.view = this.fit(W, H);
      const v = this.view, pal = PAL();
      const X = (x) => ((x - v.x0) / (v.x1 - v.x0)) * W, Y = (y) => H - ((y - v.y0) / (v.y1 - v.y0)) * H;
      const old = this._wrap.querySelector("svg"); if (old) old.remove();
      const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H }); this._wrap.prepend(s);
      const gx = nice(v.x0, v.x1, Math.max(3, Math.round(W / 70))), gy = nice(v.y0, v.y1, Math.max(3, Math.round(H / 55)));
      const ax = Math.min(W - 4, Math.max(4, X(0))), ay = Math.min(H - 4, Math.max(4, Y(0)));
      gx.forEach((g) => { svg("line", { x1: X(g), x2: X(g), y1: 0, y2: H, class: "ax", opacity: g === 0 ? 1 : 0.4 }, s); if (g !== 0) svg("text", { x: X(g), y: Math.min(H - 4, ay + 14), "text-anchor": "middle", class: "lbl" }, s).textContent = short(g); });
      gy.forEach((g) => { svg("line", { x1: 0, x2: W, y1: Y(g), y2: Y(g), class: "ax", opacity: g === 0 ? 1 : 0.4 }, s); if (g !== 0) svg("text", { x: ax > W - 40 ? ax - 5 : ax + 5, y: Y(g) + 4, "text-anchor": ax > W - 40 ? "end" : "start", class: "lbl" }, s).textContent = short(g); });
      this.samples(v, W, H).forEach((pts, i) => {
        let d = "", pen = false; const span = v.y1 - v.y0, f = this._fns[i];
        pts.forEach(([x, y], k) => {
          if (!isFinite(x) || !isFinite(y) || y < v.y0 - span * 2 || y > v.y1 + span * 2 || (f.kind === "fn" && pen && k && Math.abs(y - pts[k - 1][1]) > span * 1.5)) { pen = false; return; }
          d += `${pen ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`; pen = true;
        });
        const p = svg("path", { d: d || "M0,0", fill: "none", stroke: pal[i % pal.length], "stroke-width": 2.2, "stroke-linejoin": "round", "stroke-linecap": "round" }, s);
        if (animate && f.kind !== "implicit") drawIn(p, 0.05 + i * 0.12); else if (animate) p.classList.add("pop");
      });
      const ptsAttr = this.getAttribute("points");
      if (ptsAttr) ptsAttr.split(";").filter((x) => x.trim()).forEach((pp, k) => { const [px, py, lab] = pp.split(",").map((z) => z.trim()); const c = svg("circle", { cx: X(+px), cy: Y(+py), r: 4, fill: "var(--fg)", class: animate ? "pop" : "" }, s); c.style.animationDelay = 0.6 + k * 0.05 + "s"; if (lab) svg("text", { x: X(+px) + 7, y: Y(+py) - 7, class: "lbl pt" }, s).textContent = lab; });
      let lg = this.querySelector(".legend");
      if (this._fns.length > 1 || this.hasAttribute("legend")) { if (!lg) { lg = document.createElement("div"); lg.className = "legend"; this.appendChild(lg); } lg.innerHTML = this._fns.map((f, i) => `<span><i style="background:${pal[i % pal.length]}"></i>${esc(f.label.replace(/\*\*/g, "^").replace(/\*/g, "·"))}</span>`).join(""); }
    }
  });
  define("x-plot", class extends (customElements.get("x-graph")) {});

  define("x-smiles", class extends Base {
    render() {
      const sm = this.getAttribute("smiles") || (this._src || "").trim(); if (!sm) return;
      this.dataset.themed = ""; this.innerHTML = "";
      const s = svg("svg", { id: "sm" + Math.random().toString(36).slice(2) }, this); s.style.minHeight = (this.n("height", 200)) + "px";
      B.loadLib("smiles", "smiles-drawer.min.js").then(() => {
        const SD = window.SmilesDrawer, dark = document.body.dataset.theme === "dark";
        const d = new SD.SvgDrawer({ width: this.n("width", 320), height: this.n("height", 200), bondThickness: 1.1, compactDrawing: false });
        SD.parse(sm, (tree) => { d.draw(tree, s, dark ? "dark" : "light", false); s.classList.add("pop"); const l = this.getAttribute("label"); if (l) { const c = document.createElement("div"); c.className = "cap"; c.textContent = l; this.appendChild(c); } }, (e) => { this.innerHTML = `<div class="err">${esc(e)}</div>`; });
      });
    }
  }, { void: true });
  define("x-mol3d", class extends Base {
    render() {
      this.innerHTML = '<div class="m3"></div>'; const box = this.firstChild;
      const name = this.getAttribute("name"), cid = this.getAttribute("cid"), smiles = this.getAttribute("smiles"), pdb = this.getAttribute("pdb");
      B.loadLib("3dmol", "3Dmol-min.js").then(async () => {
        const v = window.$3Dmol.createViewer(box, { backgroundAlpha: 0 });
        let data, fmt = "sdf";
        const pc = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
        if (pdb) { data = await (await fetch(`https://files.rcsb.org/download/${pdb}.pdb`)).text(); fmt = "pdb"; }
        else { const q = cid ? `cid/${cid}` : smiles ? `smiles/${encodeURIComponent(smiles)}` : `name/${encodeURIComponent(name || "water")}`; data = await (await fetch(`${pc}/${q}/SDF?record_type=3d`)).text(); }
        v.addModel(data, fmt); v.setStyle({}, fmt === "pdb" ? { cartoon: { color: "spectrum" } } : { stick: { radius: 0.14 }, sphere: { scale: 0.24 } });
        v.zoomTo(); v.render(); if (!this.hasAttribute("still")) v.spin("y", 0.4);
      }).catch((e) => { box.innerHTML = `<div class="err">${esc(e)}</div>`; });
    }
  }, { void: true });
  define("x-mermaid", class extends Base {
    static owns = true;
    render() {
      this.dataset.themed = ""; const code = (this._src || "").trim(), dark = document.body.dataset.theme === "dark";
      B.libImport("mermaid", "mermaid.esm.min.mjs").then(async ({ default: m }) => {
        m.initialize({ startOnLoad: false, theme: "base", fontFamily: "inherit", themeVariables: { darkMode: dark, background: "transparent", primaryColor: css("--surface-solid") || (dark ? "#2b2a27" : "#e8e2d7"), primaryTextColor: css("--fg"), primaryBorderColor: css("--line-solid") || css("--muted"), lineColor: css("--muted"), secondaryColor: dark ? "#2f2c28" : "#efe9df", tertiaryColor: "transparent", fontSize: "14px" } });
        try { const { svg: out } = await m.render("m" + Math.random().toString(36).slice(2), code); this.innerHTML = out; this.firstElementChild && this.firstElementChild.classList.add("pop"); } catch (e) { this.innerHTML = `<div class="err">${esc(e.message || e)}</div>`; }
      });
    }
  });
  // TikZ diagrams (physics, circuits via circuitikz, geometry, pgfplots, chemfig, Feynman), rendered offline by the host
  define("x-tikz", class extends Base {
    static owns = true;
    render() {
      const src = (this.getAttribute("src-tex") || this._src || "").trim(); if (!src || this._done === src) return; this._done = src;
      this.dataset.themed = ""; this.innerHTML = '<div class="b-skel" data-k="viz"></div>';
      B.loadLib("tikzjax", "fonts.css");
      fetch(`${B.ORIGIN}/api/tikz`, { method: "POST", headers: { "content-type": "text/plain" }, body: src })
        .then((r) => r.json())
        .then((r) => {
          if (!r.svg) throw new Error(r.error || "render failed");
          this.innerHTML = r.svg; const s = this.querySelector("svg"); if (!s) return;
          const w = parseFloat(s.getAttribute("width")) || 200, k = this.n("scale", 1.6);
          s.removeAttribute("height"); s.setAttribute("width", "100%"); s.style.maxWidth = Math.round(w * k) + "px"; s.classList.add("pop");
          const cap = this.getAttribute("caption"); if (cap) { const c = document.createElement("div"); c.className = "cap"; c.textContent = cap; this.appendChild(c); }
        })
        .catch((e) => { const m = String(e.message || e); this.innerHTML = `<div class="err">TikZ: ${esc(m)}</div>`; B.post("error", { text: "x-tikz: " + m.slice(0, 300) }); });
    }
  });
  // x-draw: primitives for physics/geometry diagrams, one per line (px units)
  define("x-draw", class extends Base {
    static owns = true;
    render() {
      this.innerHTML = ""; const W = this.n("w", 320), H = this.n("h", 200); const s = svg("svg", { viewBox: `0 0 ${W} ${H}` }, this); s.style.maxWidth = `calc(${Math.round(W * 1.5)}px * var(--s, 1))`; // diagrams scale up to 1.5× their drawn size, not to any width
      const defs = svg("defs", {}, s); const mk = svg("marker", { id: "ah", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs); svg("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--accent)" }, mk);
      const st = { fill: "none", stroke: "var(--fg)", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }; let k = 0;
      const T = (x, y, t, a = "middle") => { const e = svg("text", { x, y, "text-anchor": a, "font-size": 12, fill: "var(--fg)", class: "pop" }, s); e.textContent = t; e.style.animationDelay = 0.3 + k++ * 0.05 + "s"; };
      const P = (el) => { drawIn(el, 0.05 + k * 0.03); k++; return el; };
      for (const line of lines(this._src)) {
        const m = line.match(/^(\w+)\s+([-\d.\s,]+?)(?:\s+"([^"]*)")?$/); if (!m) continue;
        const cmd = m[1], nums = m[2].trim().split(/[\s,]+/).map(Number), label = m[3]; const [a, b, c, d, e2] = nums;
        switch (cmd) {
          case "rect": P(svg("rect", { x: a, y: b, width: c, height: d, rx: 3, ...st }, s)); if (label) T(a + c / 2, b + d / 2 + 4, label); break;
          case "mass": case "block": P(svg("rect", { x: a - 18, y: b - 18, width: 36, height: 36, rx: 3, ...st, fill: "var(--surface-solid, var(--bg))" }, s)); if (label) T(a, b + 4, label); break;
          case "circle": P(svg("circle", { cx: a, cy: b, r: c, ...st }, s)); if (label) T(a, b + 4, label); break;
          case "dot": svg("circle", { cx: a, cy: b, r: c || 3, fill: "var(--fg)", class: "pop" }, s); if (label) T(a + 8, b - 6, label, "start"); break;
          case "pulley": P(svg("circle", { cx: a, cy: b, r: c, ...st }, s)); svg("circle", { cx: a, cy: b, r: 2.5, fill: "var(--fg)" }, s); P(svg("line", { x1: a, y1: b, x2: a, y2: b - c - 12, ...st }, s)); P(svg("line", { x1: a - 14, y1: b - c - 12, x2: a + 14, y2: b - c - 12, ...st, "stroke-width": 3 }, s)); break;
          case "line": P(svg("line", { x1: a, y1: b, x2: c, y2: d, ...st }, s)); if (label) T((a + c) / 2, (b + d) / 2 - 6, label); break;
          case "rope": case "string": P(svg("line", { x1: a, y1: b, x2: c, y2: d, ...st, "stroke-width": 1.2 }, s)); if (label) T((a + c) / 2 + 8, (b + d) / 2, label, "start"); break;
          case "dashed": svg("line", { x1: a, y1: b, x2: c, y2: d, ...st, "stroke-dasharray": "4 4", opacity: 0.6 }, s); if (label) T((a + c) / 2, (b + d) / 2 - 6, label); break;
          case "arrow": case "vector": case "force": P(svg("line", { x1: a, y1: b, x2: c, y2: d, ...st, stroke: "var(--accent)", "marker-end": "url(#ah)" }, s)); if (label) T(c + (c >= a ? 8 : -8), d + 4, label, c >= a ? "start" : "end"); break;
          case "text": case "label": T(a, b, label || ""); break;
          case "ground": { P(svg("line", { x1: 0, y1: a, x2: W, y2: a, ...st }, s)); for (let x = 4; x < W; x += 12) svg("line", { x1: x, y1: a, x2: x - 6, y2: a + 7, ...st, "stroke-width": 0.8, opacity: 0.5 }, s); break; }
          case "wall": { P(svg("line", { x1: a, y1: 0, x2: a, y2: H, ...st }, s)); for (let y = 4; y < H; y += 12) svg("line", { x1: a, y1: y, x2: a - 7, y2: y + 6, ...st, "stroke-width": 0.8, opacity: 0.5 }, s); break; }
          case "incline": P(svg("path", { d: `M${a},${b + d} L${a + c},${b + d} L${a + c},${b} Z`, ...st }, s)); break;
          case "polygon": { const pts = []; for (let i = 0; i + 1 < nums.length; i += 2) pts.push(nums[i] + "," + nums[i + 1]); P(svg("polygon", { points: pts.join(" "), ...st }, s)); if (label) T(nums[0], nums[1] - 8, label); break; }
          case "curve": P(svg("path", { d: `M${a},${b} Q${c},${d} ${nums[4]},${nums[5]}`, ...st }, s)); break;
          case "spring": { const L = Math.hypot(c - a, d - b), n = 10, ang = Math.atan2(d - b, c - a); let p = `M0,0 L${L * 0.1},0`; for (let i = 0; i < n; i++) p += ` L${L * 0.1 + ((i + 0.5) * L * 0.8) / n},${i % 2 ? 7 : -7}`; p += ` L${L * 0.9},0 L${L},0`; P(svg("path", { d: p, ...st, transform: `translate(${a},${b}) rotate(${(ang * 180) / Math.PI})` }, s)); break; }
          case "wave": { const L = c - a, amp = d || 10, cyc = e2 || 3; let p = `M${a},${b}`; for (let i = 1; i <= 80; i++) { const x = a + (L * i) / 80; p += ` L${x.toFixed(1)},${(b - amp * Math.sin((i / 80) * cyc * 2 * Math.PI)).toFixed(1)}`; } P(svg("path", { d: p, ...st, stroke: "var(--accent)" }, s)); break; }
          case "angle": { const r = c, s1 = (d * Math.PI) / 180, s2 = (e2 * Math.PI) / 180; P(svg("path", { d: `M${a + r * Math.cos(s1)},${b - r * Math.sin(s1)} A${r},${r} 0 0 0 ${a + r * Math.cos(s2)},${b - r * Math.sin(s2)}`, ...st, "stroke-width": 1 }, s)); if (label) T(a + (r + 10) * Math.cos((s1 + s2) / 2), b - (r + 10) * Math.sin((s1 + s2) / 2) + 4, label); break; }
          case "lens": P(svg("path", { d: `M${a},${b - c} Q${a + 14},${b} ${a},${b + c} Q${a - 14},${b} ${a},${b - c}`, ...st }, s)); break;
          case "resistor": { const L = Math.hypot(c - a, d - b), ang = Math.atan2(d - b, c - a); let p = `M0,0 L${L * 0.3},0`; for (let i = 0; i < 6; i++) p += ` L${L * 0.3 + ((i + 0.5) * L * 0.4) / 6},${i % 2 ? 6 : -6}`; p += ` L${L * 0.7},0 L${L},0`; P(svg("path", { d: p, ...st, transform: `translate(${a},${b}) rotate(${(ang * 180) / Math.PI})` }, s)); if (label) T((a + c) / 2, (b + d) / 2 - 12, label); break; }
          case "battery": { P(svg("line", { x1: a, y1: b - 12, x2: a, y2: b + 12, ...st }, s)); P(svg("line", { x1: a + 8, y1: b - 6, x2: a + 8, y2: b + 6, ...st, "stroke-width": 3 }, s)); if (label) T(a + 4, b - 18, label); break; }
        }
      }
      // labels never sit on each other: nudge later labels down/right until clear (3 passes)
      requestAnimationFrame(() => {
        const ts = [...s.querySelectorAll("text")]; if (ts.length < 2) return;
        for (let pass = 0; pass < 3; pass++) for (let i = 1; i < ts.length; i++) for (let j = 0; j < i; j++) {
          let A, Bb; try { A = ts[i].getBBox(); Bb = ts[j].getBBox(); } catch { return; }
          const ox = Math.min(A.x + A.width, Bb.x + Bb.width) - Math.max(A.x, Bb.x), oy = Math.min(A.y + A.height, Bb.y + Bb.height) - Math.max(A.y, Bb.y);
          if (ox > 1 && oy > 1) ts[i].setAttribute("y", +ts[i].getAttribute("y") + oy + 2);
        }
      });
    }
  });

  // ================================================================ structure: x-flow · x-tree · x-list
  // One view (pan, zoom, fit, hover, select, collapse) draws both x-flow and x-tree; the parsing and
  // the layered layout live in graph.js so they are unit-tested, this file only draws. Both render in the
  // app's own language — same radius, surfaces and type as every other block — so a diagram belongs to the
  // interface instead of looking pasted in. A chart wider than the block is explored by panning, never squashed.
  const XG = { MINZ: 0.4, MAXZ: 2.4, PAD: 12, DASH: 6 };
  const RAD = () => parseFloat(String(css("--r")).replace("px", "")) || 12;
  const xgFont = (size, weight) => `${weight || 400} ${size}px ${getComputedStyle(document.body).fontFamily}`;
  const xgMeasure = (() => { const c = document.createElement("canvas").getContext("2d"); return (t, f) => { c.font = f; return c.measureText(String(t)).width; }; })();

  /** A disclosure chevron drawn as paths (never a glyph: the platform font may not carry ▾). */
  function xgChev(parent, x, y, folded, cls = "xgn-chev") {
    const r = 3.6, d = folded ? `M${x - r},${y - r} L${x + r},${y} L${x - r},${y + r}` : `M${x - r},${y - r * 0.75} L${x},${y + r * 0.75} L${x + r},${y - r * 0.75}`;
    const p = svg("path", { d, class: cls }, parent);
    return p;
  }

  /** Node box size from its own text, so nothing overflows and nothing is padded for a width it does not need. */
  function xgNodeSize(node) {
    const kind = node.kind || "step";
    if (kind === "note") { const w = xgMeasure(node.label, xgFont(12.5)); return { w: w + 14, h: node.detail ? 30 : 20 }; }
    const w = Math.max(xgMeasure(node.label, xgFont(13.5, kind === "start" || kind === "end" ? 550 : 450)), 30);
    const dw = node.detail ? xgMeasure(node.detail, xgFont(11.5)) : 0;
    if (kind === "decision") return { w: Math.max(104, w + 66, dw + 46), h: 58 };
    if (kind === "tree") return { w: Math.max(w, dw * 1.2) + 34, h: node.detail ? 50 : 36 };
    return { w: Math.max(kind === "start" || kind === "end" ? 96 : 86, w + 36, dw + 26), h: node.detail ? 50 : 40 };
  }

  /** Orthogonal route between two boxes. Forward edges leave the far side of a and enter the near side of b;
      a back edge (a loop) is routed around the drawing so it never crosses the nodes it returns past. */
  function xgRoute(a, b, dir, back) {
    const LR = dir === "lr" || dir === "rl";
    const fwd = dir === "lr" || dir === "tb";                       // true: b sits to the right/below a
    if (LR) {
      const sy = a.y + a.h / 2, ty = b.y + b.h / 2;
      const from = fwd ? a.x + a.w : a.x, to = fwd ? b.x : b.x + b.w;
      if (back) { const x = Math.max(a.x + a.w, b.x + b.w) + 24; return { pts: [[from, sy], [x, sy], [x, ty], [to, ty]], label: [x + 23, (sy + ty) / 2] }; }
      if (to - from < 26) return { pts: [[from, sy], [to, ty]], label: [(from + to) / 2, (sy + ty) / 2 - 6] };
      const mx = from + (to - from) / 2;
      return { pts: [[from, sy], [mx, sy], [mx, ty], [to, ty]], label: [mx, (sy + ty) / 2] };
    }
    const sx = a.x + a.w / 2, tx = b.x + b.w / 2;
    const from = fwd ? a.y + a.h : a.y, to = fwd ? b.y : b.y + b.h;
    if (back) { const y = Math.max(a.y + a.h, b.y + b.h) + 26; return { pts: [[sx, from], [sx, y], [tx, y], [tx, to]], label: [(sx + tx) / 2, y - 7] }; }
    if (to - from < 26) return { pts: [[sx, from], [tx, to]], label: [(sx + tx) / 2 - 6, (from + to) / 2] };
    const my = from + (to - from) / 2;
    return { pts: [[sx, from], [sx, my], [tx, my], [tx, to]], label: [(sx + tx) / 2, my] };
  }

  function xgPath(pts, r = 7) {
    if (pts.length < 3) return `M${pts.map((p) => p.join(",")).join("L")}`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const l1 = Math.hypot(x1 - x0, y1 - y0) || 1, l2 = Math.hypot(x2 - x1, y2 - y1) || 1;
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const u1 = [(x1 - x0) / l1, (y1 - y0) / l1], u2 = [(x2 - x1) / l2, (y2 - y1) / l2];
      d += `L${(x1 - u1[0] * rr).toFixed(1)},${(y1 - u1[1] * rr).toFixed(1)}Q${x1},${y1} ${(x1 + u2[0] * rr).toFixed(1)},${(y1 + u2[1] * rr).toFixed(1)}`;
    }
    const e = pts[pts.length - 1];
    return d + `L${e[0]},${e[1]}`;
  }

  /** The pan/zoom/fit frame both diagram components share. Everything visual lives in CSS classes. */
  function xgView(host) {
    const wrap = document.createElement("div"); wrap.className = "xgwrap";
    const svgEl = svg("svg", { class: "xgsvg", "aria-hidden": "false" });
    const defs = svg("defs", {}, svgEl);
    const mk = svg("marker", { id: "xg-ah", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7.5, markerHeight: 7.5, orient: "auto-start-reverse" }, defs);
    svg("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--muted)" }, mk);
    const g = svg("g", { class: "xg" }, svgEl);
    const hud = document.createElement("div"); hud.className = "xghud";
    const zed = document.createElement("span"); zed.className = "xgz";
    const btn = (text, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.title = title; b.setAttribute("aria-label", title); b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); fn(); }; hud.appendChild(b); return b; };
    const state = { z: 1, x: XG.PAD, y: XG.PAD, world: { w: 0, h: 0 }, fit: 1, box: { w: 0, h: 0 }, zoomed: false };
    const apply = () => g.setAttribute("transform", `translate(${state.x.toFixed(2)} ${state.y.toFixed(2)}) scale(${state.z.toFixed(4)})`);
    const show = () => { zed.textContent = Math.round(state.z * 100) + "%"; };
    const setZ = (z, cx, cy) => {
      const next = Math.max(XG.MINZ, Math.min(XG.MAXZ, z));
      const k = next / state.z;
      const px = cx === undefined ? state.box.w / 2 : cx, py = cy === undefined ? state.box.h / 2 : cy;
      state.x = px - (px - state.x) * k; state.y = py - (py - state.y) * k; state.z = next;
      if (Math.abs(next - state.fit) > 0.02) state.zoomed = true;
      apply(); show();
    };
    const fit = () => {
      const { w: W, h: H } = state.world;
      const bw = wrap.clientWidth || host.clientWidth || 640;
      const bh = wrap.clientHeight || state.hintH || 0;
      state.box = { w: bw, h: bh || 1 };
      if (!W || !H) return;
      let s = Math.min(1, (bw - XG.PAD * 2) / W);
      if (bh) s = Math.min(s, (bh - XG.PAD * 2) / H);              // a tall drawing is scaled to be seen whole
      s = Math.max(XG.MINZ, s);
      state.fit = s; state.z = s; state.zoomed = false;
      state.x = W * s + XG.PAD * 2 >= bw ? XG.PAD : Math.round((bw - W * s) / 2);
      state.y = Math.max(XG.PAD, Math.round((bh - H * s) / 2) || XG.PAD);
      apply(); show();
    };
    btn("−", "Zoom out", () => setZ(state.z / 1.25));
    btn("+", "Zoom in", () => setZ(state.z * 1.25));
    btn("Fit", "Fit to width", () => fit());
    hud.append(zed);
    wrap.append(svgEl, hud);
    host.appendChild(wrap);

    let drag = null;
    wrap.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".xghud")) return;
      drag = { x: e.clientX, y: e.clientY, ox: state.x, oy: state.y, moved: false };
      wrap.classList.add("drag");
      wrap.setPointerCapture?.(e.pointerId);
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      state.x = drag.ox + dx; state.y = drag.oy + dy;
      if (Math.abs(state.z - state.fit) > 0.02) state.zoomed = true;
      apply();
    });
    const end = () => { drag = null; wrap.classList.remove("drag"); };
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
    wrap.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;                       // plain wheel keeps scrolling the page
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      setZ(state.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    return { wrap, g, state, apply, show, setZ, fit, moved: () => !!drag && drag.moved };
  }

  /** Draw a laid-out graph: edges under nodes, kinds as shapes, one hover/active state. */
  function xgDraw(view, L, o) {
    const R = RAD();
    const g = view.g;
    g.textContent = "";
    g.classList.toggle("interactive", !!o.interactive);
    const layer = (cls) => svg("g", { class: cls }, g);
    const edges = layer("xg-edges"), nodes = layer("xg-nodes");
    for (const e of L.edges) {
      const { pts, label } = xgRoute(e.fromNode, e.toNode, o.dir, e.back);
      const p = svg("path", { d: xgPath(pts), class: "xge" + (e.dashed ? " dashed" : ""), "marker-end": "url(#xg-ah)", "data-from": e.from, "data-to": e.to }, edges);
      if (e.dashed) p.setAttribute("stroke-dasharray", `${XG.DASH} ${XG.DASH}`);
      if (e.label) {
        const lp = label || pts[Math.floor(pts.length / 2)];
        const t = svg("text", { x: lp[0], y: lp[1] - 6, class: "xgl", "text-anchor": "middle" }, edges);
        t.textContent = e.label;
      }
    }
    L.nodes.forEach((n, nodeIndex) => {
      const kind = n.kind || "step";
      const grp = svg("g", { class: "xgn" + (kind === "root" ? " root" : ""), "data-id": n.id, "data-kind": kind }, nodes);
      grp.style.setProperty("--i", String(Math.min(nodeIndex, 16)));
      if (kind === "note") {
        const t = svg("text", { x: n.x + n.w / 2, y: n.y + n.h / 2, class: "xgl", "text-anchor": "middle" }, grp);
        t.textContent = n.label;
      } else if (kind === "decision") {
        svg("polygon", { points: `${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}`, rx: 4, class: "box" }, grp);
      } else {
        const cls = kind === "start" || kind === "end" ? "box solid" : kind === "io" ? "box io" : kind === "root" ? "box root" : "box";
        svg("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: R, class: cls }, grp);
      }
      if (kind !== "note") {
        const t = svg("text", { x: n.x + n.w / 2, y: n.y + (n.detail ? n.h / 2 - 7 : n.h / 2) + 1, class: "xgn-t", "text-anchor": "middle" }, grp);
        t.textContent = n.label;
        if (n.detail) {
          const d = svg("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 + 12, class: "xgn-d", "text-anchor": "middle" }, grp);
          d.textContent = n.detail;
        }
      }
      if (o.interactive) { grp.setAttribute("tabindex", "0"); grp.setAttribute("role", "button"); }
      if (o.onToggle && n.children) xgChev(grp, n.x + n.w - 11, n.y + n.h / 2, !!n.folded);
    });
    // hovering a node dims what is not connected to it — the question "where does this go?" answered instantly
    if (!view.wired) {
      view.wired = true;
      view.wrap.addEventListener("mouseover", (e) => {
        const hit = e.target.closest(".xgn");
        if (!hit) return;
        const id = hit.dataset.id;
        g.classList.add("focus");
        view.wrap.querySelectorAll(".xgn").forEach((x) => x.classList.toggle("hot", x.dataset.id === id));
        view.wrap.querySelectorAll(".xge").forEach((x) => x.classList.toggle("hot", x.dataset.from === id || x.dataset.to === id));
      });
      view.wrap.addEventListener("mouseleave", () => {
        g.classList.remove("focus");
        view.wrap.querySelectorAll(".hot").forEach((x) => x.classList.remove("hot"));
      });
    }
  }

  function xgPaint(view, active) {
    for (const el of view.g.querySelectorAll(".xgn")) el.classList.toggle("on", !!active && el.dataset.id === active);
    view.g.classList.toggle("has-on", !!active);
  }

  /** The height a laid-out graph wants: never a postage stamp, never a full screen.
      A view the reader has zoomed or dragged keeps its viewport across re-renders; an untouched one
      follows the drawing, and height="…" (or the fit attribute) always wins. */
  function xgBox(view, L, attrHeight, force) {
    const first = !view.state.fitted;
    view.state.world = { w: L.width + XG.PAD * 2, h: L.height + XG.PAD * 2 };
    const fixed = parseFloat(attrHeight || "");
    const z = view.state.zoomed ? view.state.z : view.state.fit || 1;
    // A tall drawing is read by scrolling, the way any long content is — the block grows with it up to
    // ~940px and only then falls back to scaling down (with a floor), so the text is never shrunk to nothing.
    const natural = L.height + XG.PAD * 2;
    const cap = fixed && fixed > 60 ? fixed : natural <= 940 ? natural : 620;
    const shown = Math.round(Math.max(190, Math.min(cap, L.height * z + XG.PAD * 2)));
    view.state.hintH = shown;
    view.wrap.style.height = shown + "px";
    view.state.box = { w: view.wrap.clientWidth || 640, h: shown };
    if (first || force || !view.state.zoomed) view.fit();
    view.state.fitted = true;
  }

  define("x-flow", class extends Base {
    static owns = true;
    init() {
      this._view = xgView(this);
      this._view.wrap.addEventListener("click", (e) => {
        if (this._view.moved()) return;
        const hit = e.target.closest(".xgn");
        if (hit) this.select(hit.dataset.id);
      });
    }
    get nodes() { return (this._graph?.nodes || []).map((n) => n.id); }
    get value() { return this.getAttribute("active") || null; }
    select(id) {
      const n = (this._graph?.nodes || []).find((x) => x.id === id);
      if (!n) return;
      this.setAttribute("active", id);
      xgPaint(this._view, id);
      this.dispatchEvent(new CustomEvent("select", { bubbles: true, detail: { id, label: n.label, kind: n.kind } }));
      change(this);
    }
    dir() {
      const d = this.a("dir", "auto");
      if (d !== "auto") return d;
      const w = this._measure() || 700;
      return w > 680 ? "lr" : "tb";
    }
    _measure() { return this._view.wrap.clientWidth || this.clientWidth || (this.parentElement && this.parentElement.clientWidth) || 0; }
    render() {
      const src = this._src || "";
      const dir = this.dir();
      this._dirW = this._measure();
      const sig = [dir, src, this.a("height", ""), this.a("caption", "")].join("\u0001");
      if (sig === this._sigDone) { xgPaint(this._view, this.a("active", "")); return; }
      this._sigDone = sig;
      const parsed = B.parseFlow(src);
      this._graph = parsed;
      const L = B.graphLayout(parsed.nodes, parsed.edges, dir, { estimate: (label, kind) => xgNodeSize({ label, kind }) });
      const cap = this.a("caption", "");
      this._view.wrap.classList.toggle("hascap", !!cap);
      xgDraw(this._view, L, { dir, interactive: true });
      this._view.wrap.setAttribute("role", "img");
      this._view.wrap.setAttribute("aria-label", cap || `Flowchart with ${L.nodes.length} steps`);
      xgBox(this._view, L, this.a("height", ""), this.hasAttribute("fit"));
      xgPaint(this._view, this.a("active", ""));
      if (!this._ro && typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => {
          const w = this._measure();
          // the first paint has no width yet, so a block that starts narrow lands on tb and flips to lr once measured
          if (this.a("dir", "auto") === "auto" && w && Math.abs(w - (this._dirW || 0)) > 40) { this._sigDone = null; this.render(); return; }
          if (!this._view.state.zoomed) { this._view.fit(); xgPaint(this._view, this.a("active", "")); }
        });
        this._ro.observe(this._view.wrap);
      }
    }
    fit() { this._view.fitted = false; this._sigDone = null; this.render(); }
    zoomBy(f) { this._view.setZ(this._view.state.z * (f || 1.25)); }
  });

  define("x-tree", class extends Base {
    static owns = true;
    init() {
      this._view = xgView(this);
      this._collapsed = new Set();
      this._view.wrap.addEventListener("click", (e) => {
        if (this._view.moved()) return;
        const hit = e.target.closest(".xgn");
        if (hit) this.select(hit.dataset.id);
      });
    }
    get value() { return this.getAttribute("active") || null; }
    select(id) {
      const n = (this._graph?.nodes || []).find((x) => x.id === id);
      if (!n) return;
      if (n.children && this.hasAttribute("collapse")) {
        if (this._collapsed.has(id)) this._collapsed.delete(id); else this._collapsed.add(id);
      } else {
        this.setAttribute("active", id);
        this.dispatchEvent(new CustomEvent("select", { bubbles: true, detail: { id, label: n.label, detail: n.detail } }));
        change(this);
      }
      this._sigDone = null;
      this.render();
    }
    dir() {
      const d = this.a("dir", "auto");
      if (d !== "auto") return d;
      const w = this._measure() || 700;
      return w > 600 ? "lr" : "tb";
    }
    _measure() { return this._view.wrap.clientWidth || this.clientWidth || (this.parentElement && this.parentElement.clientWidth) || 0; }
    render() {
      const src = this._src || "";
      const dir = this.dir();
      this._dirW = this._measure();
      const sig = [dir, src, [...this._collapsed].join(","), this.a("height", ""), this.a("caption", "")].join("\u0001");
      if (sig === this._sigDone) { xgPaint(this._view, this.a("active", "")); return; }
      this._sigDone = sig;
      const parsed = B.parseTree(src);
      this._graph = parsed;
      const kids = new Map(), hasParent = new Set();
      for (const e of parsed.edges) { (kids.get(e.from) || kids.set(e.from, []).get(e.from)).push(e.to); hasParent.add(e.to); }
      const hidden = new Set();
      const hide = (id) => { for (const k of kids.get(id) || []) { hidden.add(k); hide(k); } };
      for (const id of this._collapsed) hide(id);
      const count = (id) => (kids.get(id) || []).reduce((s, k) => s + 1 + count(k), 0);
      const nodes = parsed.nodes.filter((n) => !hidden.has(n.id)).map((n) => {
        const c = (kids.get(n.id) || []).length;
        return { ...n, kind: hasParent.has(n.id) ? "tree" : "root", children: c, folded: this._collapsed.has(n.id), label: this._collapsed.has(n.id) ? `${n.label}  +${count(n.id)}` : n.label };
      });
      const ids = new Set(nodes.map((n) => n.id));
      const edges = parsed.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
      const L = B.graphLayout(nodes, edges, dir, { order: "preserve", estimate: (label, kind, node) => xgNodeSize({ label, kind, ...node }) });
      xgDraw(this._view, L, { dir, interactive: true, onToggle: this.hasAttribute("collapse") });
      xgBox(this._view, L, this.a("height", ""), this.hasAttribute("fit"));
      xgPaint(this._view, this.a("active", ""));
      if (!this._ro && typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => {
          const w = this._measure();
          if (this.a("dir", "auto") === "auto" && w && Math.abs(w - (this._dirW || 0)) > 40) { this._sigDone = null; this.render(); return; }
          if (!this._view.state.zoomed) this._view.fit();
        });
        this._ro.observe(this._view.wrap);
      }
    }
    fit() { this._view.fitted = false; this._sigDone = null; this.render(); }
    zoomBy(f) { this._view.setZ(this._view.state.z * (f || 1.25)); }
  });

  // ---------------------------------------------------------------- x-list: the outline
  // Nested, labelled, selectable rows — the structure a markdown list cannot carry (detail, meta,
  // collapse, selection) built from the same row language as the rest of the app.
  const xlParse = (src) => {
    const raw = String(src || "").replace(/\r/g, "").split("\n");
    const indent = (l) => (l.match(/^[\t ]*/) || [""])[0].replace(/\t/g, "  ").length;
    const body = raw.filter((l) => l.trim() && !l.trim().startsWith("#"));
    const base = body.length ? Math.min(...body.map(indent)) : 0;
    const out = [];
    for (const line of raw) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const depth = Math.max(0, Math.floor((indent(line) - base) / 2));
      const text = line.trim().replace(/^[-*+•]\s+/, "");
      if (!text) continue;
      const cell = text.split(/\s*\|\s*/);                       // an empty cell (Label | | Mon) is just an empty column
      out.push({ depth, label: (cell[0] || "").trim(), detail: (cell[1] || "").trim(), meta: (cell[2] || "").trim(), children: [] });
    }
    const roots = [], stack = [];
    out.forEach((item) => {
      const parent = item.depth > 0 ? stack[item.depth - 1] : null;
      if (parent) parent.children.push(item); else roots.push(item);
      stack[item.depth] = item;
      stack.length = item.depth + 1;
    });
    return roots;
  };

  define("x-list", class extends Base {
    static owns = true;
    init() {
      this.tabIndex = 0;
      this.setAttribute("role", "tree");
      this._collapsed = new Set();
      this._cursor = 0;
      this._picked = [];
      this.addEventListener("click", (e) => {
        const row = e.target.closest(".xl-i");
        if (!row) return;
        const item = this._flat[+row.dataset.i];
        if (!item) return;
        this._cursor = +row.dataset.i;
        if (e.target.closest(".xl-chev")) this.toggle(item);
        else this.pick(item);
        this.mark();
      });
      this.addEventListener("keydown", (e) => {
        const item = this._flat[this._cursor];
        if (!item) return;
        const rows = this._flat.filter((x) => x.visible);
        const at = rows.indexOf(item);
        if (e.key === "ArrowDown") this._cursor = this._flat.indexOf(rows[Math.min(rows.length - 1, at + 1)]);
        else if (e.key === "ArrowUp") this._cursor = this._flat.indexOf(rows[Math.max(0, at - 1)]);
        else if (e.key === "Home") this._cursor = this._flat.indexOf(rows[0]);
        else if (e.key === "End") this._cursor = this._flat.indexOf(rows[rows.length - 1]);
        else if (e.key === "ArrowRight") { this._collapsed.delete(this._key(item)); }
        else if (e.key === "ArrowLeft") { if (item.children.length) this._collapsed.add(this._key(item)); }
        else if (e.key === "Enter" || e.key === " ") this.pick(item);
        else return;
        e.preventDefault();
        this._sigDone = null;
        this.render();
        this.mark();
      });
    }
    _key(item) { return this._flat.indexOf(item); }
    get value() { return this.a("select") === "multi" ? this._picked.slice() : (this._picked[this._picked.length - 1] || null); }
    get values() { return this._picked.slice(); }
    pick(item) {
      if (this.a("select", "none") === "none") return;
      const label = item.label;
      if (this.a("select") === "multi") this._picked = this._picked.includes(label) ? this._picked.filter((x) => x !== label) : [...this._picked, label];
      else this._picked = this._picked[0] === label && this.a("select") === "single" ? [label] : [label];
      this.dispatchEvent(new CustomEvent("select", { bubbles: true, detail: { value: this.value, label, detail: item.detail } }));
      change(this);
    }
    toggle(item) {
      const k = this._key(item);
      if (this._collapsed.has(k)) this._collapsed.delete(k); else this._collapsed.add(k);
      this._sigDone = null;
      this.render();
    }
    mark() {
      for (const el of this.querySelectorAll(".xl-i")) {
        const item = this._flat[+el.dataset.i];
        el.classList.toggle("on", item && this._picked.includes(item.label));
        el.classList.toggle("cur", +el.dataset.i === this._cursor && this._hasFocus !== false);
        if (item) el.setAttribute("aria-selected", String(!!item && this._picked.includes(item.label)));
      }
    }
    render() {
      const src = this._src || "";
      const sig = [src, [...this._collapsed].join(","), this._picked.join("\u0001"), this.a("markers", "dot"), this.a("select", "none")].join("\u0002");
      if (sig === this._sigDone) return;
      this._sigDone = sig;
      const roots = xlParse(src);
      this._flat = [];
      const walk = (items, depth, parentVisible = true) => items.forEach((item) => {
        const index = this._flat.length;
        item.depth = depth;
        item.visible = parentVisible;
        this._flat.push(item);
        if (item.children.length) walk(item.children, depth + 1, parentVisible && !this._collapsed.has(index));
      });
      walk(roots, 0);
      const markers = this.a("markers", "dot");
      this.textContent = "";
      const build = (items, index = { n: 0 }, counters = []) => {
        const ul = document.createElement("ul");
        ul.className = "xl";
        items.forEach((item) => {
          const i = this._flat.indexOf(item);
          if (!item.visible) return;
          const li = document.createElement("li");
          li.className = "xl-i";
          li.dataset.i = String(i);
          li.setAttribute("role", "treeitem");
          if (item.children.length) li.setAttribute("aria-expanded", String(!this._collapsed.has(i)));
          const row = document.createElement("div");
          row.className = "xl-row";
          if (markers !== "none") {
            const mk = document.createElement("span");
            mk.className = "xl-mk";
            if (markers === "number") {
              counters[item.depth] = (counters[item.depth] || 0) + 1;
              counters.length = item.depth + 1;
              mk.textContent = counters.join(".") + (item.depth === 0 ? "." : "");
            } else mk.textContent = item.children.length && !this._collapsed.has(i) ? "▾" : markers === "dash" ? "–" : "•";
            row.appendChild(mk);
          }
          const tx = document.createElement("span");
          tx.className = "xl-tx";
          tx.textContent = item.label;
          if (item.detail) { const d = document.createElement("small"); d.textContent = item.detail; tx.appendChild(d); }
          row.appendChild(tx);
          if (item.meta) { const m = document.createElement("span"); m.className = "xl-meta"; m.textContent = item.meta; row.appendChild(m); }
          if (item.children.length) {
            const chev = document.createElement("button");
            chev.type = "button";
            chev.className = "xl-chev" + (this._collapsed.has(i) ? " closed" : "");
            chev.setAttribute("aria-label", this._collapsed.has(i) ? "Expand" : "Collapse");
            const ic = svg("svg", { viewBox: "0 0 12 12", width: "11", height: "11" });
            svg("path", { d: "M2.5,4 L6,8 L9.5,4", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" }, ic);
            chev.appendChild(ic);
            row.appendChild(chev);
          }
          li.appendChild(row);
          if (item.children.length && !this._collapsed.has(i)) li.appendChild(build(item.children, index, counters));
          ul.appendChild(li);
        });
        return ul;
      };
      this.appendChild(build(roots));
      this.classList.toggle("selectable", this.a("select", "none") !== "none");
      this.classList.toggle("dense", this.hasAttribute("dense"));
      this.addEventListener("focus", () => { this._hasFocus = true; this.mark(); }, { once: true });
      this.addEventListener("blur", () => { this._hasFocus = false; this.mark(); }, { once: true });
      this._hasFocus = this.ownerDocument.activeElement === this;
      this.mark();
    }
    expand(id) { this._collapsed.delete(id); this._sigDone = null; this.render(); }
    collapse(id) { this._collapsed.add(id); this._sigDone = null; this.render(); }
  });

  // ================================================================ time
  define("x-timer", class extends Base {
    init() { this.mode = this.a("mode", "down"); this.total = this.n("seconds", this.mode === "up" ? 0 : 60); this._s0 = this.n("seconds", null); this.left = this.total; this.elapsed = 0; this.running = false; if (this.hasAttribute("autostart")) requestAnimationFrame(() => this.start()); }
    // a new `seconds` value (e.g. a mode switch bound with :seconds) always takes effect, even mid-run
    render() { if (this.hasAttribute("seconds") && this.n("seconds") !== this._s0 && this.mode !== "up") { const was = this.running; this._s0 = this.n("seconds"); if (was) this.stop(); this.total = this.left = this._s0; this.elapsed = 0; if (was && this.hasAttribute("keep-running")) this.start(); this.tick(); return; } this.paint(); }
    paint() { this.textContent = fmt(this.mode === "up" ? this.elapsed : this.left); this.classList.toggle("low", this.mode !== "up" && this.running && this.left <= 10); }
    tick() { this.paint(); this.dispatchEvent(new CustomEvent("tick", { bubbles: true, detail: { id: this.id, left: this.left, total: this.total, elapsed: this.elapsed } })); }
    start() {
      if (this.running) return; this.running = true; this._last = performance.now(); this.setAttribute("running", "");
      this._iv = setInterval(() => {
        const n = performance.now(), dt = (n - this._last) / 1000; this._last = n; this.elapsed += dt;
        if (this.mode !== "up") { this.left -= dt; if (this.left <= 0) { this.left = 0; this.stop(); this.tick(); this.dispatchEvent(new CustomEvent("done", { bubbles: true })); return; } }
        this.tick();
      }, 200);
    }
    stop() { this.running = false; clearInterval(this._iv); this.removeAttribute("running"); this.paint(); }
    toggle() { this.running ? this.stop() : this.start(); }
    reset(s) { this.stop(); if (s !== undefined) this.total = s; this.left = this.total; this.elapsed = 0; this.tick(); }
    set(s) { this.reset(s); }
    add(s) { this.left = Math.max(0, this.left + num(s)); this.total = Math.max(this.total, this.left); this.tick(); }
    pause() { this.stop(); } resume() { this.start(); }
    get seconds() { return this.value; }
    get value() { return Math.round(this.mode === "up" ? this.elapsed : this.left); }
  }, { void: true });
  define("x-stopwatch", class extends (customElements.get("x-timer")) { init() { this.setAttribute("mode", "up"); super.init(); } }, { void: true });
  define("x-clock", class extends Base {
    init() {
      const s = (this._s = svg("svg", { viewBox: "0 0 100 100" }, this));
      svg("circle", { cx: 50, cy: 50, r: 47, fill: "var(--surface)", stroke: "var(--line)" }, s);
      for (let i = 0; i < 60; i++) { const a = (i / 60) * 2 * Math.PI, r1 = i % 5 ? 43 : 40; svg("line", { x1: 50 + Math.sin(a) * r1, y1: 50 - Math.cos(a) * r1, x2: 50 + Math.sin(a) * 45, y2: 50 - Math.cos(a) * 45, stroke: i % 5 ? "var(--line)" : "var(--muted)", "stroke-width": i % 5 ? 0.6 : 1.2 }, s); }
      const C = (this._C = 2 * Math.PI * 36);
      this._arc = svg("circle", { cx: 50, cy: 50, r: 36, fill: "none", stroke: "var(--accent)", "stroke-width": 3, opacity: 0.85, transform: "rotate(-90 50 50)", "stroke-dasharray": C, "stroke-dashoffset": C }, s);
      this._arc.style.transition = "stroke-dashoffset .3s linear";
      this._h = svg("line", { x1: 50, y1: 50, x2: 50, y2: 28, stroke: "var(--fg)", "stroke-width": 2.6, "stroke-linecap": "round" }, s);
      this._m = svg("line", { x1: 50, y1: 50, x2: 50, y2: 16, stroke: "var(--fg)", "stroke-width": 1.8, "stroke-linecap": "round" }, s);
      this._sec = svg("line", { x1: 50, y1: 56, x2: 50, y2: 12, stroke: "var(--accent)", "stroke-width": 0.8 }, s);
      svg("circle", { cx: 50, cy: 50, r: 2, fill: "var(--fg)" }, s);
      document.addEventListener("tick", (e) => { const f = this.getAttribute("for"); if (f ? f !== e.detail.id : !this.hasAttribute("seconds")) return; this.show(e.detail.left, e.detail.total); });
      if (!this.hasAttribute("seconds") && !this.hasAttribute("time") && !this.hasAttribute("for")) { const up = () => { const d = new Date(); this.hands(d.getHours(), d.getMinutes(), d.getSeconds() + d.getMilliseconds() / 1000); }; up(); setInterval(up, 200); }
    }
    hands(h, m, s) { const rot = (el, deg) => el.setAttribute("transform", `rotate(${deg} 50 50)`); rot(this._h, ((h % 12) + m / 60) * 30); rot(this._m, (m + s / 60) * 6); rot(this._sec, s * 6); }
    show(left, total) { const m = Math.floor(left / 60), s = left % 60; this.hands(0, m, s); this._h.style.opacity = 0; this._arc.setAttribute("stroke-dashoffset", this._C * (1 - left / Math.max(1, total))); }
    render() { if (this.hasAttribute("time")) { const [h, m, s] = this.getAttribute("time").split(":").map(Number); this.hands(h || 0, m || 0, s || 0); } else if (this.hasAttribute("seconds")) { const t = this.n("seconds"); this.show(t, t); } }
  }, { void: true });

  // ================================================================ inputs
  define("x-segmented", class extends Base {
    render() {
      const opts = list(this.getAttribute("options")); if (this._v === undefined) this._v = this.getAttribute("value") ?? opts[0];
      this.innerHTML = ""; opts.forEach((o) => { const b = document.createElement("button"); b.type = "button"; b.textContent = o; if (o === this._v) b.className = "on"; b.onclick = () => { this._v = o; this.render(); change(this); }; this.appendChild(b); });
    }
    get value() { return this._v; } set value(v) { this._v = v; this.render(); }
  });
  define("x-toggle", class extends Base {
    init() { this.tabIndex = 0; this.setAttribute("role", "switch"); const t = () => { this.toggleAttribute("checked"); change(this); }; this.addEventListener("click", t); this.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); t(); } }); }
    get value() { return this.hasAttribute("checked"); } set value(v) { this.toggleAttribute("checked", !!v); }
    get checked() { return this.value; }
  }, { void: true });
  // checklist: lines "- [x] done item" / "- [ ] open item" / plain; `add` lets the user append items; value = [{text, done}]
  define("x-todo", class extends Base {
    static owns = true;
    init() { this._items = lines(this._src).map((l) => ({ text: l.replace(/^[-*]\s*/, "").replace(/^\[[ xX]\]\s*/, ""), done: /^[-*]?\s*\[[xX]\]/.test(l) })); }
    get value() { return this._items.map((i) => ({ ...i })); }
    set value(v) { if (Array.isArray(v)) { this._items = v.map((i) => (typeof i === "string" ? { text: i, done: false } : { text: String(i.text || ""), done: !!i.done })); this.render(); } }
    get done() { return this._items.filter((i) => i.done).length; }
    get total() { return this._items.length; }
    render() {
      const add = this.hasAttribute("add");
      this.innerHTML = `<div class="td-h"><span>${esc(this.a("title", ""))}</span><small>${this.done}/${this.total}</small></div>` +
        this._items.map((it, i) => `<label class="td${it.done ? " on" : ""}" style="--i:${i}"><input type="checkbox" data-i="${i}"${it.done ? " checked" : ""}><span>${esc(it.text)}</span>${add ? `<button type="button" class="td-x" data-x="${i}" aria-label="Remove">×</button>` : ""}</label>`).join("") +
        (add ? `<form class="td-add"><input aria-label="Add item"><button type="submit">Add</button></form>` : "");
      this.querySelectorAll("input[type=checkbox]").forEach((c) => (c.onchange = () => { this._items[+c.dataset.i].done = c.checked; this.render(); change(this); }));
      this.querySelectorAll("[data-x]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); this._items.splice(+b.dataset.x, 1); this.render(); change(this); }));
      const f = this.querySelector(".td-add");
      if (f) f.onsubmit = (e) => { e.preventDefault(); e.stopPropagation(); const v = f.querySelector("input").value.trim(); if (!v) return; this._items.push({ text: v, done: false }); this.render(); change(this); this.querySelector(".td-add input").focus(); };
      B.typeset(this);
    }
  });
  // multiple choice: options="A|B|C" answer="B" (text, letter or 1-based index) multi reveal
  define("x-choice", class extends Base {
    static owns = true;
    init() { this._sel = []; const src = lines(this._src); this._opts = src.length ? src.map((l) => l.replace(/^[-*]\s*|^[A-Ha-h][).]\s+/, "")) : null; }
    opts() { return this._opts && this._opts.length ? this._opts : list(this.getAttribute("options"), "|").length > 1 ? list(this.getAttribute("options"), "|") : list(this.getAttribute("options")); }
    answerIdx() {
      const a = this.getAttribute("answer"); if (a === null) return [];
      const o = this.opts();
      return a.split(",").map((x) => x.trim()).map((x) => (/^[A-Ha-h]$/.test(x) ? x.toUpperCase().charCodeAt(0) - 65 : /^\d+$/.test(x) && +x >= 1 && +x <= o.length && !o.includes(x) ? +x - 1 : o.findIndex((y) => y === x))).filter((i) => i >= 0);
    }
    render() {
      const o = this.opts(), multi = this.hasAttribute("multi"), rev = this.hasAttribute("reveal") && this.getAttribute("reveal") !== "false", ans = this.answerIdx();
      if (!this._built || this._built !== o.join("\u0001")) {
        this._built = o.join("\u0001");
        // `other` adds a write-your-own answer, `skip` a way out; both are plain options to the reader
        const other = this.hasAttribute("other"), skip = this.hasAttribute("skip");
        this.innerHTML = o.map((t, i) => `<button type="button" class="opt" data-i="${i}" style="--i:${i}"><span class="mk">${multi ? "" : String.fromCharCode(65 + i)}</span><span class="tx">${esc(t)}</span></button>`).join("") +
          (other ? `<label class="opt other" style="--i:${o.length}"><span class="mk">${multi ? "" : "\u2026"}</span><input class="tx" type="text" aria-label="Your own answer" placeholder="${esc(this.a("other", "") || "Other")}"></label>` : "") +
          (skip ? `<button type="button" class="skip">${esc(this.a("skip", "") || "Skip")}</button>` : "");
        this.querySelectorAll("button.opt").forEach((b) => (b.onclick = () => { if (this.hasAttribute("reveal") && this.getAttribute("reveal") !== "false" && this.hasAttribute("lock")) return; const i = +b.dataset.i; this._skip = false; this._sel = multi ? (this._sel.includes(i) ? this._sel.filter((x) => x !== i) : [...this._sel, i]) : [i]; if (!multi) this._other = ""; this.paint(); change(this); }));
        const oi = this.querySelector(".other input");
        if (oi) oi.oninput = () => { this._other = oi.value.trim(); this._skip = false; if (!multi) this._sel = []; this.paint(); change(this); };
        const sk = this.querySelector(".skip");
        if (sk) sk.onclick = () => { this._skip = !this._skip; if (this._skip) { this._sel = []; this._other = ""; if (oi) oi.value = ""; } this.paint(); change(this); };
        B.typeset(this);
      }
      this.classList.toggle("multi", multi); this._rev = rev; this._ans = ans; this.paint();
    }
    paint() {
      this.querySelectorAll(".opt").forEach((b, i) => {
        const on = this._sel.includes(i);
        b.classList.toggle("on", on);
        b.classList.toggle("ok", this._rev && this._ans.includes(i));
        b.classList.toggle("bad", this._rev && on && !this._ans.includes(i));
        b.disabled = this._rev && this.hasAttribute("lock");
      });
      const oth = this.querySelector(".opt.other"); if (oth) oth.classList.toggle("on", !!this._other);
      const sk = this.querySelector(".skip"); if (sk) sk.classList.toggle("on", !!this._skip);
      this.toggleAttribute("answered", this._sel.length > 0 || !!this._other || !!this._skip);
    }
    get skipped() { return !!this._skip; }
    get value() {
      if (this._skip) return "(skipped)";
      const o = this.opts(), picked = this._sel.map((i) => o[i]).concat(this._other ? [this._other] : []);
      return this.hasAttribute("multi") ? picked : picked.length ? picked[0] : null;
    }
    set value(v) { const o = this.opts(); const arr = Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]; this._sel = arr.map((x) => o.indexOf(x)).filter((i) => i >= 0); this.paint(); }
    get index() { return this._sel.length ? this._sel[0] : -1; }
    get correct() { const a = this.answerIdx(); if (!a.length) return null; return a.length === this._sel.length && a.every((i) => this._sel.includes(i)); }
    get answered() { return this._sel.length > 0; }
  });
  define("x-rating", class extends Base {
    render() {
      const max = this.n("max", 5); if (this._v === undefined) this._v = this.n("value", 0);
      this.innerHTML = Array.from({ length: max }, (_, i) => `<button type="button" aria-label="${i + 1}" class="${i < this._v ? "on" : ""}"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg></button>`).join("");
      this.querySelectorAll("button").forEach((b, i) => (b.onclick = () => { this._v = i + 1 === this._v ? 0 : i + 1; this.render(); change(this); }));
    }
    get value() { return this._v; } set value(v) { this._v = +v; this.render(); }
  }, { void: true });
  define("x-sortable", class extends Base {
    static owns = true;
    init() { this._items = lines(this._src).map((l) => l.replace(/^[-*\d.)]+\s*/, "")); }
    render() {
      this.innerHTML = this._items.map((t, i) => `<div class="it" data-i="${i}" style="--i:${i}"><span class="grip">⋮⋮</span><span>${esc(t)}</span></div>`).join("");
      this.querySelectorAll(".it").forEach((it) => {
        it.onpointerdown = (e) => {
          e.preventDefault(); const r0 = it.getBoundingClientRect(), y0 = e.clientY; it.classList.add("drag"); it.setPointerCapture(e.pointerId);
          it.onpointermove = (ev) => { it.style.transform = `translateY(${ev.clientY - y0}px)`; };
          it.onpointerup = (ev) => {
            it.onpointermove = it.onpointerup = null; it.classList.remove("drag"); it.style.transform = "";
            const mid = r0.top + r0.height / 2 + (ev.clientY - y0), from = +it.dataset.i;
            const to = [...this.querySelectorAll(".it")].filter((x) => x !== it).findIndex((x) => { const r = x.getBoundingClientRect(); return mid < r.top + r.height / 2; });
            const arr = [...this._items]; const [m] = arr.splice(from, 1); arr.splice(to < 0 ? arr.length : to, 0, m);
            this._items = arr; this.render(); change(this);
          };
        };
      });
      B.typeset(this);
    }
    get value() { return [...this._items]; }
  });
  define("x-sketch", class extends Base {
    init() {
      this.innerHTML = `<canvas></canvas><div class="sk-bar"><button type="button" class="sk-clear">Clear</button></div>`;
      const c = (this._c = this.querySelector("canvas")), g = c.getContext("2d"); let down = false;
      const fit = () => { const r = c.getBoundingClientRect(), d = devicePixelRatio || 1; const img = this._dirty ? c.toDataURL() : null; c.width = r.width * d; c.height = r.height * d; g.scale(d, d); g.lineCap = g.lineJoin = "round"; g.lineWidth = 2.2; g.strokeStyle = css("--fg"); if (img) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, r.width, r.height); im.src = img; } };
      requestAnimationFrame(fit); new ResizeObserver(fit).observe(c);
      const pt = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.onpointerdown = (e) => { down = true; c.setPointerCapture(e.pointerId); g.strokeStyle = css("--fg"); g.beginPath(); g.moveTo(...pt(e)); };
      c.onpointermove = (e) => { if (!down) return; g.lineTo(...pt(e)); g.stroke(); this._dirty = true; };
      c.onpointerup = () => { down = false; change(this); };
      this.querySelector(".sk-clear").onclick = () => { g.clearRect(0, 0, c.width, c.height); this._dirty = false; change(this); };
    }
    get value() { return this._dirty ? this._c.toDataURL("image/png") : null; }
  }, { void: true });
  define("x-upload", class extends Base {
    init() {
      this.innerHTML = `<label class="up"><input type="file" hidden ${this.hasAttribute("multiple") ? "multiple" : ""} accept="${esc(this.a("accept", ""))}"><span>${esc(this.a("label", "Choose file"))}</span></label>`;
      this._v = null;
      this.querySelector("input").onchange = async (e) => {
        const files = [...e.target.files]; if (!files.length) return;
        this.querySelector("span").textContent = files.map((f) => f.name).join(", ");
        const paths = []; for (const f of files) { const r = await B.upload(f, this.a("dir", "uploads")); if (r && r.path) paths.push(r.path); }
        this._v = this.hasAttribute("multiple") ? paths : paths[0] || null; change(this);
      };
    }
    get value() { return this._v; }
  }, { void: true });

  // ================================================================ media
  define("x-image", class extends Base {
    render() { const cap = this.getAttribute("caption"); this.innerHTML = `<img src="${esc(fileUrl(this.getAttribute("src") || ""))}" alt="${esc(this.a("alt", cap || ""))}" loading="lazy">${cap ? `<div class="cap">${esc(cap)}</div>` : ""}`; const im = this.querySelector("img"); im.onload = () => im.classList.add("in"); }
  }, { void: true });
  define("x-video", class extends Base { render() { this.innerHTML = `<video src="${esc(fileUrl(this.getAttribute("src") || ""))}" controls playsinline ${this.hasAttribute("loop") ? "loop" : ""} ${this.hasAttribute("autoplay") ? "autoplay muted" : ""}></video>`; } }, { void: true });
  define("x-audio", class extends Base { render() { this.innerHTML = `<audio src="${esc(fileUrl(this.getAttribute("src") || ""))}" controls></audio>`; } }, { void: true });
  define("x-youtube", class extends Base {
    render() { const raw = this.getAttribute("id") || this.getAttribute("vid") || this.getAttribute("url") || ""; const id = (raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || [])[1] || raw; const st = this.n("start", 0); this.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}${st ? "?start=" + st : ""}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; }
  }, { void: true });
  define("x-embed", class extends Base { render() { this.innerHTML = `<iframe src="${esc(fileUrl(this.getAttribute("src") || ""))}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" style="height:${this.n("height", 360)}px"></iframe>`; } }, { void: true });
  define("x-map", class extends Base {
    render() {
      this.innerHTML = `<div class="mp" style="height:${this.n("height", 280)}px"></div>`; const box = this.firstChild;
      B.loadLib("leaflet", "leaflet.css"); B.loadLib("leaflet", "leaflet.js").then(() => {
        const L = window.L, m = L.map(box, { zoomControl: true, attributionControl: false }).setView([this.n("lat", 20), this.n("lng", 0)], this.n("zoom", 3));
        L.tileLayer("https://{s}.basemaps.cartocdn.com/" + (document.body.dataset.theme === "dark" ? "dark_all" : "light_all") + "/{z}/{x}/{y}{r}.png", { maxZoom: 19 }).addTo(m);
        const pts = (this.getAttribute("markers") || "").split("|").map((s) => s.split(",").map((x) => x.trim())).filter((p) => p.length >= 2);
        pts.forEach(([la, ln, ...lab]) => { const mk = L.circleMarker([+la, +ln], { radius: 6, color: css("--accent"), weight: 2, fillOpacity: 0.6 }).addTo(m); if (lab.length) mk.bindTooltip(lab.join(","), { permanent: this.hasAttribute("labels") }); });
        if (pts.length > 1 && !this.hasAttribute("zoom")) m.fitBounds(pts.map((p) => [+p[0], +p[1]]), { padding: [24, 24] });
      });
    }
  }, { void: true });

  // ================================================================ state
  // <x-state score="0" answers="{}"> initial reactive values (JSON-parsed)
  define("x-state", class extends HTMLElement {
    connectedCallback() { if (this._d) return; this._d = true; this.hidden = true; for (const a of this.attributes) if (!(a.name in B.store) && a.name !== "hidden") B.setStore(a.name, parseVal(a.value)); }
  }, { void: true });
})();
