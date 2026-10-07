/* Blocks graph engine — flowchart and tree parsing plus a layered layout.
 *
 * Pure code: no DOM, no custom elements, no globals beyond Blocks. It exists as its own file so it can be
 * unit-tested in Node (dev/tests/graph.test.mjs) and reused by anything that wants the same drawing.
 *
 *   Blocks.parseFlow(src)              -> { nodes:[{id,label,kind,detail}], edges:[{from,to,label,dashed}] }
 *   Blocks.parseTree(src)              -> the same shape, from indentation
 *   Blocks.graphLayout(nodes, edges, dir, opts) -> nodes placed in a coordinate space (x, y, w, h) + size
 *
 * The line language is deliberately forgiving: our own one-statement-per-line form, plus the Mermaid
 * flowchart spellings a model slips into out of habit (A[Start] -->|yes| B{Ok}), so a flowchart renders
 * natively either way instead of failing.
 */
(function () {
  "use strict";
  const B = (window.Blocks = window.Blocks || {});

  const KINDS = new Set(["start", "end", "decision", "io", "note", "step", "terminal", "process", "data", "input", "output", "task", "question", "event"]);
  const NORMAL = { process: "step", task: "step", question: "decision", data: "io", input: "io", output: "io", event: "start", terminal: "start", end: "end", start: "start", note: "note", decision: "decision", io: "io", step: "step" };
  const normKind = (k) => (k && KINDS.has(String(k).toLowerCase()) ? NORMAL[String(k).toLowerCase()] || "step" : "");
  const clean = (s) => String(s || "").replace(/\\(["'\\])/g, "$1").replace(/\s+/g, " ").trim();
  // a label alone decides the shape when no kind was written: "Start" is a start, "Done" an end.
  const STARTY = /^(start|begin|entry|open|trigger|init|launch|log ?in|landing|submit)\b/i;
  const ENDY = /^(end|done|finish(ed)?|stop|exit|close[d]?|complete[d]?|result|publish|deliver|ship|logout|archive[d]?)\b/i;
  const inferKind = (label) => (STARTY.test(clean(label)) ? "start" : ENDY.test(clean(label)) ? "end" : "");

  /** `A`, `A[Label]`, `A(Label)`, `A{Label}`, `A((Label))` → id + label + a kind hint. */
  function token(t) {
    const m = String(t).trim().match(/^([\w][\w.:-]*)\s*(?:\(\(([^)]*)\)\)|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?$/);
    if (!m) return null;
    const raw = m[2] ?? m[3] ?? m[4] ?? m[5];
    const label = raw === undefined ? "" : clean(String(raw).replace(/^[\/\\]\s*|\s*[\/\\]$/g, ""));
    const kind = m[5] !== undefined ? "decision" : "";
    return { id: m[1], label, kind };
  }

  function parseFlow(src) {
    const nodes = new Map(), edges = [];
    const put = (id, label, kind) => {
      const k = normKind(kind) || inferKind(label);
      let n = nodes.get(id);
      if (!n) { n = { id, label: label || id, kind: k || "step", detail: "", _k: nodes.size }; nodes.set(id, n); }
      else { if (label) n.label = label; if (k) n.kind = k; }
      return n;
    };
    const edge = (a, b, label, dashed) => {
      if (!a || !b || a.id === b.id) return;
      put(a.id, a.label, a.kind); put(b.id, b.label, b.kind);
      edges.push({ from: a.id, to: b.id, label: clean(label), dashed: !!dashed });
    };
    const ARROW = /(-\.->|-->|-{2}>|==>|->|→|=>|\.\.>)/g;
    for (const raw of String(src || "").replace(/\r/g, "").split("\n")) {
      const line = raw.replace(/\s+$/, "").trim();
      if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith("%%")) continue;
      if (/^(flowchart|graph)\b/i.test(line)) continue;                       // Mermaid header: the attribute owns the direction
      if (/^(classDef|class|style|linkStyle|click|subgraph|direction|end)\b/i.test(line)) continue;
      // one statement may carry a whole chain: a -> b -> c
      const segs = [], toks = [];
      let last = 0, m;
      ARROW.lastIndex = 0;
      while ((m = ARROW.exec(line))) { segs.push(line.slice(last, m.index)); toks.push(m[1]); last = m.index + m[1].length; }
      segs.push(line.slice(last));
      if (toks.length) {
        const parts = segs.map((x) => x.trim());
        for (let i = 0; i < toks.length; i++) {
          let aPart = parts[i], bPart = parts[i + 1], label = "";
          let dashed = /\./.test(toks[i]);
          if (/\bdashed\b/.test(bPart)) { dashed = true; bPart = bPart.replace(/\bdashed\b/, "").trim(); }
          const pipe = bPart.match(/^\|([^|]*)\|\s*(.*)$/);
          if (pipe) { label = pipe[1]; bPart = pipe[2].trim(); }
          const mid = aPart.match(/^(.*?)\s+--\s+([^-][^>]*?)\s*$/);
          if (mid && !label) { aPart = mid[1]; label = mid[2]; }
          const q = bPart.match(/^([^\s"']+)\s*"([^"]*)"\s*$/);
          if (q) { if (!label) label = q[2]; bPart = q[1]; }
          else { const cl = bPart.match(/^([^\s]+)\s*:\s*(.+)$/); if (cl && !label) { label = cl[2]; bPart = cl[1]; } }
          const a = token(aPart), b = token(bPart);
          if (a && b) edge(a, b, label, dashed);
        }
        continue;
      }
      // node declaration:  id "Label" [:kind]   |   id Label :kind   |   id "Label" kind
      const qd = line.match(/^([\w][\w.:-]*)\s+(?:"([^"]*)"|'([^']*)')\s*:?\s*([a-zA-Z][\w-]*)?$/);
      if (qd) {
        let label = qd[2] ?? qd[3] ?? "", kind = normKind(qd[4]);
        if (qd[4] && !kind) label = (label + " " + qd[4]).trim();
        put(qd[1], clean(label), kind);
        continue;
      }
      const kd = line.match(/^([\w][\w.:-]*)\s+(.+?)\s*:\s*([a-zA-Z][\w-]*)$/);
      if (kd && normKind(kd[3])) { put(kd[1], clean(kd[2]), normKind(kd[3])); continue; }
      const bare = line.match(/^([\w][\w.:-]*)(?:\s+(.+))?$/);
      if (bare) { put(bare[1], clean(bare[2] || ""), ""); continue; }
    }
    // a source with no incoming edge reads as a start, a sink as an end — but only when the chart says so by shape
    const hasIn = new Set(edges.map((e) => e.to)), hasOut = new Set(edges.map((e) => e.from));
    const list = [...nodes.values()];
    const shaped = list.length > 3 && list.filter((n) => !hasIn.has(n.id)).length <= 1 && list.filter((n) => !hasOut.has(n.id)).length <= 1;
    if (shaped) for (const n of list) {
      if (n.kind !== "step") continue;
      if (!hasIn.has(n.id) && hasOut.has(n.id)) n.kind = "start";
      else if (!hasOut.has(n.id) && hasIn.has(n.id)) n.kind = "end";
    }
    return { nodes: [...nodes.values()], edges };
  }

  /** Indentation (2 spaces or one tab per level) defines the hierarchy; `Label | detail` adds a second line.
   *  The whole body is dedented first, so markup that arrives indented inside <x-tree> still reads correctly. */
  function parseTree(src) {
    const raw = String(src || "").replace(/\r/g, "").split("\n");
    const indentOf = (l) => (l.match(/^[\t ]*/) || [""])[0].replace(/\t/g, "  ").length;
    const body = raw.filter((l) => l.trim() && !l.trim().startsWith("#"));
    const base = body.length ? Math.min(...body.map(indentOf)) : 0;
    const flat = [];
    for (const line of raw) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const depth = Math.max(0, Math.floor((indentOf(line) - base) / 2));
      let text = line.trim().replace(/^[-*+•]\s+/, "").replace(/\s+$/, "");
      if (!text || text.startsWith("#")) continue;
      let detail = "";
      const bar = text.split(/\s+\|\s+/);
      if (bar.length > 1) { text = bar[0]; detail = bar.slice(1).join(" · "); }
      flat.push({ depth, label: clean(text), detail: clean(detail) });
    }
    const nodes = [], edges = [], stack = [];
    flat.forEach((f, i) => {
      const id = "n" + i;
      const parent = f.depth > 0 ? stack[f.depth - 1] : null;
      nodes.push({ id, label: f.label, detail: f.detail, kind: parent ? "step" : "root", _k: i });
      if (parent) edges.push({ from: parent, to: id, label: "", dashed: false });
      stack[f.depth] = id;
      stack.length = f.depth + 1;
    });
    return { nodes, edges };
  }

  const average = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  /**
   * Layered layout (the Sugiyama skeleton): rank by longest path, order each rank by the barycentre of its
   * neighbours, then place with even spacing. Deterministic — the same source always draws the same chart.
   * `opts.order === "preserve"` keeps declaration order (used by trees, where order is meaning).
   * Nodes must already carry w/h (the caller measures the text); `opts.estimate` is the fallback.
   */
  function graphLayout(nodes0, edges0, dir = "tb", opts = {}) {
    const horizontal = dir === "lr" || dir === "rl";
    const rankGap = opts.rankGap || (horizontal ? 74 : 56);
    const nodeGap = opts.nodeGap || (horizontal ? 20 : 18);
    const est = opts.estimate || ((label, kind) => ({ w: Math.max(84, String(label).length * 7.2 + 34), h: kind === "decision" ? 56 : 40 }));
    const nodes = nodes0.map((n, i) => {
      const size = n.w && n.h ? { w: n.w, h: n.h } : est(n.label, n.kind, n);
      return { ...n, _i: i, w: size.w, h: size.h };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = edges0.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pred = new Map(), succ = new Map();
    nodes.forEach((n) => { pred.set(n.id, []); succ.set(n.id, []); });
    for (const e of edges) { pred.get(e.to).push(e); succ.get(e.from).push(e); }

    // A loop in the drawing is normal (a retry, a revision, a re-queue). Break the cycles first — the edge
    // that closes a loop in depth-first order is the one that gets routed around — then rank the rest as a
    // DAG. Ranking a cyclic graph directly inflates ranks and mixes the layers up (a "Review" step must not
    // land before the step it revises).
    const outIdx = new Map(nodes.map((n) => [n.id, []]));
    const inIdx = new Map(nodes.map((n) => [n.id, []]));
    edges.forEach((e, i) => { outIdx.get(e.from).push(i); inIdx.get(e.to).push(i); });
    const backIdx = new Set();
    {
      const state = new Map();                                   // 1 = on the current path, 2 = done
      for (const n0 of nodes) {
        if (state.get(n0.id) === 2) continue;
        const path = [{ id: n0.id, i: 0 }];
        state.set(n0.id, 1);
        while (path.length) {
          const top = path[path.length - 1];
          const list = outIdx.get(top.id);
          if (top.i >= list.length) { state.set(top.id, 2); path.pop(); continue; }
          const ei = list[top.i++], t = edges[ei].to, st = state.get(t) || 0;
          if (st === 1) backIdx.add(ei);
          else if (st === 0) { state.set(t, 1); path.push({ id: t, i: 0 }); }
        }
      }
    }
    const rank = new Map(nodes.map((n) => [n.id, 0]));
    const visited = new Set();
    const relax = (id) => { for (const i of outIdx.get(id)) { if (backIdx.has(i)) continue; const t = edges[i].to; rank.set(t, Math.max(rank.get(t), rank.get(id) + 1)); if (!visited.has(t)) { visited.add(t); queue.push(t); } } };
    const indeg = new Map(nodes.map((n) => [n.id, 0]));
    edges.forEach((e, i) => { if (!backIdx.has(i)) indeg.set(e.to, indeg.get(e.to) + 1); });
    const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
    queue.forEach((id) => visited.add(id));
    while (queue.length) relax(queue.shift());
    // a loop with no entry point (a → b → a) still has to be drawn somewhere
    for (const n of nodes) if (!visited.has(n.id)) { visited.add(n.id); relax(n.id); }
    // empty layers only add dead space: renumber the used ranks 0..n
    { const used = [...new Set(rank.values())].sort((a, b) => a - b); const to = new Map(used.map((r, i) => [r, i])); for (const n of nodes) rank.set(n.id, to.get(rank.get(n.id))); }
    edges.forEach((e, i) => { e.back = backIdx.has(i) || rank.get(e.to) <= rank.get(e.from); });

    const layers = [];
    for (const n of nodes) { const r = rank.get(n.id); (layers[r] ||= []).push(n); }

    if (opts.order !== "preserve") {
      const pos = new Map();
      const recount = () => layers.forEach((L) => L.forEach((n, i) => pos.set(n.id, i)));
      recount();
      for (let pass = 0; pass < 4; pass++) {
        const down = pass % 2 === 0;
        const order = layers.map((_, i) => i);
        if (!down) order.reverse();
        for (const li of order) {
          const L = layers[li];
          if (!L || L.length < 2) continue;
          const key = new Map(L.map((n) => {
            const neigh = (down ? pred : succ).get(n.id).map((e) => pos.get(down ? e.from : e.to)).filter((x) => x !== undefined);
            return [n.id, average(neigh)];
          }));
          layers[li] = [...L].sort((a, b) => {
            const ka = key.get(a.id), kb = key.get(b.id);
            if (ka === null && kb === null) return a._i - b._i;
            if (ka === null) return 1;
            if (kb === null) return -1;
            return ka - kb || a._i - b._i;
          });
        }
        recount();
      }
    }

    // a rank's thickness is measured along the layout axis: node width when the flow runs left→right,
    // node height when it runs top→bottom (using the cross size here spaced every row by the widest label)
    const rankSize = layers.map((L) => Math.max(0, ...L.map((n) => (horizontal ? n.w : n.h))));
    const rankPos = [];
    let along = 0;
    layers.forEach((_, i) => { rankPos[i] = along; along += rankSize[i] + rankGap; });
    const alongTotal = Math.max(1, along - rankGap);
    const extent = layers.map((L) => L.reduce((s, n) => s + (horizontal ? n.w : n.h) + nodeGap, -nodeGap));
    const crossTotal = Math.max(1, ...extent);
    layers.forEach((L, li) => {
      let cross = (crossTotal - (extent[li] || 0)) / 2;
      for (const n of L) {
        const thick = horizontal ? n.w : n.h;
        const size = horizontal ? n.h : n.w;
        const a = rankPos[li] + (rankSize[li] - thick) / 2;
        if (horizontal) { n.x = a; n.y = cross; } else { n.y = a; n.x = cross; }
        cross += size + nodeGap;
      }
    });
    if (dir === "rl") for (const n of nodes) n.x = alongTotal - n.x - n.w;
    if (dir === "bt") for (const n of nodes) n.y = alongTotal - n.y - n.h;

    edges.forEach((e) => { e.fromNode = byId.get(e.from); e.toNode = byId.get(e.to); });
    return { nodes, edges, width: horizontal ? alongTotal : crossTotal, height: horizontal ? crossTotal : alongTotal, layers: layers.length };
  }

  B.KINDS = KINDS;
  B.parseFlow = parseFlow;
  B.parseTree = parseTree;
  B.graphLayout = graphLayout;
})();
