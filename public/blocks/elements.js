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
  const VIZ = /chart|graph|plot|draw|smiles|mol|mermaid|map|heatmap|sketch|image|video|youtube|embed|clock|ring|gauge|table|timeline|md|code/;
  B.skelKind = (t) => (VIZ.test(t) ? "viz" : /choice|sortable|kv|callout/.test(t) ? "list" : /input|select|textarea|segmented|toggle|rating|timer|stat|button|upload/.test(t) ? "line" : "block");

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
    render() { const n = this.getAttribute("name"); if (!n || this._n === n) return; this._n = n; fetch(`https://unpkg.com/lucide-static@0.469.0/icons/${encodeURIComponent(n)}.svg`).then((r) => (r.ok ? r.text() : "")).then((t) => { this.innerHTML = t; }).catch(() => {}); }
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
      if (window.marked) put(); else load("https://cdn.jsdelivr.net/npm/marked@14/marked.min.js").then(put, put);
    }
  });
  define("x-code", class extends Base {
    static owns = true;
    render() {
      const code = (this._src || "").replace(/^\n/, "").replace(/\s+$/, ""), lang = this.a("lang", "");
      this.innerHTML = `<div class="x-code-h"><span>${esc(lang)}</span><button type="button">Copy</button></div><pre><code>${esc(code)}</code></pre>`;
      this.querySelector("button").onclick = (e) => { navigator.clipboard.writeText(code); e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy"), 1200); };
      load("https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.10.0/highlight.min.js").then(() => { const c = this.querySelector("code"); try { c.innerHTML = lang && window.hljs.getLanguage(lang) ? window.hljs.highlight(code, { language: lang }).value : window.hljs.highlightAuto(code).value; } catch {} }).catch(() => {});
    }
  });

  // ================================================================ data display
  define("x-stat", class extends Base {
    render() {
      const raw = this.a("value", ""), d = this.getAttribute("delta"), unit = this.a("unit", "");
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
  function series(el) {
    const raw = el.getAttribute("data") || "";
    let d;
    if (/^\s*[[{]/.test(raw)) { try { d = JSON.parse(raw); } catch { d = []; } if (!Array.isArray(d[0]) && typeof d[0] !== "object") d = [d]; }
    else d = raw.split("|").map((s) => s.split(",").map((x) => x.trim()).filter((x) => x !== ""));
    const names = list(el.getAttribute("series") || "", "|");
    return { series: d.map((arr, i) => ({ name: names[i] || "", values: arr })), labels: list(el.getAttribute("labels") || "", el.getAttribute("labels")?.includes("|") ? "|" : ",") };
  }
  const nice = (lo, hi, n = 4) => { const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0; const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step; const t = []; for (let v = a; v <= b + step / 2; v += step) t.push(+v.toFixed(10)); return t; };
  const short = (v) => (Math.abs(v) >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e4 ? +(v / 1e3).toFixed(1) + "k" : +(+v).toFixed(2));
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
        if (S.length > 1) legend(S.map((se, i) => [se.name, pal[i % pal.length]])); return;
      }
      const W = 360, H = 200, P = { l: 36, r: 10, t: 10, b: 26 };
      const s = svg("svg", { viewBox: `0 0 ${W} ${H}` }, this);
      if (type === "scatter") {
        const pts = S.flatMap((se, si) => se.values.map((p) => [...String(p).split(":").map(Number), si]));
        const xs = nice(Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))), ys = nice(Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])));
        const X = (v) => P.l + ((v - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * (W - P.l - P.r), Y = (v) => H - P.b - ((v - ys[0]) / (ys[ys.length - 1] - ys[0] || 1)) * (H - P.t - P.b);
        ys.forEach((v) => { svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: "ax" }, s); svg("text", { x: P.l - 5, y: Y(v) + 3, "text-anchor": "end", class: "lbl" }, s).textContent = short(v); });
        xs.forEach((v) => (svg("text", { x: X(v), y: H - 8, "text-anchor": "middle", class: "lbl" }, s).textContent = short(v)));
        pts.forEach((p, i) => { const c = svg("circle", { cx: X(p[0]), cy: Y(p[1]), r: 3.4, fill: pal[p[2] % pal.length], class: "pop" }, s); c.style.animationDelay = Math.min(i * 15, 800) + "ms"; svg("title", {}, c).textContent = `${p[0]}, ${p[1]}`; });
        this.axisLabels(s, W, H); if (S.length > 1) legend(S.map((se, i) => [se.name, pal[i % pal.length]])); return;
      }
      const n = Math.max(...S.map((x) => x.values.length), 1), stacked = type === "stacked", horiz = type === "hbar";
      const sums = Array.from({ length: n }, (_, i) => S.reduce((a, se) => a + num(se.values[i]), 0));
      const all = stacked ? sums : S.flatMap((x) => x.values.map(Number));
      const ticks = nice(Math.min(0, ...all), Math.max(0, ...all)), lo = ticks[0], hi = ticks[ticks.length - 1];
      if (horiz) {
        const L = 70, bh = ((H - P.t - P.b) / n) * 0.7, X = (v) => L + ((v - lo) / (hi - lo || 1)) * (W - L - P.r), Y = (i) => P.t + ((i + 0.5) * (H - P.t - P.b)) / n;
        ticks.forEach((v) => { svg("line", { x1: X(v), x2: X(v), y1: P.t, y2: H - P.b, class: "ax" }, s); svg("text", { x: X(v), y: H - 8, "text-anchor": "middle", class: "lbl" }, s).textContent = short(v); });
        S.forEach((se, si) => se.values.forEach((v, i) => { const r = svg("rect", { x: X(Math.min(0, v)), y: Y(i) - bh / 2 + (si * bh) / S.length, width: Math.abs(X(v) - X(0)), height: bh / S.length - 2, rx: 3, fill: pal[si % pal.length], class: "growx" }, s); r.style.animationDelay = i * 40 + "ms"; svg("title", {}, r).textContent = `${labels[i] || ""} ${v}`; }));
        labels.forEach((l, i) => (svg("text", { x: L - 6, y: Y(i) + 3, "text-anchor": "end", class: "lbl" }, s).textContent = l.slice(0, 12)));
        if (S.length > 1) legend(S.map((se, i) => [se.name, pal[i % pal.length]])); return;
      }
      const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo || 1));
      ticks.forEach((v) => { svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: "ax" }, s); svg("text", { x: P.l - 5, y: Y(v) + 3, "text-anchor": "end", class: "lbl" }, s).textContent = short(v); });
      const bar = type === "bar" || stacked, X = (i) => P.l + (bar ? ((i + 0.5) * (W - P.l - P.r)) / n : n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
      labels.forEach((l, i) => { if (i < n && (n <= 12 || i % Math.ceil(n / 10) === 0)) svg("text", { x: X(i), y: H - 8, "text-anchor": "middle", class: "lbl" }, s).textContent = l; });
      const base = Array(n).fill(0);
      S.forEach((se, si) => {
        const col = pal[si % pal.length], v = se.values.map(Number);
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
      if (S.length > 1) legend(S.map((se, i) => [se.name, pal[i % pal.length]]));
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

  // interactive function graph: fn="a*sin(x); x^2/4"  params come from scope (named inputs / state)
  const MATHN = new Set(Object.getOwnPropertyNames(Math).concat(["x", "t", "theta", "r", "e", "pi", "ln", "log10", "sec", "csc", "cot"]));
  function compileExpr(src, vars) {
    let e = String(src).replace(/\^/g, "**").replace(/π/g, "PI").replace(/θ/g, "theta").replace(/\bpi\b/g, "PI").replace(/\bln\(/g, "log(")
      .replace(/(\d)\s*([a-zA-Z(])/g, "$1*$2").replace(/\)\s*([a-zA-Z(\d])/g, ")*$1");
    const free = [...new Set((e.match(/\b[a-zA-Z_]\w*\b/g) || []).filter((w) => !MATHN.has(w) && !MATHN.has(w.toLowerCase())))];
    const pro = free.map((w) => `const ${w}=+v[${JSON.stringify(w)}]||0;`).join("");
    // eslint-disable-next-line no-new-func
    const f = new Function(vars, "v", `with(Math){const e=E,sec=(z)=>1/cos(z),csc=(z)=>1/sin(z),cot=(z)=>1/tan(z);${pro}return (${e});}`);
    return { f, free };
  }
  define("x-graph", class extends Base {
    static owns = true;
    init() {
      this.dataset.reactive = ""; this.dataset.themed = "";
      const x0 = this.n("xmin", -10), x1 = this.n("xmax", 10);
      this.view = { x0, x1, y0: this.getAttribute("ymin"), y1: this.getAttribute("ymax") };
      this._wrap = document.createElement("div"); this._wrap.className = "gw"; this.appendChild(this._wrap);
      this._tip = document.createElement("div"); this._tip.className = "gtip"; this._wrap.appendChild(this._tip);
      let drag = null;
      this._wrap.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, v: { ...this.view } }; this._wrap.setPointerCapture(e.pointerId); });
      this._wrap.addEventListener("pointermove", (e) => {
        const r = this._wrap.getBoundingClientRect();
        if (drag) { const dx = ((e.clientX - drag.x) / r.width) * (drag.v.x1 - drag.v.x0), dy = ((e.clientY - drag.y) / r.height) * (drag.v.y1 - drag.v.y0); this.view = { x0: drag.v.x0 - dx, x1: drag.v.x1 - dx, y0: drag.v.y0 + dy, y1: drag.v.y1 + dy }; this.paint(false); }
        else if (this._fns) { const x = this.view.x0 + ((e.clientX - r.left) / r.width) * (this.view.x1 - this.view.x0); const ys = this._fns.map((f) => { try { return f.f(x, this._vars); } catch { return NaN; } }).filter(isFinite); this._tip.textContent = `x ${x.toFixed(2)}${ys.length ? "  y " + ys.map((y) => y.toFixed(3)).join(", ") : ""}`; this._tip.style.opacity = 1; }
      });
      this._wrap.addEventListener("pointerup", () => (drag = null));
      this._wrap.addEventListener("pointerleave", () => (this._tip.style.opacity = 0));
      this._wrap.addEventListener("wheel", (e) => { e.preventDefault(); const r = this._wrap.getBoundingClientRect(), k = Math.exp(e.deltaY * 0.0015), fx = (e.clientX - r.left) / r.width, fy = 1 - (e.clientY - r.top) / r.height, v = this.view; const cx = v.x0 + fx * (v.x1 - v.x0), cy = v.y0 + fy * (v.y1 - v.y0); this.view = { x0: cx - (cx - v.x0) * k, x1: cx + (v.x1 - cx) * k, y0: cy - (cy - v.y0) * k, y1: cy + (v.y1 - cy) * k }; this.paint(false); }, { passive: false });
      this._wrap.addEventListener("dblclick", () => { this.view = { x0, x1, y0: this.getAttribute("ymin"), y1: this.getAttribute("ymax") }; this.paint(false); });
    }
    render() { this._key = null; this.refresh(true); }
    refresh(force) {
      const src = this.getAttribute("fn") || this._src || "x";
      if (!this._fns || this._srcFn !== src) {
        this._srcFn = src;
        this._fns = src.split(/;|\n/).map((s) => s.trim()).filter(Boolean).map((s) => {
          let m;
          if ((m = s.match(/^x\s*=\s*(.+?)\s*,\s*y\s*=\s*(.+)$/))) { const X = compileExpr(m[1], "t"), Y = compileExpr(m[2], "t"); return { kind: "param", fx: X.f, fy: Y.f, free: [...X.free, ...Y.free], label: s }; }
          if ((m = s.match(/^r\s*=\s*(.+)$/))) { const R = compileExpr(m[1], "theta"); return { kind: "polar", f: R.f, free: R.free, label: s }; }
          const body = s.replace(/^(?:y|f\(x\))\s*=\s*/, ""); const c = compileExpr(body, "x"); return { kind: "fn", f: c.f, free: c.free, label: "y = " + body };
        });
      }
      const vars = {}; this._fns.forEach((f) => f.free.forEach((k) => { const v = B.evaluate(k); vars[k] = typeof v === "number" ? v : num(v, 0); }));
      const key = JSON.stringify(vars);
      if (!force && key === this._key) return;
      const first = this._key === null || this._key === undefined; this._key = key; this._vars = vars;
      this.paint(first);
    }
    paint(animate) {
      const W = 400, H = this.n("height", 250), v = this.view, pal = PAL(), N = 600;
      const samples = this._fns.map((f) => {
        const pts = [];
        if (f.kind === "fn") for (let i = 0; i <= N; i++) { const x = v.x0 + ((v.x1 - v.x0) * i) / N; let y; try { y = f.f(x, this._vars); } catch { y = NaN; } pts.push([x, y]); }
        else { const [t0, t1] = f.kind === "polar" ? [0, 2 * Math.PI * this.n("turns", 1)] : [this.n("tmin", 0), this.n("tmax", 2 * Math.PI)]; for (let i = 0; i <= N; i++) { const t = t0 + ((t1 - t0) * i) / N; try { if (f.kind === "polar") { const r = f.f(t, this._vars); pts.push([r * Math.cos(t), r * Math.sin(t)]); } else pts.push([f.fx(t, this._vars), f.fy(t, this._vars)]); } catch { pts.push([NaN, NaN]); } } }
        return pts;
      });
      if (v.y0 === null || v.y0 === undefined || v.y1 === null || v.y1 === undefined) {
        const ys = samples.flat().map((p) => p[1]).filter(isFinite).sort((a, b) => a - b);
        let lo = ys.length ? ys[Math.floor(ys.length * 0.02)] : -1, hi = ys.length ? ys[Math.ceil(ys.length * 0.98) - 1] : 1;
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.12; v.y0 = num(v.y0, lo - pad); v.y1 = num(v.y1, hi + pad);
        if (this.hasAttribute("equal")) { const mid = (v.y0 + v.y1) / 2, half = ((v.x1 - v.x0) * H) / W / 2; v.y0 = mid - half; v.y1 = mid + half; }
      }
      v.y0 = +v.y0; v.y1 = +v.y1;
      const X = (x) => ((x - v.x0) / (v.x1 - v.x0)) * W, Y = (y) => H - ((y - v.y0) / (v.y1 - v.y0)) * H;
      const old = this._wrap.querySelector("svg"); if (old) old.remove();
      const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" }); this._wrap.prepend(s);
      nice(v.x0, v.x1, 8).forEach((gx) => { svg("line", { x1: X(gx), x2: X(gx), y1: 0, y2: H, class: "ax", opacity: gx === 0 ? 1 : 0.45 }, s); if (gx !== 0) svg("text", { x: X(gx) + 2, y: Math.min(H - 3, Math.max(10, Y(0) + 11)), class: "lbl" }, s).textContent = short(gx); });
      nice(v.y0, v.y1, 6).forEach((gy) => { svg("line", { x1: 0, x2: W, y1: Y(gy), y2: Y(gy), class: "ax", opacity: gy === 0 ? 1 : 0.45 }, s); if (gy !== 0) svg("text", { x: Math.min(W - 24, Math.max(2, X(0) + 3)), y: Y(gy) - 2, class: "lbl" }, s).textContent = short(gy); });
      samples.forEach((pts, i) => {
        let d = "", pen = false; const span = v.y1 - v.y0;
        pts.forEach(([x, y], k) => { if (!isFinite(x) || !isFinite(y) || y < v.y0 - span * 2 || y > v.y1 + span * 2 || (pen && k && Math.abs(y - pts[k - 1][1]) > span * 1.5)) { pen = false; return; } d += `${pen ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`; pen = true; });
        const p = svg("path", { d, fill: "none", stroke: pal[i % pal.length], "stroke-width": 2.2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }, s);
        if (animate) drawIn(p, 0.05 + i * 0.12);
      });
      const ptsAttr = this.getAttribute("points");
      if (ptsAttr) ptsAttr.split(";").forEach((pp, k) => { const [px, py, lab] = pp.split(",").map((z) => z.trim()); const c = svg("circle", { cx: X(+px), cy: Y(+py), r: 3.5, fill: "var(--fg)", class: animate ? "pop" : "" }, s); c.style.animationDelay = 0.6 + k * 0.05 + "s"; if (lab) svg("text", { x: X(+px) + 6, y: Y(+py) - 6, class: "lbl", fill: "var(--fg)" }, s).textContent = lab; });
      let lg = this.querySelector(".legend");
      if (this._fns.length > 1 || this.hasAttribute("legend")) { if (!lg) { lg = document.createElement("div"); lg.className = "legend"; this.appendChild(lg); } lg.innerHTML = this._fns.map((f, i) => `<span><i style="background:${pal[i % pal.length]}"></i>${esc(f.label)}</span>`).join(""); }
    }
  });
  define("x-plot", class extends (customElements.get("x-graph")) {});

  define("x-smiles", class extends Base {
    render() {
      const sm = this.getAttribute("smiles") || (this._src || "").trim(); if (!sm) return;
      this.dataset.themed = ""; this.innerHTML = "";
      const s = svg("svg", { id: "sm" + Math.random().toString(36).slice(2) }, this); s.style.minHeight = (this.n("height", 200)) + "px";
      load("https://unpkg.com/smiles-drawer@2.0.1/dist/smiles-drawer.min.js").then(() => {
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
      load("https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/3Dmol-min.js").then(async () => {
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
      import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs").then(async ({ default: m }) => {
        m.initialize({ startOnLoad: false, theme: "base", fontFamily: "inherit", themeVariables: { darkMode: dark, background: "transparent", primaryColor: css("--surface-solid") || (dark ? "#2b2a27" : "#e8e2d7"), primaryTextColor: css("--fg"), primaryBorderColor: css("--line-solid") || css("--muted"), lineColor: css("--muted"), secondaryColor: dark ? "#2f2c28" : "#efe9df", tertiaryColor: "transparent", fontSize: "14px" } });
        try { const { svg: out } = await m.render("m" + Math.random().toString(36).slice(2), code); this.innerHTML = out; this.firstElementChild && this.firstElementChild.classList.add("pop"); } catch (e) { this.innerHTML = `<div class="err">${esc(e.message || e)}</div>`; }
      });
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
    }
  });

  // ================================================================ time
  define("x-timer", class extends Base {
    init() { this.mode = this.a("mode", "down"); this.total = this.n("seconds", this.mode === "up" ? 0 : 60); this.left = this.total; this.elapsed = 0; this.running = false; if (this.hasAttribute("autostart")) requestAnimationFrame(() => this.start()); }
    render() { if (!this.running && this.hasAttribute("seconds") && this.n("seconds") !== this.total && this.mode !== "up") { this.total = this.left = this.n("seconds"); this.elapsed = 0; } this.paint(); }
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
        this.innerHTML = o.map((t, i) => `<button type="button" class="opt" data-i="${i}" style="--i:${i}"><span class="mk">${multi ? "" : String.fromCharCode(65 + i)}</span><span class="tx">${esc(t)}</span></button>`).join("");
        this.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { if (this.hasAttribute("reveal") && this.getAttribute("reveal") !== "false" && this.hasAttribute("lock")) return; const i = +b.dataset.i; this._sel = multi ? (this._sel.includes(i) ? this._sel.filter((x) => x !== i) : [...this._sel, i]) : [i]; this.paint(); change(this); }));
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
      this.toggleAttribute("answered", this._sel.length > 0);
    }
    get value() { const o = this.opts(); return this.hasAttribute("multi") ? this._sel.map((i) => o[i]) : this._sel.length ? o[this._sel[0]] : null; }
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
      load("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"); load("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js").then(() => {
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
