/* Blocks runtime v2 — core engine.
 *
 * A Blocks document is extended HTML + reactive bindings + relational styles + JS/Python logic:
 *   <style type="rel"> relations only (size/orient/group/place/...) — write it first
 *   <script type="data" name="qs">[...json...]</script> — data, available as `qs`
 *   markup: native HTML + x-* elements; {{expr}} text, :attr="expr", show="expr", each="q in qs",
 *           @click="statements", on="click:fnName" (JS or Python function)
 *   <script> JS </script>  <script type="python"> Python (Pyodide) </script>
 *
 * Streams: the host posts the growing source; complete elements mount once and animate in,
 * the element being written shows a shape-matched placeholder, nothing re-renders or jumps.
 * Standalone: include runtime.css, runtime.js, elements.js and call Blocks.render(source).
 */
(function () {
  "use strict";
  const B = (window.Blocks = window.Blocks || {});
  const NS = "http://www.w3.org/2000/svg";
  const FRAME = window.name || "blk";
  const ORIGIN = window.BLOCKS_ORIGIN || (location.origin !== "null" ? location.origin : "");

  // ---------------------------------------------------------------- utils
  const num = (v, d = 0) => (v === null || v === undefined || v === "" || isNaN(+v) ? d : +v);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const svg = (tag, attrs = {}, parentEl) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parentEl) parentEl.appendChild(e); return e; };
  // bundled libs are served by the app (/vendor/<lib>/…, offline); the CDN is only a fallback
  const CDN = {
    katex: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/", mermaid: "https://cdn.jsdelivr.net/npm/mermaid@11/dist/", smiles: "https://unpkg.com/smiles-drawer@2.0.1/dist/",
    "3dmol": "https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/", leaflet: "https://unpkg.com/leaflet@1.9.4/dist/", lucide: "https://unpkg.com/lucide-static@0.469.0/icons/",
    marked: "https://cdn.jsdelivr.net/npm/marked@14/lib/", hljs: "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.10.0/", tikzjax: "https://cdn.jsdelivr.net/npm/node-tikzjax@1.0.5/css/",
  };
  B.vendor = (lib, file) => `${ORIGIN}/vendor/${lib}/${file}`;
  B.libImport = (lib, file) => import(B.vendor(lib, file)).catch(() => import(CDN[lib] + file));
  B.libFetch = (lib, file) => fetch(B.vendor(lib, file)).then((r) => { if (!r.ok) throw 0; return r; }).catch(() => fetch(CDN[lib] + file));
  const loadLib = (lib, file) => load(`${ORIGIN}/vendor/${lib}/${file}`).catch(() => load(CDN[lib] + file));
  let katexCore = null;
  B.katex = () => (katexCore ||= Promise.all([loadLib("katex", "katex.min.css"), loadLib("katex", "katex.min.js")]));
  B.loadLib = loadLib;
  // failed optional loads (offline CDN) must not surface as uncaught errors
  addEventListener("unhandledrejection", (e) => { if (e.reason instanceof Event || /load|fetch/i.test(String(e.reason && e.reason.message))) e.preventDefault(); });
  const loaded = {};
  const load = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => {
    if (src.endsWith(".css")) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = src; document.head.appendChild(l); res(); return; }
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  }));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fileUrl = (p) => (/^(https?:|data:|blob:|\/\/)/.test(p) ? p : `${ORIGIN}/files/${String(p).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`);
  const fmt = (s) => { s = Math.max(0, Math.round(num(s))); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(x).padStart(2, "0"); };
  const PAL = () => [css("--accent"), "#6f8a9c", "#8f7aa8", "#7c9a6d", "#c29a4a", "#b0707a", css("--fg")];
  Object.assign(B, { num, css, svg, load, esc, fileUrl, fmt, PAL, NS, ORIGIN });

  // ---------------------------------------------------------------- host bridge
  const post = (type, data) => { try { parent.postMessage({ src: "blocks", frame: FRAME, type, ...data }, "*"); } catch {} };
  let reqId = 0; const pending = {};
  const call = (type, data) => new Promise((res) => { const id = ++reqId; pending[id] = res; post(type, { id, ...data }); });
  const standalone = window.parent === window;

  // ---------------------------------------------------------------- reactive store
  const store = {};
  let root = null;
  const dataVars = {};
  const inputOf = (k) => (root ? root.querySelectorAll(`[name="${CSS.escape(k)}"]`) : []);
  function readInput(k) {
    const els = [...inputOf(k)]; if (!els.length) return undefined;
    const e = els[0];
    if (e.type === "radio") { const c = els.find((x) => x.checked); return c ? c.value : null; }
    if (e.type === "checkbox") return els.length > 1 ? els.filter((x) => x.checked).map((x) => x.value) : e.checked;
    if (e.type === "range" || e.type === "number") return e.value === "" ? null : +e.value;
    return e.value;
  }
  function writeInput(k, v) {
    for (const e of inputOf(k)) {
      if (e.type === "radio") e.checked = String(e.value) === String(v);
      else if (e.type === "checkbox") e.checked = Array.isArray(v) ? v.includes(e.value) : !!v;
      else if ("value" in e) e.value = v;
    }
    if (inputOf(k)[0]) inputOf(k).forEach((e) => e.dispatchEvent(new Event("input", { bubbles: true })));
  }
  // state keys are mirrored as window accessors so plain <script> code (`score = 3`) and bindings share one store
  function expose(k) {
    if (typeof k !== "string" || !/^[A-Za-z_$][\w$]*$/.test(k)) return;
    const d = Object.getOwnPropertyDescriptor(window, k);
    if (d && !d.configurable) return;
    if (d && !d.get && k in window && !(d.value === undefined)) return; // real global already exists
    Object.defineProperty(window, k, { configurable: true, get: () => store[k], set: (v) => { store[k] = v; schedule(); } });
  }
  const setStore = (k, v) => { store[k] = v; expose(k); schedule(); };
  const S = new Proxy(store, {
    get: (t, k) => (k in t ? t[k] : typeof k === "string" && inputOf(k).length ? readInput(k) : dataVars[k]),
    set: (t, k, v) => { if (typeof k === "string" && !(k in t) && inputOf(k).length) writeInput(k, v); else setStore(k, v); return true; },
  });

  // ---------------------------------------------------------------- expression helpers
  const shuffle = (a) => { a = [...(a || [])]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const H = {
    fmt, num, shuffle,
    sum: (a) => (a || []).reduce((x, y) => x + num(y), 0),
    avg: (a) => (a && a.length ? H.sum(a) / a.length : 0),
    count: (a, f) => (a || []).filter(f || Boolean).length,
    pct: (a, b) => (b ? Math.round((a / b) * 100) : 0),
    round: (x, d = 0) => { const p = 10 ** d; return Math.round(num(x) * p) / p; },
    clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    range: (n, m) => (m === undefined ? Array.from({ length: Math.max(0, n) }, (_, i) => i) : Array.from({ length: Math.max(0, m - n) }, (_, i) => n + i)),
    pick: (a) => (a || [])[Math.floor(Math.random() * (a || []).length)],
    len: (a) => (a ? a.length : 0),
    now: () => Date.now(),
    json: (x) => JSON.stringify(x),
    date: (t) => new Date(t ?? Date.now()).toLocaleDateString(),
    time: (t) => new Date(t ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
  for (const k of Object.getOwnPropertyNames(Math)) if (!(k in H)) H[k] = Math[k];

  // what people see: never "[object Object]", "undefined", "NaN" or raw JSON
  const show = (v) => {
    if (v === undefined || v === null || (typeof v === "number" && isNaN(v)) || typeof v === "function") return "";
    if (Array.isArray(v)) return v.map(show).filter((x) => x !== "").join(", ");
    if (typeof Element !== "undefined" && v instanceof Element) return "value" in v ? show(v.value) : v.textContent;
    if (typeof v === "object") {
      for (const k of ["label", "name", "title", "text", "value"]) if (k in v && typeof v[k] !== "object") return show(v[k]);
      return Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(" · ");
    }
    return String(v);
  };
  B.show = show;
  H.show = show;

  const byId = (k) => { try { return root ? root.querySelector("#" + CSS.escape(k)) : null; } catch { return null; } };
  const refs = new Proxy({}, { get: (_, k) => (root && typeof k === "string" ? root.querySelector(`[x-ref="${CSS.escape(k)}"],[ref="${CSS.escape(k)}"],#${CSS.escape(k)}`) : undefined) });
  const MAGIC = { $refs: refs, $nextTick: (f) => new Promise((r) => requestAnimationFrame(() => r(f && f()))), $dispatch: null, $store: null };
  // names read while evaluating bindings that exist nowhere: reported by the self-check (typos, missing state)
  const missing = new Set(); let recording = false;
  const known = (k, locals) => (locals && k in locals) || k in store || k in dataVars || k in H || k in window || !!inputOf(k).length || !!byId(k);
  function scope(locals) {
    return new Proxy(Object.create(null), {
      has(_, k) {
        if (typeof k !== "string") return false;
        if ((locals && k in locals) || k in store || k in dataVars || k in H || k in MAGIC || inputOf(k).length || byId(k)) return true;
        return !(k in window);
      },
      get(_, k) {
        if (k === Symbol.unscopables) return undefined;
        if (locals && k in locals) return locals[k];
        if (k in store) return store[k];
        if (inputOf(k).length) return readInput(k);
        if (k in dataVars) return dataVars[k];
        if (k in H) return H[k];
        if (k in MAGIC) return k === "$store" ? S : k === "$dispatch" ? (n, d) => root.dispatchEvent(new CustomEvent(n, { detail: d, bubbles: true })) : MAGIC[k];
        const r = byId(k) || window[k];
        if (r === undefined && recording && typeof k === "string" && !(k in window)) missing.add(k);
        return r;
      },
      set(_, k, v) {
        if (locals && k in locals) locals[k] = v;
        else if (!(k in store) && inputOf(k).length) writeInput(k, v);
        else { store[k] = v; expose(k); }
        schedule(); return true;
      },
    });
  }
  const cache = new Map();
  function compile(src, stmt) {
    const key = (stmt ? "s:" : "e:") + src;
    let f = cache.get(key);
    if (!f) {
      try { f = stmt ? new Function("$s", "$event", "el", `with($s){return (async()=>{${src}\n})()}`) : new Function("$s", `with($s){return (${src}\n)}`); }
      catch (e) { f = () => { throw e; }; }
      cache.set(key, f);
    }
    return f;
  }
  const evaluate = (expr, locals) => { recording = true; try { return compile(expr, false)(scope(locals)); } catch (e) { return undefined; } finally { recording = false; } };
  // an async action (AI call, fetch, python) shows a spinner in its button until it settles
  const busyWhile = (el, r) => {
    const p = Promise.resolve(r);
    const btn = el && el.closest && el.closest("button");
    if (btn && r && typeof r.then === "function") { btn.classList.add("busy"); btn.setAttribute("aria-busy", "true"); p.finally(() => { btn.classList.remove("busy"); btn.removeAttribute("aria-busy"); }).catch(() => {}); }
    return p;
  };
  const runStmt = (code, locals, event, el) => {
    try {
      const r = compile(code, true)(scope(Object.assign(Object.create(locals || null), { event, $event: event, el, $el: el })), event, el);
      return busyWhile(el, r).catch(reportErr).finally(schedule);
    }
    catch (e) { reportErr(e); }
  };
  // `clicks++` / `total += x` / `items.push(…)` on a name nobody declared starts from 0 / [] instead of NaN / TypeError
  function autoInit(code, locals) {
    const declared = (k) => new RegExp(`\\b(?:let|const|var|function)\\s+${k.replace(/\$/g, "\\$")}\\b|(?:=>|\\bfor\\s*\\()[^;]*\\b${k.replace(/\$/g, "\\$")}\\b\\s*(?:=[^=]|of|in)`).test(code);
    const init = (k, v) => { if (!/^[A-Za-z_$][\w$]*$/.test(k) || known(k, locals) || k in MAGIC || declared(k)) return; setStore(k, v); };
    for (const m of code.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*(?:\+\+|--|[-+*/%]=)|(?:\+\+|--)\s*([A-Za-z_$][\w$]*)/g)) init(m[1] || m[2], 0);
    for (const m of code.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\.(?:push|unshift|splice)\(/g)) init(m[1], []);
  }
  const interp = (tpl, locals) => tpl.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => show(evaluate(e, locals)));
  const errs = [];
  function reportErr(e) { const t = String(e && e.message ? e.message : e).slice(0, 200); if (!errs.includes(t)) errs.push(t); post("error", { text: t }); if (standalone) console.warn("[blocks]", e); }

  // ---------------------------------------------------------------- bindings
  const rootBindings = [];
  const PROPS = new Set(["value", "checked", "disabled", "selected", "open"]);
  // Alpine / Vue spellings models reach for are accepted as-is (they know those libraries by heart):
  // x-data x-init x-text x-html x-show x-if x-else(-if) x-for x-model x-bind: x-on: x-ref, v-* equivalents, @ev.mods
  const ALIAS = { "x-text": ":text", "v-text": ":text", "x-html": ":html", "v-html": ":html", "x-show": "show", "v-show": "show" };
  const KEYS = { enter: "Enter", escape: "Escape", esc: "Escape", space: " ", tab: "Tab", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", delete: "Delete", backspace: "Backspace" };
  const SOFT = new Set(["value", "max", "min", "seconds", "data", "total"]); // numeric/data attrs on x-* that may name state without ':'
  const IDENT = /^[A-Za-z_$][\w$]*(?:\.[\w$]+|\[\d+\])*$/;
  let lastChain = null;
  function initData(el, locals) {
    if (el.__data || !el.hasAttribute || !el.hasAttribute("x-data")) return;
    el.__data = true;
    const src = el.getAttribute("x-data"); el.removeAttribute("x-data");
    if (!src || !src.trim()) return;
    let obj; try { obj = compile(src, false)(scope(locals)); } catch (e) { reportErr(e); return; }
    if (!obj || typeof obj !== "object") return;
    let initFn = null;
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
      if (d.get) { Object.defineProperty(store, k, { configurable: true, enumerable: true, get: () => d.get.call(S), set: d.set ? (v) => { d.set.call(S, v); schedule(); } : undefined }); expose(k); }
      else if (typeof d.value === "function") { const f = d.value.bind(S); if (k === "init") initFn = f; else { store[k] = f; expose(k); } }
      else if (!(k in store)) setStore(k, d.value);
    }
    if (initFn) queueMicrotask(() => { try { Promise.resolve(initFn()).catch(reportErr).finally(schedule); } catch (e) { reportErr(e); } });
  }
  function bindModel(el, expr, locals, mods, list) {
    const custom = el.tagName.includes("-"), t = el.type; el.__model = true;
    const isNum = mods.includes("number") || t === "number" || t === "range";
    const read = () => {
      if (custom) return el.value;
      if (t === "checkbox") { const cur = evaluate(expr, locals); if (Array.isArray(cur)) return el.checked ? [...new Set([...cur, el.value])] : cur.filter((x) => x !== el.value); return el.checked; }
      if (el.tagName === "SELECT" && el.multiple) return [...el.selectedOptions].map((o) => o.value);
      return isNum ? (el.value === "" ? null : +el.value) : mods.includes("trim") ? el.value.trim() : el.value;
    };
    const write = (v) => runStmt(`${expr} = $v`, Object.assign(Object.create(locals || null), { $v: v }));
    const ev = mods.includes("lazy") || t === "checkbox" || t === "radio" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(ev, () => { if (t === "radio" && !el.checked) return; write(read()); });
    if (custom && ev === "input") el.addEventListener("change", () => write(read()));
    if (!el.getAttribute("name") && /^[\w$]+$/.test(expr) && t !== "radio") el.setAttribute("name", expr);
    if (evaluate(expr, locals) === undefined && /^[\w$]+$/.test(expr)) { const v0 = t === "radio" ? (el.checked ? el.value : undefined) : read(); if (v0 !== undefined) setStore(expr, v0); }
    list.push({ type: "model", el, expr, locals });
  }
  function listen(el, spec, code, locals) {
    const [ev, ...mods] = spec.split(".");
    if (/\bthis\b/.test(code)) code = code.replace(/\bthis\b/g, "el");
    autoInit(code, locals);
    const target = mods.includes("window") ? window : mods.includes("document") ? document : el;
    const key = mods.map((m) => KEYS[m] || (m.length === 1 ? m : null)).find(Boolean);
    const h = (e) => {
      if (mods.includes("self") && e.target !== el) return;
      if (mods.includes("outside") && el.contains(e.target)) return;
      if (key && e.key !== key) return;
      if (mods.includes("prevent") || ev === "submit") e.preventDefault();
      if (mods.includes("stop")) e.stopPropagation();
      runStmt(code, locals, e, el);
    };
    (mods.includes("outside") ? document : target).addEventListener(ev, h, { once: mods.includes("once") });
  }
  function bindEl(el, list, locals) {
    if (el.__bound) return; el.__bound = true;
    if (el.nodeType !== 1) return;
    initData(el, locals);
    // <template x-for / x-if>: the template's content stands in for it
    if (el.tagName === "TEMPLATE") {
      const dir = ["x-for", "v-for", "each", "x-if", "v-if"].find((d) => el.hasAttribute(d));
      if (!dir) return;
      const kids = [...el.content.children];
      let inner = kids.length === 1 ? kids[0] : document.createElement("div");
      if (kids.length !== 1) { inner.style.display = "contents"; kids.forEach((k) => inner.appendChild(k)); }
      inner = document.importNode(inner, true);
      for (const a of [...el.attributes]) if (a.name !== "key" && a.name !== ":key") inner.setAttribute(a.name, a.value);
      if (el.parentNode) el.replaceWith(inner);
      el = inner; el.__bound = true;
    }
    for (const d of ["x-for", "v-for"]) if (el.hasAttribute(d)) { el.setAttribute("each", el.getAttribute(d)); el.removeAttribute(d); }
    el.removeAttribute(":key"); el.removeAttribute("x-cloak"); el.removeAttribute("v-cloak");
    // each: turn element into a repeated template
    if (el.hasAttribute("each")) {
      const m = el.getAttribute("each").match(/^\s*\(?\s*([\w$]+)\s*(?:,\s*([\w$]+))?\s*\)?\s+(?:in|of)\s+([\s\S]+)$/);
      const anchor = document.createComment("each");
      el.parentNode.insertBefore(anchor, el);
      el.remove(); el.removeAttribute("each"); el.__bound = false;
      if (m) list.push({ type: "each", anchor, tpl: el, item: m[1], idx: m[2] || "i", expr: m[3], clones: [], locals });
      return;
    }
    const comp = el.tagName.startsWith("X-");
    if (!("__cls0" in el)) el.__cls0 = el.getAttribute("class") || "";
    for (const a of [...el.attributes]) {
      let n = a.name; const v = a.value;
      if (n in ALIAS) { el.removeAttribute(n); n = ALIAS[n]; }
      else if (/^(x|v)-bind:/.test(n)) { el.removeAttribute(n); n = ":" + n.split(":").slice(1).join(":"); }
      else if (/^(x-on:|v-on:)/.test(n)) { el.removeAttribute(n); n = "@" + n.replace(/^(x-on:|v-on:)/, ""); }
      if (n === "x-if" || n === "v-if") { el.removeAttribute(n); lastChain = [v]; list.push({ type: "show", el, expr: v, locals }); }
      else if (n === "x-else-if" || n === "v-else-if") { el.removeAttribute(n); const prev = lastChain || []; list.push({ type: "show", el, expr: prev.map((c) => `!(${c})`).concat(`(${v})`).join("&&"), locals }); lastChain = [...prev, v]; }
      else if (n === "x-else" || n === "v-else") { el.removeAttribute(n); const prev = lastChain || []; list.push({ type: "show", el, expr: prev.length ? prev.map((c) => `!(${c})`).join("&&") : "true", locals }); lastChain = null; }
      else if (/^(x|v)-model/.test(n)) { el.removeAttribute(n); bindModel(el, v.trim(), locals, n.split(".").slice(1), list); }
      else if (n === "x-init") { el.removeAttribute(n); autoInit(v, locals); queueMicrotask(() => runStmt(v, locals, null, el)); }
      else if (n === "x-ref" || n === "x-data") { /* kept for $refs lookup / handled above */ }
      else if (n[0] === ":") { list.push({ type: "attr", el, attr: n.slice(1), expr: v, locals }); if (a.name === n) el.removeAttribute(n); }
      else if (n[0] === "@") { if (a.name === n) el.removeAttribute(n); listen(el, n.slice(1), v, locals); }
      else if (/^on[a-z]+$/.test(n) && v.trim()) { el.removeAttribute(n); listen(el, n.slice(2), v, locals); } // inline handlers see Blocks state too
      else if (n === "show") list.push({ type: "show", el, expr: v, locals });
      else if (v.includes("{{")) list.push({ type: "tpl", el, attr: n, tpl: v, locals });
      else if (comp && SOFT.has(n) && IDENT.test(v.trim()) && !/^(true|false|null|auto|none|up|down)$/.test(v.trim())) list.push({ type: "attr", el, attr: n, expr: v.trim(), soft: v, locals });
    }
    if (el.hasAttribute("on")) bindOn(el, locals);
    // children (skip component-owned content)
    if (el.__owns) return;
    for (const c of [...el.childNodes]) {
      if (c.nodeType === 3) { if (!c.__bound && c.textContent.includes("{{")) (c.__bound = true), list.push({ type: "text", node: c, tpl: c.textContent, locals }); }
      else if (c.nodeType === 1 && c.tagName !== "SCRIPT" && c.tagName !== "STYLE") bindEl(c, list, locals);
    }
  }
  function applyBinding(b) {
    try {
      if (b.type === "text") {
        const v = interp(b.tpl, b.locals);
        if (b.v === v) return; b.v = v;
        // math renders by replacing text nodes, so math-bearing bindings own a span and re-typeset it on change
        if (b.h || /\$|\\\(|\\\[/.test(v)) {
          if (!b.h) { b.h = document.createElement("span"); b.h.className = "bt"; if (b.node.parentNode) b.node.replaceWith(b.h); }
          b.h.textContent = v; typeset(b.h);
        } else if (b.node.textContent !== v) b.node.textContent = v;
      }
      else if (b.type === "tpl") { const v = interp(b.tpl, b.locals); if (b.el.getAttribute(b.attr) !== v) b.el.setAttribute(b.attr, v); }
      else if (b.type === "show") { const v = !!evaluate(b.expr, b.locals); if (b.el.hidden === v) b.el.hidden = !v; }
      else if (b.type === "model") {
        if (document.activeElement === b.el && b.el.tagName !== "SELECT") return;
        const v = evaluate(b.expr, b.locals), el = b.el;
        if (el.tagName.includes("-")) { if (v !== undefined && JSON.stringify(el.value) !== JSON.stringify(v)) el.value = v; }
        else if (el.type === "checkbox") el.checked = Array.isArray(v) ? v.includes(el.value) : !!v;
        else if (el.type === "radio") el.checked = String(v) === el.value;
        else if (el.value !== String(v ?? "")) el.value = v ?? "";
      }
      else if (b.type === "attr") {
        let v = evaluate(b.expr, b.locals); const a = b.attr;
        if (b.soft !== undefined && (v === undefined || typeof v === "function" || v instanceof Element)) v = b.soft;
        if (a === "text") {
          const s = show(v);
          if (b.el.__owns) { if (b.el._src !== s) { b.el._src = s; b.el.refresh && b.el.refresh(true); } } // owners re-render from source
          else if (b.el.textContent !== s) b.el.textContent = s;
        }
        else if (a === "html") { const s = v == null ? "" : String(v); if (b.v !== s) { b.v = s; b.el.innerHTML = s; typeset(b.el); } }
        else if (a === "class") {
          const dyn = Array.isArray(v) ? v.filter(Boolean).join(" ") : v && typeof v === "object" ? Object.keys(v).filter((k) => v[k]).join(" ") : v ?? "";
          const c = [b.el.__cls0, dyn].filter(Boolean).join(" ").trim(); if (b.el.getAttribute("class") !== c) b.el.setAttribute("class", c);
        }
        else if (a === "style" && v && typeof v === "object") { for (const k in v) b.el.style.setProperty(k.startsWith("--") ? k : k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), v[k] == null ? "" : String(v[k])); }
        else if (PROPS.has(a) && a in b.el) { if (a === "value" && document.activeElement === b.el) return; if (b.el[a] !== v) b.el[a] = a === "value" ? (v ?? "") : !!v; }
        else if (v === false || v === null || v === undefined) b.el.removeAttribute(a);
        else { const s = v === true ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); if (b.el.getAttribute(a) !== s) b.el.setAttribute(a, s); }
      } else if (b.type === "each") renderEach(b);
    } catch (e) { reportErr(e); }
  }
  function renderEach(b) {
    let list = evaluate(b.expr, b.locals);
    if (typeof list === "number") list = H.range(list);
    if (!list || typeof list !== "object") list = [];
    const arr = Array.isArray(list) ? list : Object.entries(list).map(([k, v]) => ({ key: k, value: v }));
    let after = b.anchor;
    arr.forEach((item, i) => {
      let c = b.clones[i];
      if (!c) {
        const node = b.tpl.cloneNode(true);
        const locals = Object.assign(Object.create(b.locals || null), { [b.item]: item, [b.idx]: i });
        c = b.clones[i] = { node, locals, list: [] };
        bindEl(node, c.list, locals); c.list.forEach(applyBinding); // bind while detached: components init with final attrs
        after.parentNode.insertBefore(node, after.nextSibling);
        enter(node, i); typeset(node);
      } else { c.locals[b.item] = item; c.locals[b.idx] = i; c.list.forEach(applyBinding); }
      after = c.node;
    });
    b.clones.splice(arr.length).forEach((c) => c.node.remove());
  }
  let queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); }
  function toInputs() {
    for (const k in store) {
      const els = [...inputOf(k)].filter((e) => !e.__model && e !== document.activeElement); if (!els.length) continue;
      const v = store[k], e0 = els[0]; if (typeof v === "function") continue;
      if (JSON.stringify(readInput(k)) === JSON.stringify(v)) continue;
      for (const e of els) {
        if (e.type === "radio") e.checked = String(e.value) === String(v);
        else if (e.type === "checkbox") e.checked = Array.isArray(v) ? v.includes(e.value) : !!v;
        else if ("value" in e) try { e.value = v; } catch {}
      }
      void e0;
    }
  }
  function render() {
    toInputs();
    rootBindings.forEach(applyBinding);
    if (root) root.querySelectorAll("[data-reactive]").forEach((el) => el.refresh && el.refresh());
  }

  // on="click:start change:recalc" -> python def or JS function
  let pyCall = null;
  function bindOn(el, locals) {
    el.getAttribute("on").split(/\s+/).forEach((pair) => {
      const [ev, fn] = pair.split(":"); if (!fn) return;
      el.addEventListener(ev, (e) => {
        if (pyCall && pyCall(fn, e)) return schedule();
        const f = window[fn];
        if (typeof f === "function") { try { busyWhile(el, f(e, el, locals)).catch(reportErr).finally(schedule); } catch (err) { reportErr(err); } }
        else if (!pyReady) pendingOn.push([fn, e]);
      });
    });
  }
  const pendingOn = []; let pyReady = true;

  // ---------------------------------------------------------------- math typesetting ($..$, $$..$$ anywhere)
  let katexP = null;
  function typeset(el) {
    if (!el || !/\$[^$]+\$|\\\(|\\\[/.test(el.textContent || "")) return;
    katexP ||= B.katex().then(() => loadLib("katex", "contrib/auto-render.min.js"));
    katexP.then(() => window.renderMathInElement && window.renderMathInElement(el, {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }],
      throwOnError: false, ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "x-math", "x-graph", "x-plot", "x-code", "input"],
    })).catch(() => {});
  }
  B.typeset = typeset;

  // ---------------------------------------------------------------- relational style language
  function parseRel(src) {
    const rules = []; let i = 0; src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    function block(scope, mode) {
      while (i < src.length) {
        const close = src.indexOf("}", i), open = src.indexOf("{", i);
        if (close !== -1 && (open === -1 || close < open)) { addProps(scope, mode, src.slice(i, close)); i = close + 1; return; }
        if (open === -1) return;
        const pre = src.slice(i, open);
        const cut = Math.max(pre.lastIndexOf(";"), pre.lastIndexOf("\n"));
        if (cut > -1) addProps(scope, mode, pre.slice(0, cut));
        const sel = pre.slice(cut + 1).trim(); i = open + 1;
        if (sel === "portrait" || sel === "landscape") block(scope, sel);
        else block(sel.split(",").map((x) => x.trim()).filter(Boolean).flatMap((s) => (scope.length ? scope.map((p) => p + " " + s) : [s])), mode);
      }
    }
    function addProps(scope, mode, body) {
      const props = {};
      body.split(/[;\n]/).forEach((l) => { const m = l.match(/^\s*([\w-]+)\s*[:=]\s*(.+?)\s*$/); if (m) props[m[1]] = m[2].replace(/["']/g, ""); });
      if (Object.keys(props).length && scope.length) rules.push({ sels: scope, mode, props });
    }
    block([], "all"); return rules;
  }
  const scopeSel = (s) => s.split(/\s+/).map((p) => (p === "root" || p === "background" || p === "page" ? "#root" : p)).join(" ").replace(/^(?!#root)/, "#root ").replace(/#root #root/g, "#root");
  const SIZE = { xs: 0.5, s: 0.75, sm: 0.75, m: 1, md: 1, l: 1.5, lg: 1.5, xl: 2, xxl: 3 };
  function compileRel(rules) {
    let out = ""; const groups = [], asides = [];
    for (const r of rules) {
      const pre = r.mode === "all" ? "" : `body[data-o=${r.mode}] `;
      const sel = r.sels.map((s) => pre + scopeSel(s)).join(","); const p = r.props; let d = "";
      if (p.size) { const n = SIZE[p.size] ?? (parseFloat(p.size) || 1); d += `--s:${(0.55 + n * 0.45).toFixed(2)};--g:${n};flex-grow:${n};font-size:${(0.8 + n * 0.2).toFixed(2)}em;`; }
      if (p.orient === "horizontal") d += "--dir:row;flex-direction:row;flex-wrap:wrap;align-items:center;";
      if (p.orient === "vertical") d += "--dir:column;flex-direction:column;align-items:stretch;";
      if (p.place === "top") d += "order:-2;"; if (p.place === "bottom") d += "order:99;"; if (p.place === "center") d += "align-self:center;margin-inline:auto;text-align:center;";
      if (p.emphasis === "low") d += "opacity:.62;"; if (p.emphasis === "high") d += "font-weight:600;";
      if (p.tone) d += `--tone:var(--${p.tone === "neutral" ? "muted" : p.tone});`;
      if (p.gap) d += `--gap:${{ none: "0px", tight: "8px", normal: "14px", loose: "24px" }[p.gap] || "14px"};gap:var(--gap);`;
      if (p.width === "fill") d += "flex:1 1 auto;width:100%;align-self:stretch;"; if (p.width === "hug") d += "flex:0 0 auto;width:auto;align-self:flex-start;";
      if (p.max) d += `max-width:${{ narrow: "420px", medium: "680px", wide: "960px", full: "none" }[p.max] || "none"};margin-inline:auto;width:100%;`;
      if (p.align) d += `align-self:${p.align === "start" ? "flex-start" : p.align === "end" ? "flex-end" : "center"};text-align:${p.align};`;
      if (p.columns) d += `display:grid;grid-template-columns:repeat(${p.columns === "auto" ? "auto-fit" : parseInt(p.columns) || 2},minmax(${p.columns === "auto" ? "180px" : "0"},1fr));`;
      if (p.span) d += `grid-column:span ${parseInt(p.span) || 1};`;
      if (p.sticky === "top") d += "position:sticky;top:0;z-index:5;background:var(--page-bg,var(--bg));padding-block:6px;";
      if (p.sticky === "bottom") d += "position:sticky;bottom:0;z-index:5;background:var(--page-bg,var(--bg));padding-block:6px;";
      if (p.hide === "true" || p.hide === "yes") d += "display:none!important;";
      if (p.density === "compact") d += "--gap:8px;--pad:10px;font-size:.94em;"; if (p.density === "comfortable") d += "--gap:22px;--pad:20px;";
      if (p.ratio) d += `aspect-ratio:${{ square: "1", wide: "16/9", tall: "3/4" }[p.ratio] || p.ratio};`;
      if (d) out += `${sel}{${d}}\n`;
      if (p.group && r.mode === "all") r.sels.forEach((s) => groups.push({ sel: scopeSel(s), name: p.group.replace(/[^\w-]/g, "") }));
      if (p.place === "start" || p.place === "end") r.sels.forEach((s) => asides.push({ sel: scopeSel(s), side: p.place, mode: r.mode }));
    }
    return { css: out, groups, asides };
  }
  let REL = { css: "", groups: [], asides: [] }; let relSrc = null; let relStyle = null;
  function applyRel(src) {
    if (src === relSrc) return; relSrc = src;
    REL = compileRel(parseRel(src));
    if (!relStyle) { relStyle = document.createElement("style"); document.head.appendChild(relStyle); }
    relStyle.textContent = REL.css;
    if (root) { root.querySelectorAll(":scope > *").forEach(placeUnit); orient(); }
  }
  // groups: siblings sharing `group: name` are wrapped into one row; asides via CSS grid (stream-stable)
  function placeUnit(unit) {
    if (!unit || unit.nodeType !== 1 || !unit.parentElement) return;
    for (const a of REL.asides) if (unit.matches(a.sel) || unit.querySelector(a.sel)) { const top = topLevel(unit); if (top) { top.classList.add("is-aside"); root.classList.add("as-" + a.mode, a.side === "end" ? "as-end" : "as-start"); const g = parseFloat(getComputedStyle(top).getPropertyValue("--g")) || 1; root.style.setProperty("--aside-w", Math.max(0.62, g * 0.55).toFixed(2) + "fr"); } }
    for (const g of REL.groups) {
      let hits;
      try { hits = unit.matches(g.sel) ? [unit] : [...unit.querySelectorAll(g.sel)]; } catch { continue; }
      for (const h of hits) {
        const u = h.parentElement && h.parentElement.tagName === "LABEL" && h !== unit ? h.parentElement : h;
        const parentEl = u.parentElement;
        if (!parentEl || parentEl.classList.contains("grp")) continue;
        let w = [...parentEl.children].find((c) => c.classList && c.classList.contains("grp") && c.dataset.g === g.name);
        if (!w) { w = document.createElement("div"); w.className = "grp"; w.dataset.g = g.name; parentEl.insertBefore(w, u); }
        w.appendChild(u); w.classList.toggle("wrap", w.children.length > 2);
      }
    }
  }
  const topLevel = (el) => { while (el && el.parentElement && el.parentElement !== root) el = el.parentElement; return el && el.parentElement === root ? el : null; };
  function orient() {
    const fill = document.body.classList.contains("fill");
    document.body.dataset.o = fill ? (innerWidth >= innerHeight * 1.05 ? "landscape" : "portrait") : innerWidth > 560 ? "landscape" : "portrait";
  }
  addEventListener("resize", orient);

  // ---------------------------------------------------------------- source handling
  const ATTRS = `((?:\\s+[^\\s=>/"']+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?)*)`;
  const TAG_RE = new RegExp(`<(\\/?)([a-zA-Z][\\w-]*)${ATTRS}\\s*(\\/?)>`, "g");
  const HTML_VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
  const AUTO_CLOSE = new Set(["p", "li", "option", "tr", "td", "th", "dt", "dd"]);
  B.VOIDX = B.VOIDX || new Set();
  function split(src) {
    let rel = "", relOpen = false, js = "", py = "";
    const data = [];
    let html = src
      .replace(/<style\s+type=["']?rel["']?\s*>([\s\S]*?)(<\/style>|$)/gi, (_, c, end) => { if (end) rel += c + "\n"; else relOpen = true; return ""; })
      .replace(/<script\s+type=["']?(?:application\/)?(?:data|json)["']?\s+(?:name|id)=["']?([\w$-]+)["']?\s*>([\s\S]*?)(<\/script>|$)/gi, (_, n, c, end) => { if (end) data.push([n, c]); return ""; })
      .replace(/<script\s+type=["']?(?:text\/)?python["']?\s*>([\s\S]*?)(<\/script>|$)/gi, (_, c) => ((py += c + "\n"), ""))
      .replace(/<script(?:\s[^>]*)?>([\s\S]*?)(<\/script>|$)/gi, (_, c) => ((js += c + "\n"), ""))
      .replace(/<style[\s\S]*?(<\/style>|$)/gi, "");
    // trailing partial tag / comment while streaming
    html = html.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*$/, "").replace(/<!--(?![\s\S]*-->)[\s\S]*$/, "");
    // <x-foo/> and attribute-only components never need explicit closing
    html = html.replace(new RegExp(`<(x-[\\w-]+)${ATTRS}\\s*\\/>`, "g"), "<$1$2></$1>");
    html = html.replace(/<\/(x-[\w-]+)\s*>/g, (m, t) => (B.VOIDX.has(t) ? "" : m));
    html = html.replace(new RegExp(`<(x-[\\w-]+)${ATTRS}\\s*>`, "g"), (m, t) => (B.VOIDX.has(t) ? m + `</${t}>` : m));
    return { html, rel, relOpen, js, py, data };
  }
  function openStack(html) {
    const st = []; let m; TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(html))) {
      const t = m[2].toLowerCase();
      if (m[1]) { const i = st.lastIndexOf(t); if (i >= 0) st.length = i; }
      else if (!m[4] && !HTML_VOID.has(t) && !B.VOIDX.has(t)) { if (AUTO_CLOSE.has(t) && st[st.length - 1] === t) st.pop(); st.push(t); }
    }
    return st;
  }

  // ---------------------------------------------------------------- streaming mount
  const CONTAINERS = new Set(["div", "section", "article", "header", "footer", "main", "aside", "nav", "form", "ul", "ol", "details", "fieldset", "table", "thead", "tbody", "tr"]);
  const TEXTY = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "small", "span", "strong", "em", "b", "i", "a", "label", "blockquote", "td", "th", "summary", "button", "legend", "figcaption", "dt", "dd", "pre", "code"]);
  B.CONTAINERS = B.CONTAINERS || new Set(); // x-* containers register here (elements.js)
  const isContainer = (t) => CONTAINERS.has(t) || B.CONTAINERS.has(t);
  let seq = 0;
  function enter(el, i) {
    if (el.nodeType !== 1) return;
    el.classList.add("b-in");
    el.style.setProperty("--i", Math.min(i ?? seq++, 14));
    el.addEventListener("animationend", () => el.classList.remove("b-in"), { once: true });
  }
  function skeleton(tag) {
    const s = document.createElement("div");
    s.className = "b-skel"; s.dataset.k = B.skelKind ? B.skelKind(tag) : "block";
    return s;
  }
  const kids = (n) => [...n.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim()));
  /** Bind a finished node BEFORE it is connected (templates stay pristine, first paint has final values).
      Returns the node to insert (an anchor comment when the node itself repeats with each=). */
  function prepare(el) {
    const list = []; let node = el;
    if (el.nodeType === 1 && !el.parentNode && (el.tagName === "TEMPLATE" || ["each", "x-for", "v-for"].some((d) => el.hasAttribute(d)))) { const f = document.createDocumentFragment(); f.appendChild(el); bindEl(el, list, null); node = f.firstChild; }
    else bindEl(el, list, null);
    list.forEach((b) => b.type !== "each" && applyBinding(b));
    rootBindings.push(...list);
    return node;
  }
  function settle(el) { typeset(el); if (el.parentElement) placeUnit(el); }
  function sync(src, live, stack, depth, done) {
    live.__kids ||= [];
    const list = kids(src);
    const lastEl = src.lastElementChild;
    list.forEach((s, i) => {
      let l = live.__kids[i];
      if (s.nodeType === 3) {
        const t = s.textContent.replace(/\{\{[^}]*\}?\}?/g, (m) => (done ? m : ""));
        if (!l) { l = live.__kids[i] = document.createTextNode(t); live.appendChild(l); }
        else if (!l.__done && l.textContent !== t) l.textContent = t;
        if (done && !l.__done) { l.__done = l.__bound = true; if (t.includes("{{")) rootBindings.push({ type: "text", node: l, tpl: t, locals: null }); }
        return;
      }
      if (l && l.__done) return;
      const tag = s.tagName.toLowerCase();
      const open = !done && s === lastEl && depth < stack.length && tag === stack[depth];
      if (!open) {
        if (l && l.__shell) { sync(s, l, stack, depth + 1, true); l.__done = true; prepare(l); settle(l); return; }
        const full = document.importNode(s, true);
        const node = prepare(full);
        if (l) live.replaceChild(node, l); else live.appendChild(node);
        live.__kids[i] = node; node.__done = true;
        if (node === full) { if (!l || !l.__texty) enter(full); settle(full); }
        return;
      }
      if (s.tagName === "TEMPLATE" || ["each", "x-for", "v-for"].some((d) => s.hasAttribute(d))) { if (!l) { l = live.__kids[i] = skeleton("each"); live.appendChild(l); } return; }
      if (isContainer(tag)) {
        if (!l) { l = live.__kids[i] = document.importNode(s, false); l.__shell = true; initData(l, null); live.appendChild(l); enter(l); if (l.parentElement === root) placeUnit(l); }
        sync(s, l, stack, depth + 1, false);
      } else if (TEXTY.has(tag)) {
        if (!l) { l = live.__kids[i] = document.importNode(s, false); l.__texty = true; live.appendChild(l); enter(l); }
        l.innerHTML = s.innerHTML.replace(/\{\{[^}]*\}?\}?/g, "");
      } else if (!l) { l = live.__kids[i] = skeleton(tag); live.appendChild(l); enter(l); }
    });
  }

  // ---------------------------------------------------------------- logic
  let started = false;
  async function startLogic(js, py) {
    if (started) return; started = true;
    // top-level let/const become globals so {{ bindings }} and inline handlers can see them
    if (js.trim()) { try { (0, eval)(js.replace(/^(let|const)(\s+[\w${[])/gm, "var$2")); } catch (err) { showErr(err); } }
    setInterval(() => { if (!document.hidden) render(); }, 300); // state changed by plain JS timers still shows up
    setTimeout(selfCheck, 900);
    if (py.trim()) {
      pyReady = false;
      try { pyCall = await runPython(py); } catch (err) { showErr(err); }
      pyReady = true;
      pendingOn.splice(0).forEach(([fn, e]) => pyCall && pyCall(fn, e));
    }
    schedule();
  }
  // self-check: what a person would see as broken is reported to the host (and from there, to the model)
  function selfCheck() {
    const issues = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (n.parentElement && n.parentElement.closest("pre,code,x-code,x-md,x-tikz,textarea,script,style")) continue;
      if (/\{\{[\s\S]*?\}\}/.test(n.textContent)) issues.push(`unrendered binding: ${n.textContent.trim().slice(0, 60)}`);
      if (/\[object Object\]/.test(n.textContent)) issues.push(`object printed as text near: ${n.textContent.trim().slice(0, 60)}`);
    }
    const gone = [...missing].filter((k) => !known(k) && !(k in MAGIC));
    if (gone.length) issues.push(`undefined name${gone.length > 1 ? "s" : ""}: ${gone.slice(0, 8).join(", ")}`);
    root.querySelectorAll("x-graph,x-plot,x-chart").forEach((g) => { const d = [...g.querySelectorAll("path,rect,circle")].length; if (!d) issues.push(`${g.tagName.toLowerCase()} drew nothing (check fn/data syntax)`); });
    errs.forEach((e) => issues.push("error: " + e));
    if (issues.length) { post("issues", { issues: [...new Set(issues)].slice(0, 12) }); if (standalone) console.warn("[blocks] issues", issues); }
  }
  B.selfCheck = selfCheck;
  function showErr(err) { reportErr(err); root && root.insertAdjacentHTML("beforeend", `<div class="err">${esc(err)}</div>`); }
  async function runPython(code) {
    await load("https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js");
    const pyo = await window.loadPyodide();
    const imports = [...code.matchAll(/^\s*(?:import|from)\s+([\w]+)/gm)].map((m) => m[1]).filter((m) => ["numpy", "pandas", "scipy", "sympy", "matplotlib", "networkx", "scikit-learn", "sklearn"].includes(m));
    if (imports.length) await pyo.loadPackage(imports.map((m) => (m === "sklearn" ? "scikit-learn" : m))).catch(() => {});
    pyo.globals.set("_js", { el: (s) => document.querySelector(s), els: (s) => [...document.querySelectorAll(s)], form: () => pyo.toPy(form()), S, send_to_lm: (d) => sendToLm(d && d.toJs ? d.toJs({ dict_converter: Object.fromEntries }) : d), save_in: saveIn, notify, render: schedule, every: (ms, f) => setInterval(() => { f(); schedule(); }, ms), after: (ms, f) => setTimeout(() => { f(); schedule(); }, ms) });
    await pyo.runPythonAsync(`
from pyodide.ffi import create_proxy, to_js
el=_js.el; els=_js.els; notify=_js.notify; save_in=_js.save_in; S=_js.S; render=_js.render
def form(): return _js.form()
def send_to_lm(d): _js.send_to_lm(to_js(d, dict_converter=__import__('js').Object.fromEntries))
def every(ms, fn): return _js.every(ms, create_proxy(fn))
def after(ms, fn): return _js.after(ms, create_proxy(fn))
`);
    await pyo.runPythonAsync(code);
    return (name, e) => { const f = pyo.globals.get(name); if (!f || typeof f !== "function") return false; try { try { f(e); } catch (err) { if (/argument/.test(String(err))) f(); else throw err; } } catch (err) { notify(String(err).split("\n").slice(-2).join(" ").slice(0, 160)); } schedule(); return true; };
  }

  // ---------------------------------------------------------------- helpers exposed to model code
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const on = (sel, ev, fn) => { (typeof sel === "string" ? $$(sel) : [sel]).forEach((el) => el && el.addEventListener(ev, (e) => { const r = fn(e, el); schedule(); return r; })); };
  function form(scopeEl) {
    const o = {}; const r = scopeEl ? (typeof scopeEl === "string" ? $(scopeEl) : scopeEl) : root;
    (r || document).querySelectorAll("[name]").forEach((el) => { const n = el.getAttribute("name"); if (!(n in o)) o[n] = readInput(n); });
    return o;
  }
  const notify = (t) => { const d = document.createElement("div"); d.className = "toast"; d.textContent = String(t); document.body.appendChild(d); setTimeout(() => d.classList.add("out"), 1900); setTimeout(() => d.remove(), 2300); };
  // sendToLm(data, "Label" | { label, prompt }): posts a <ui_event> as the user's next turn. label = what the chat shows,
  // prompt = instruction for the model (e.g. "Grade these answers and explain each mistake").
  const sendToLm = (data, opts) => {
    const o = typeof opts === "string" ? { label: opts } : opts || {};
    const payload = { data: typeof data === "string" ? data : JSON.parse(JSON.stringify(data ?? {})), opts: { label: o.label ? String(o.label).slice(0, 80) : "", prompt: o.prompt ? String(o.prompt).slice(0, 2000) : "" } };
    post("lm", payload); if (!standalone) notify("Sent"); else console.log("[sendToLm]", payload);
  };
  // Declarative: <form lm="Submit answers" lm-prompt="Grade them"> sends form() on submit;
  // <button lm="Explain" lm-prompt="…"> outside a form sends the inputs of its nearest card/section.
  let lmBusy = 0;
  const lmSend = (el, scopeEl) => { if (Date.now() - lmBusy < 1200) return; lmBusy = Date.now(); sendToLm(form(scopeEl), { label: el.getAttribute("lm") || el.textContent.trim().slice(0, 60) || "Submitted", prompt: el.getAttribute("lm-prompt") || "" }); schedule(); };
  document.addEventListener("submit", (e) => { const f = e.target.closest && e.target.closest("form[lm]"); if (!f) return; e.preventDefault(); lmSend(f, f); }, true);
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("button[lm]"); if (!b || b.closest("form[lm]")) return; e.preventDefault(); const sc = b.closest("x-card,x-section,x-slide,x-tab,form,section") || root; const bad = [...sc.querySelectorAll("input,select,textarea")].find((i) => !i.checkValidity()); if (bad) { bad.reportValidity(); return; } lmSend(b, sc); }, true);
  const saveIn = (path, text) => (standalone ? Promise.resolve(false) : call("save", { path, text: typeof text === "string" ? text : JSON.stringify(text, null, 2) }));
  const py = (code) => (standalone ? Promise.resolve("(server python unavailable standalone)") : call("py", { code }));
  const bash = (command) => (standalone ? Promise.resolve("(server bash unavailable standalone)") : call("bash", { command }));
  const open = (target) => post("open", { target });
  const every = (ms, fn) => setInterval(() => { fn(); schedule(); }, ms);
  const after = (ms, fn) => setTimeout(() => { fn(); schedule(); }, ms);
  const state = (k, init) => { if (!(k in store)) store[k] = init; return { get: () => store[k], set: (v) => { store[k] = v; schedule(); } }; };
  const upload = (file, dir) => new Promise((res) => { const r = new FileReader(); r.onload = () => call("upload", { name: file.name, type: file.type, data: String(r.result).split(",")[1], dir }).then(res); r.readAsDataURL(file); });
  Object.assign(H, { sendToLm, saveIn, py, notify, form, every, after, open });
  Object.assign(window, { $, $$, on, form, sendToLm, saveIn, py, notify, state, every, after, open, S, render: schedule });
  Object.assign(B, { S, store, expose, setStore, scope, evaluate, runStmt, schedule, render, call, post, upload, standalone, H, py, bash, every, after, state });

  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "reply" && pending[m.id]) { pending[m.id](m.value); delete pending[m.id]; }
    else if (m.type === "theme") { for (const k in m.vars) document.documentElement.style.setProperty(k, m.vars[k]); document.body.dataset.theme = m.theme; root && root.querySelectorAll("[data-themed]").forEach((x) => x.refresh ? x.refresh(true) : x.render && x.render()); }
    else if (m.type === "source") feed(m.source, m.done);
  });
  window.addEventListener("error", (e) => reportErr(e.message));
  root = document.getElementById("root");
  // a named control and a state key with the same name are one value: the control writes it, code writes the control
  const fromInput = (e) => { const t = e.target, n = t && t.getAttribute && t.getAttribute("name"); if (n && n in store && !t.__model) { const v = readInput(n); if (JSON.stringify(store[n]) !== JSON.stringify(v)) store[n] = v; } schedule(); };
  root.addEventListener("input", fromInput); root.addEventListener("change", fromInput);
  document.addEventListener("tick", schedule);

  // ---------------------------------------------------------------- feed: the only entry point
  let finished = false;
  function feed(source, done) {
    if (finished) return;
    const p = split(source || "");
    if (p.rel) applyRel(p.rel);
    for (const [n, c] of p.data) if (!(n in dataVars)) { try { dataVars[n] = JSON.parse(c); } catch { dataVars[n] = c.trim(); } if (!(n in window)) window[n] = dataVars[n]; }
    const tpl = document.createElement("template"); tpl.innerHTML = p.html;
    sync(tpl.content, root, done ? [] : openStack(p.html), 0, !!done);
    if (done) { finished = true; startLogic(p.js, p.py); }
    schedule();
  }
  B.feed = feed;
  B.render = (source) => feed(source, true);
  orient();
  const ro = new ResizeObserver(() => post("height", { h: Math.ceil(Math.max(root.scrollHeight + 8, document.body.scrollHeight)) }));
  ro.observe(document.body); ro.observe(root);

  B.connect = () => {
    const tpl = document.querySelector("template[data-blocks]");
    if (tpl) feed(tpl.innerHTML, true); else post("ready", {});
  };
})();
