/* Blocks — flow engine (x-flow).
 *
 * A flowchart without a diagram library: the model writes a tiny labelled language, the engine
 * lays it out (layered DAG: longest-path ranking, barycentre ordering, decluttered edges) and
 * draws themed SVG that behaves like the rest of the app (pan, zoom, fit, open in canvas).
 *
 * Language (one statement per line; blank lines and `# comment` lines ignored):
 *   id [ '['shape(,tone)*']' ] [ ':' label ]      node            start[round]: Open app
 *   a -> b [: label]                              edge            check -> ok: yes
 *   a -> b -> c                                   edges in one line
 *   a => b  emphasised        a -.-> b  dashed (feedback / error path)
 * Shapes: rect round start end decision data db note pill circle. Tones: accent success danger warning info.
 * An endpoint never declared as a node becomes one whose label is its id, so `Start -> Login?` just works.
 *
 * Attributes: dir="TB|LR|BT|RL" height="360|fill" title caption active="id" zoom fit=false panzoom=false grid=false
 * API: .fit() .zoomBy(k) .center(id) .value = { nodes, edges } .model
 * Events: nodeclick (detail {id,label}) when a node is clicked.
 */
(function () {
  "use strict";
  const B = (window.Blocks = window.Blocks || {});
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const SHAPES = new Set(["rect", "round", "start", "end", "decision", "data", "db", "note", "pill", "circle"]);
  const TONES = new Set(["accent", "success", "danger", "warning", "info", "neutral"]);

  /* ------------------------------------------------------------------ parse */
  const ARROW = /\s*(=>|-\.->|-->|==>|->)\s*/;
  const ARROW_G = /=>|-\.->|-->|==>|->/g;
  function nodeFrom(token, nodes, order, loose) {
    const m = token.match(/^([A-Za-z0-9_.$-]+)\s*(?:\[([^\]]*)\])?\s*(?::\s*([\s\S]+))?$/);
    if (!m) {
      if (!loose) return null; // a whole declaration line that will not parse is an issue, not a phantom node
      // a chain term with punctuation or spaces ("Check?"): the text is the node
      const label = token.replace(/^["']|["']$/g, "").trim();
      if (!label) return null;
      let n = nodes.get(label);
      if (!n) { n = { id: label, label, shape: "rect", tone: "", lines: [] }; nodes.set(label, n); order.push(label); }
      return n;
    }
    const id = m[1];
    const meta = (m[2] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const shape = meta.find((x) => SHAPES.has(x)) || "";
    const tone = meta.find((x) => TONES.has(x)) || "";
    const label = m[3] !== undefined ? m[3].trim().replace(/^["']|["']$/g, "") : null;
    let n = nodes.get(id);
    if (!n) { n = { id, label: label || id, shape: shape || "rect", tone, lines: [] }; nodes.set(id, n); order.push(id); }
    else {
      if (label) n.label = label;
      if (shape) n.shape = shape;
      if (tone) n.tone = tone;
    }
    return n;
  }
  /** Split an edge line at the first colon that follows the last arrow: "a -> b: yes" → ["a -> b", "yes"].
      Colons before the arrows belong to node labels, colons inside quotes are never separators. */
  function tailLabel(line) {
    let last = -1;
    ARROW_G.lastIndex = 0;
    for (let m; (m = ARROW_G.exec(line));) last = m.index + m[0].length;
    let quote = null, cut = -1;
    for (let i = Math.max(0, last); i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === ":") { cut = i; break; }
    }
    if (cut < 0) return [line, ""];
    return [line.slice(0, cut).trim(), line.slice(cut + 1).trim().replace(/^["']|["']$/g, "")];
  }
  function parse(src) {
    const nodes = new Map(), order = [], edges = [], issues = [];
    for (const raw of String(src || "").split("\n")) {
      const t = raw.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) continue;
      if (ARROW.test(t)) {
        const [head, label] = tailLabel(t);
        const seq = head.split(/\s*(=>|-\.->|-->|==>|->)\s*/).filter((s) => s !== "");
        let prev = null, style = "solid";
        for (const step of seq) {
          if (/^(=>|-\.->|-->|==>|->)$/.test(step)) { style = step === "=>" || step === "==>" ? "strong" : step === "-.->" ? "dashed" : "solid"; continue; }
          const n = nodeFrom(step, nodes, order, true);
          if (!n) { issues.push(`x-flow: cannot read "${step}" on line "${t}"`); prev = null; continue; }
          if (prev) edges.push({ from: prev.id, to: n.id, label: "", style });
          prev = n;
        }
        if (prev && label && edges.length) edges[edges.length - 1].label = label;
        continue;
      }
      const n = nodeFrom(t, nodes, order);
      if (!n) issues.push(`x-flow: cannot read line "${t}"`);
    }
    const seen = new Set();
    const unique = edges.filter((e) => { const k = `${e.from}->${e.to}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { nodes: order.map((id) => nodes.get(id)), edges: unique, issues };
  }

  /* ------------------------------------------------------------------ layout (flow goes down) */
  const charW = 7.05, lineH = 15.5, padX = 15, padY = 10;
  function wrap(label, width) {
    const max = Math.max(6, Math.floor((width - padX * 2) / charW));
    const words = String(label).split(/\s+/).filter(Boolean);
    const lines = []; let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + " " + w).length <= max) cur += " " + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }
  function size(n) {
    const wide = n.shape === "decision" || n.shape === "db";
    const w0 = Math.min(240, Math.max(wide ? 132 : 104, String(n.label).length * charW + padX * 2 + (wide ? 34 : 0)));
    const lines = wrap(n.label, wide ? w0 - 36 : w0);
    n.w = Math.round(wide ? w0 * 1.14 : w0);
    n.h = Math.max(42, Math.round(lines.length * lineH + padY * 2));
    n.lines = lines;
    return n;
  }
  function layout(model, opts = {}) {
    const gapX = opts.gapX || 26, gapY = opts.gapY || 56;
    const nodes = model.nodes.map(size);
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const forward = [], backEdges = new Set();
    // orient the graph: a back edge is one that closes a cycle during DFS
    const state = nodes.map(() => 0);
    const dfs = (i) => {
      state[i] = 1;
      for (const e of model.edges) {
        if (idx.get(e.from) !== i) continue;
        const j = idx.get(e.to);
        if (j === undefined) continue;
        if (state[j] === 1) backEdges.add(`${e.from}->${e.to}`);
        else if (state[j] === 0) dfs(j);
      }
      state[i] = 2;
    };
    nodes.forEach((_, i) => state[i] === 0 && dfs(i));
    for (const e of model.edges) { if (!backEdges.has(`${e.from}->${e.to}`)) forward.push(e); }
    const out = nodes.map(() => []), inc = nodes.map(() => []);
    for (const e of forward) {
      const i = idx.get(e.from), j = idx.get(e.to);
      if (i === undefined || j === undefined) continue;
      out[i].push(j); inc[j].push(i);
    }
    // longest-path ranking
    const rank = nodes.map(() => 0);
    for (let pass = 0; pass <= nodes.length; pass++) {
      let changed = false;
      for (const e of forward) {
        const i = idx.get(e.from), j = idx.get(e.to);
        if (i === undefined || j === undefined) continue;
        if (rank[j] < rank[i] + 1) { rank[j] = rank[i] + 1; changed = true; }
      }
      if (!changed) break;
    }
    const layers = new Map();
    nodes.forEach((n, i) => { const r = rank[i]; if (!layers.has(r)) layers.set(r, []); layers.get(r).push(i); });
    const ranks = [...layers.keys()].sort((a, b) => a - b);
    const posIn = new Map(), layerOf = new Map();
    ranks.forEach((r) => layers.get(r).forEach((i, k) => { posIn.set(i, k); layerOf.set(i, r); }));
    for (let pass = 0; pass < 4; pass++) {
      const down = pass % 2 === 0;
      for (const r of down ? ranks : [...ranks].reverse()) {
        const layer = layers.get(r);
        const bary = new Map(layer.map((i) => {
          const nb = (down ? inc[i] : out[i]).filter((j) => layerOf.get(j) !== r);
          return [i, nb.length ? nb.reduce((a, j) => a + (posIn.get(j) || 0), 0) / nb.length : posIn.get(i)];
        }));
        layer.sort((a, b) => (bary.get(a) - bary.get(b)) || (posIn.get(a) - posIn.get(b)));
        layer.forEach((i, k) => posIn.set(i, k));
      }
    }
    let y = 0, width = 0;
    for (const r of ranks) {
      const layer = layers.get(r);
      const rowH = Math.max(...layer.map((i) => nodes[i].h));
      const totalW = layer.reduce((a, i) => a + nodes[i].w, 0) + gapX * Math.max(0, layer.length - 1);
      let x = 0;
      for (const i of layer) {
        const n = nodes[i];
        n.x = Math.round(x); n.y = Math.round(y + (rowH - n.h) / 2); n.rank = r;
        x += n.w + gapX;
      }
      // centre the row on the widest row's midpoint
      for (const i of layer) nodes[i].cx = nodes[i].x + nodes[i].w / 2;
      width = Math.max(width, totalW);
      for (const i of layer) nodes[i]._rowW = totalW;
      y += rowH + gapY;
    }
    for (const n of nodes) { const off = (width - n._rowW) / 2; n.x += off; }
    const height = Math.max(0, y - gapY);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = model.edges.map((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) return null;
      return { ...e, a, b, back: backEdges.has(`${e.from}->${e.to}`) || b.rank < a.rank };
    }).filter(Boolean);
    return { nodes, edges, width, height, ranks, byId };
  }

  /* ------------------------------------------------------------------ render */
  /** Project layout coordinates (flow-down space) into the requested direction. */
  function project(n, dir, Lw, Lh, pad) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    if (dir === "LR") return { x: pad + cy, y: pad + cx, w: n.h, h: n.w };
    if (dir === "RL") return { x: pad + (Lh - cy), y: pad + cx, w: n.h, h: n.w };
    if (dir === "BT") return { x: pad + cx, y: pad + (Lh - cy), w: n.w, h: n.h };
    return { x: pad + cx, y: pad + cy, w: n.w, h: n.h };
  }
  /** Rounded orthogonal polyline through projected points. */
  function elbow(pts, r = 9) {
    const p = pts.filter((q, i) => i === 0 || Math.abs(q[0] - pts[i - 1][0]) > 0.6 || Math.abs(q[1] - pts[i - 1][1]) > 0.6);
    if (p.length < 3) return `M${p[0][0]},${p[0][1]} L${p[p.length - 1][0]},${p[p.length - 1][1]}`;
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 1; i < p.length - 1; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i], [cx, cy] = p[i + 1];
      const l1 = Math.hypot(bx - ax, by - ay) || 1, l2 = Math.hypot(cx - bx, cy - by) || 1, rr = Math.min(r, l1 / 2, l2 / 2);
      const q1 = [bx - ((bx - ax) / l1) * rr, by - ((by - ay) / l1) * rr];
      const q2 = [bx + ((cx - bx) / l2) * rr, by + ((cy - by) / l2) * rr];
      d += ` L${q1[0].toFixed(1)},${q1[1].toFixed(1)} Q${bx.toFixed(1)},${by.toFixed(1)} ${q2[0].toFixed(1)},${q2[1].toFixed(1)}`;
    }
    const [ex, ey] = p[p.length - 1];
    return d + ` L${ex.toFixed(1)},${ey.toFixed(1)}`;
  }

  /** Orthogonal routing, computed in flow space (the graph always reads "down") and projected at the end:
      straight when the columns line up, one elbow between neighbouring ranks, and a corridor route — out
      to a vertical lane no node blocks, along it, back in through the far node's own side — when an edge
      skips a rank or loops back. Nothing is drawn on top of a node. */
  function routeEdges(hit, dir, Lw, Lh) {
    const proj = { TB: (x, y) => [x, y], LR: (x, y) => [y, x], RL: (x, y) => [Lh - y, x], BT: (x, y) => [x, Lh - y] }[dir] || ((x, y) => [x, y]);
    const rows = new Map();
    for (const n of hit.nodes) {
      const r = n.rank || 0, cur = rows.get(r) || { top: Infinity, bottom: -Infinity };
      cur.top = Math.min(cur.top, n.y); cur.bottom = Math.max(cur.bottom, n.y + n.h);
      rows.set(r, cur);
    }
    const keys = [...rows.keys()].sort((a, b) => a - b);
    const row = (r) => rows.get(r) || { top: 0, bottom: 0 };
    const gapBelow = (r) => { const nx = rows.get(keys[keys.indexOf(r) + 1]); return nx ? (row(r).bottom + nx.top) / 2 : row(r).bottom + 34; };
    const gapAbove = (r) => { const pv = rows.get(keys[keys.indexOf(r) - 1]); return pv ? (pv.bottom + row(r).top) / 2 : row(r).top - 34; };
    const left = Math.min(...hit.nodes.map((n) => n.x)), right = Math.max(...hit.nodes.map((n) => n.x + n.w));
    /** centres of the vertical lanes no node blocks strictly between two ranks */
    const lanes = (from, to) => {
      let free = [[-1e5, 1e5]];
      for (const r of keys.filter((k) => k > from && k < to)) {
        const boxes = hit.nodes.filter((n) => (n.rank || 0) === r).map((n) => [n.x - 16, n.x + n.w + 16]).sort((p, q) => p[0] - q[0]);
        const open = []; let x = -1e5;
        for (const [s, e] of boxes) { if (s > x) open.push([x, s]); x = Math.max(x, e); }
        open.push([x, 1e5]);
        free = free.flatMap(([fs, fe]) => open.map(([os, oe]) => [Math.max(fs, os), Math.min(fe, oe)]).filter(([s2, e2]) => e2 - s2 > 2));
        if (!free.length) break;
      }
      return free.filter(([s, e]) => s < right + 60 && e > left - 60).map(([s, e]) => Math.min(Math.max((s + e) / 2, left - 42), right + 42));
    };
    let seq = 0;
    return hit.edges.map((e) => {
      const a = e.a, b = e.b, ra = a.rank || 0, rb = b.rank || 0;
      const ax = a.x + a.w / 2, bx = b.x + b.w / 2, acy = a.y + a.h / 2, bcy = b.y + b.h / 2;
      const aBot = a.y + a.h, bTop = b.y;
      let pts, labelSeg = -1;
      if (rb > ra + 1 || rb < ra) {
        const down = rb > ra;
        const outY = down ? gapBelow(ra) : gapAbove(ra), inY = down ? gapAbove(rb) : gapBelow(rb);
        const want = (ax + bx) / 2, room = lanes(down ? ra : rb, down ? rb : ra);
        const outward = (bx >= ax ? right + 30 : left - 30) + (bx >= ax ? 1 : -1) * seq++ * 16;
        const all = room.length ? room : [outward];
        const lane = all.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best), all[0]);
        pts = [[ax, down ? aBot : a.y], [ax, outY], [lane, outY], [lane, inY], [bx, inY], [bx, down ? bTop : b.y + b.h]];
        labelSeg = 1;
      } else if (rb === ra) {
        const ch = gapBelow(ra), rightwards = bx >= ax, stub = 14;
        const aSide = rightwards ? a.x + a.w : a.x, bSide = rightwards ? b.x : b.x + b.w;
        const aOut = rightwards ? aSide + stub : aSide - stub, bOut = rightwards ? bSide - stub : bSide + stub;
        pts = [[aSide, acy], [aOut, acy], [aOut, ch], [bOut, ch], [bOut, bcy], [bSide, bcy]];
        labelSeg = 2;
      } else if (Math.abs(ax - bx) < 2) {
        pts = [[ax, aBot], [bx, bTop]];
      } else {
        const ch = gapBelow(ra);
        pts = [[ax, aBot], [ax, ch], [bx, ch], [bx, bTop]];
        labelSeg = 1;
      }
      return { e, screen: pts.map(([x, y]) => proj(x, y)), labelSeg };
    });
  }

  function renderSVG(hit, o) {
    const dir = o.dir;
    const routes = routeEdges(hit, dir, hit.width, hit.height);
    const boxes = hit.nodes.map((n) => ({ n, p: project(n, dir, hit.width, hit.height, 0) }));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const touch = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
    for (const { p } of boxes) { touch(p.x - p.w / 2, p.y - p.h / 2); touch(p.x + p.w / 2, p.y + p.h / 2); }
    for (const r of routes) for (const [x, y] of r.screen) touch(x, y);
    const pad = o.pad, ox = pad - minX, oy = pad - minY;
    const W = Math.max(80, Math.round(maxX - minX + pad * 2)), H = Math.max(60, Math.round(maxY - minY + pad * 2));
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "xf-svg", "aria-label": o.title || "Flowchart" });
    const defs = svg("defs", {}, s);
    const mk = svg("marker", { id: o.marker, viewBox: "0 0 10 10", refX: 8.4, refY: 5, markerWidth: 6.2, markerHeight: 6.2, orient: "auto-start-reverse" }, defs);
    svg("path", { d: "M0,0 L10,5 L0,10 z", class: "xf-arrowhead" }, mk);
    const g = svg("g", { class: "xf-root" }, s);
    const eg = svg("g", { class: "xf-edges" }, g);
    for (const r of routes) {
      const e = r.e, pts = r.screen.map(([x, y]) => [x + ox, y + oy]);
      const path = svg("path", { d: elbow(pts), class: "xf-edge" + (e.style === "dashed" ? " dashed" : "") + (e.style === "strong" ? " strong" : ""), "marker-end": `url(#${o.marker})` }, eg);
      if (!e.back && e.b.rank === e.a.rank + 1 && B.drawIn) B.drawIn(path);
      if (e.label) {
        const i = r.labelSeg >= 0 ? r.labelSeg : 0;
        const p1 = pts[i], p2 = pts[Math.min(i + 1, pts.length - 1)];
        const horizontal = Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]);
        const t = svg("text", { x: (p1[0] + p2[0]) / 2 + (horizontal ? 0 : 9), y: (p1[1] + p2[1]) / 2 + (horizontal ? -6 : 4), class: "xf-edge-l", "text-anchor": horizontal ? "middle" : "start" }, eg);
        t.textContent = e.label;
      }
    }
    const ng = svg("g", { class: "xf-nodes" }, g);
    for (const { n, p: pb } of boxes) {
      const p = { x: pb.x + ox, y: pb.y + oy, w: pb.w, h: pb.h };
      const gN = svg("g", { class: `xf-node xf-${n.shape}${n.tone ? ` tone-${n.tone}` : ""}`, "data-id": n.id, tabindex: "0", role: "button", "aria-label": n.label }, ng);
      const x = p.x - p.w / 2, y = p.y - p.h / 2, w = p.w, h = p.h, r = Math.min(12, h / 2 - 2);
      if (n.shape === "decision") svg("path", { d: `M${x + w / 2},${y - 7} L${x + w + 7},${y + h / 2} L${x + w / 2},${y + h + 7} L${x - 7},${y + h / 2} Z`, class: "xf-shape" }, gN);
      else if (n.shape === "db") svg("path", { d: `M${x},${y + 9} C${x},${y - 1} ${x + w},${y - 1} ${x + w},${y + 9} L${x + w},${y + h - 9} C${x + w},${y + h + 1} ${x},${y + h + 1} ${x},${y + h - 9} Z M${x},${y + 9} C${x},${y + 17} ${x + w},${y + 17} ${x + w},${y + 9}`, class: "xf-shape" }, gN);
      else if (n.shape === "data") svg("path", { d: `M${x + 13},${y} L${x + w},${y} L${x + w - 13},${y + h} L${x},${y + h} Z`, class: "xf-shape" }, gN);
      else if (n.shape === "note") svg("path", { d: `M${x},${y} L${x + w - 13},${y} L${x + w},${y + 13} L${x + w},${y + h} L${x},${y + h} Z M${x + w - 13},${y} L${x + w - 13},${y + 13} L${x + w},${y + 13}`, class: "xf-shape" }, gN);
      else if (n.shape === "circle") svg("ellipse", { cx: p.x, cy: p.y, rx: w / 2, ry: h / 2, class: "xf-shape" }, gN);
      else svg("rect", { x, y, width: w, height: h, rx: n.shape === "round" || n.shape === "start" || n.shape === "end" || n.shape === "pill" ? h / 2 - 1 : r, class: "xf-shape" }, gN);
      if (n.shape === "start" || n.shape === "end") gN.querySelector(".xf-shape").classList.add(n.shape);
      const t = svg("text", { x: p.x, y: p.y - ((n.lines.length - 1) * lineH) / 2 + 4.5, class: "xf-label", "text-anchor": "middle" }, gN);
      n.lines.forEach((ln, i) => { const ts = svg("tspan", { x: p.x, dy: i ? lineH : 0 }, t); ts.textContent = ln; });
      gN.addEventListener("click", () => o.emit(n));
      gN.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); o.emit(n); } });
    }
    return { svg: s, W, H };
  }

  /* ------------------------------------------------------------------ element */
  const el = (tag, cls, parent) => { const d = document.createElement(tag); if (cls) d.className = cls; if (parent) parent.appendChild(d); return d; };
  let markerSeq = 0;
  function define() {
    if (!B.Base || !B.define) return;
    B.define("x-flow", class extends B.Base {
      static owns = true;
      init() {
        this.dataset.reactive = "";
        this._marker = "xfa" + ++markerSeq;
        this._wrap = el("div", "xf-wrap", this);
        this._stage = el("div", "xf-stage", this._wrap);
        this._pan = el("div", "xf-pan", this._stage);
        this._bar = el("div", "xf-bar", this._wrap);
        this._bar.innerHTML = `<button type="button" data-act="out" aria-label="Zoom out">−</button><button type="button" data-act="in" aria-label="Zoom in">+</button><button type="button" data-act="fit" aria-label="Fit">Fit</button>`;
        this.view = { k: 1, x: 0, y: 0 };
        let drag = null;
        const stage = this._stage;
        const panzoom = () => this.a("panzoom", "") !== "false";
        stage.addEventListener("pointerdown", (e) => {
          if (!panzoom() || e.target.closest("button")) return;
          drag = { x: e.clientX, y: e.clientY, v: { ...this.view } };
          stage.classList.add("grab"); stage.setPointerCapture(e.pointerId);
        });
        stage.addEventListener("pointermove", (e) => { if (drag) this._apply({ k: drag.v.k, x: drag.v.x + (e.clientX - drag.x), y: drag.v.y + (e.clientY - drag.y) }); });
        const end = () => { drag = null; stage.classList.remove("grab"); };
        stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
        stage.addEventListener("wheel", (e) => {
          if (!panzoom()) return;
          e.preventDefault();
          const r = stage.getBoundingClientRect();
          const k0 = this.view.k, k = Math.max(0.3, Math.min(2.8, k0 * (e.deltaY < 0 ? 1.12 : 0.89)));
          const cx = e.clientX - r.left, cy = e.clientY - r.top;
          this._apply({ k, x: cx - ((cx - this.view.x) * k) / k0, y: cy - ((cy - this.view.y) * k) / k0 });
        }, { passive: false });
        stage.addEventListener("dblclick", () => this.fit());
        this._bar.addEventListener("click", (e) => {
          const b = e.target.closest("button"); if (!b) return;
          if (b.dataset.act === "in") this.zoomBy(1.2);
          else if (b.dataset.act === "out") this.zoomBy(1 / 1.2);
          else this.fit();
        });
        this._stage.addEventListener("click", (e) => { if (e.target.closest(".xf-node")) this.dispatchEvent(new CustomEvent("change", { bubbles: true })); });
      }
      _apply(v) {
        this.view = v;
        this._pan.style.transform = `translate(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px) scale(${v.k.toFixed(3)})`;
      }
      render() {
        const model = parse(this._src || "");
        this.model = model;
        const hit = layout(model, {});
        const dir = ["TB", "LR", "BT", "RL"].includes(this.a("dir", "TB")) ? this.a("dir", "TB") : "TB";
        const out = renderSVG(hit, { dir, pad: 16, marker: this._marker, title: this.a("title", ""), emit: (n) => { this.dispatchEvent(new CustomEvent("nodeclick", { detail: { id: n.id, label: n.label }, bubbles: true })); } });
        this._pan.innerHTML = "";
        this._pan.appendChild(out.svg);
        this._natural = { w: out.W, h: out.H };
        this._wrap.classList.toggle("no-labels", this.a("labels", "") === "hide");
        this._wrap.classList.toggle("no-grid", this.a("grid", "") === "false");
        const fill = document.body.classList.contains("fill") || this.a("height", "") === "fill";
        this._wrap.classList.toggle("is-fill", fill);
        const hAttr = parseFloat(this.a("height", ""));
        const cap = fill ? Math.max(240, this._wrap.clientHeight || 380) : Number.isFinite(hAttr) ? Math.max(140, hAttr) : 0;
        this._wrap.style.setProperty("--xf-h", (cap ? cap : Math.min(Math.max(out.H, 130), 320)) + "px");
        const caption = this.getAttribute("caption");
        if (caption) { this._cap = this._cap || el("div", "xf-cap", this._wrap); this._cap.textContent = caption; }
        else if (this._cap) { this._cap.remove(); this._cap = null; }
        requestAnimationFrame(() => { if (this.a("fit", "") !== "false") this.fit(); });
        if (model.issues.length && B.issue) B.issue(model.issues.slice(0, 3).join("; "));
      }
      _box() { return (this._stage.parentElement || this).getBoundingClientRect(); }
      fit() {
        const r = this._box(), nat = this._natural;
        if (!r.width || !nat) return this;
        const k = Math.max(0.3, Math.min(1, (r.width - 8) / nat.w, (r.height - 8) / nat.h));
        this._apply({ k, x: (r.width - nat.w * k) / 2, y: Math.max(0, (r.height - nat.h * k) / 2) });
        return this;
      }
      zoomBy(f) {
        const r = this._box(), k0 = this.view.k, k = Math.max(0.3, Math.min(2.8, k0 * f));
        const cx = r.width / 2, cy = r.height / 2;
        this._apply({ k, x: cx - ((cx - this.view.x) * k) / k0, y: cy - ((cy - this.view.y) * k) / k0 });
        return this;
      }
      center(id) {
        const n = this.model && this.model.nodes.find((x) => x.id === id);
        if (!n) return this;
        const r = this._box(), k = Math.max(this.view.k, 0.9);
        this._apply({ k, x: r.width / 2 - (n.x + n.w / 2) * k, y: r.height / 2 - (n.y + n.h / 2) * k });
        this._stage.querySelectorAll(".xf-node.on").forEach((e) => e.classList.remove("on"));
        const hit = this._stage.querySelector(`.xf-node[data-id="${(window.CSS && CSS.escape ? CSS.escape(id) : id).replace(/"/g, '\\"')}"]`);
        if (hit) hit.classList.add("on");
        return this;
      }
      get value() { return this.model ? { nodes: this.model.nodes.map((n) => ({ id: n.id, label: n.label, shape: n.shape, tone: n.tone })), edges: this.model.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })) } : null; }
    }); // owns: mounted complete, so the authoring text is the source (never a streaming shell)
  }
  B.flow = { parse, layout, size, wrap, project };
  define();
})();
