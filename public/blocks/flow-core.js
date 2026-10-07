/* A bounded, deterministic Mermaid-like flowchart subset. No styling directives or code.
 * The same parser runs in the browser, server validator, and unit tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BlocksFlow = api;
})(globalThis, function () {
  "use strict";
  const directions = { down: "DOWN", TD: "DOWN", TB: "DOWN", right: "RIGHT", LR: "RIGHT", up: "UP", BT: "UP", left: "LEFT", RL: "LEFT" };
  const limits = { nodes: 100, edges: 200, label: 200, source: 64000 };
  const identifier = /^[A-Za-z_][\w-]{0,63}$/;
  function direction(value) {
    if (value === undefined || value === "") return "DOWN";
    const d = directions[value];
    if (!d) throw new Error("Direction must be down, right, up, or left");
    return d;
  }
  function label(value) {
    if (typeof value !== "string" || !value.trim() || value.length > limits.label) throw new Error(`Labels must contain 1–${limits.label} characters`);
    return value.trim();
  }
  function validate(graph, preferred) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("A graph needs nodes and edges arrays");
    if (!graph.nodes.length || graph.nodes.length > limits.nodes || graph.edges.length > limits.edges) throw new Error(`Use 1–${limits.nodes} nodes and at most ${limits.edges} edges; split larger diagrams`);
    const ids = new Set();
    const nodes = graph.nodes.map((n) => {
      if (!n || !identifier.test(n.id) || ids.has(n.id)) throw new Error(`Invalid or duplicate node id: ${n?.id}`);
      ids.add(n.id);
      const kind = n.kind || "step";
      if (!["step", "decision", "terminal"].includes(kind)) throw new Error(`Unknown node kind: ${kind}`);
      return { id: n.id, label: label(n.label), kind };
    });
    const edges = graph.edges.map((e, i) => {
      if (!e || !ids.has(e.from) || !ids.has(e.to)) throw new Error(`Edge ${i + 1} references an undefined node (${e?.from} → ${e?.to}); define it with ID["Label"]`);
      return { id: `edge-${i}`, from: e.from, to: e.to, ...(e.label ? { label: label(e.label) } : {}) };
    });
    return { nodes, edges, direction: direction(preferred || graph.direction) };
  }
  function parse(source, preferred) {
    if (typeof source !== "string" || source.length > limits.source) throw new Error("Flowchart source is missing or too large");
    source = source.trim();
    if (source.startsWith("{")) {
      let graph;
      try { graph = JSON.parse(source); } catch { throw new Error("Invalid flowchart JSON"); }
      return validate(graph, preferred);
    }
    const nodes = new Map(), edges = [];
    let pos = 0, explicitDirection;
    const fail = (text) => { throw new Error(`Line ${source.slice(0, pos).split("\n").length}: ${text}`); };
    const space = () => { while (/[ \t\r]/.test(source[pos] || "") && pos < source.length) pos++; };
    function node() {
      space();
      const m = /^[A-Za-z_](?:\w|-(?!->)){0,63}/.exec(source.slice(pos));
      if (!m) fail('Expected a node such as A["Read"]');
      const id = m[0]; pos += id.length; space();
      const open = source[pos], close = { "[": "]", "{": "}", "(": ")" }[open];
      if (close) {
        pos++; space();
        let text = "";
        if (source[pos] === '"' || source[pos] === "'") {
          const quote = source[pos++]; let closed = false;
          while (pos < source.length) {
            const c = source[pos++];
            if (c === quote) { closed = true; break; }
            if (c === "\\" && pos < source.length) { const next = source[pos++]; text += next === "n" ? "\n" : next; }
            else text += c;
          }
          if (!closed) fail("Unclosed label quote");
          space();
        } else {
          const end = source.indexOf(close, pos);
          if (end < 0) fail("Unclosed node label");
          text = source.slice(pos, end); pos = end;
        }
        if (source[pos] !== close) fail(`Expected ${close} after the label`);
        pos++;
        const kind = open === "{" ? "decision" : open === "(" ? "terminal" : "step";
        const n = { id, label: label(text), kind }, previous = nodes.get(id);
        if (previous && (previous.label !== n.label || previous.kind !== kind)) fail(`Conflicting definition of ${id}`);
        nodes.set(id, n);
      }
      if (nodes.size > limits.nodes) fail(`At most ${limits.nodes} nodes are supported`);
      return id;
    }
    while (pos < source.length) {
      space();
      if (source[pos] === "\n" || source[pos] === ";") { pos++; continue; }
      if (source.startsWith("%%", pos)) { const end = source.indexOf("\n", pos); pos = end < 0 ? source.length : end + 1; continue; }
      if (pos >= source.length) break;
      const header = /^(?:flowchart|graph)\s+(TD|TB|LR|BT|RL)\b/.exec(source.slice(pos));
      if (header) { explicitDirection = header[1]; pos += header[0].length; space(); if (pos < source.length && !/[\n;]/.test(source[pos])) fail("End the direction header with a newline"); continue; }
      let from = node(); space();
      while (source.startsWith("-->", pos)) {
        pos += 3; space(); let edgeLabel;
        if (source[pos] === "|") {
          const end = source.indexOf("|", ++pos);
          if (end < 0) fail("Unclosed edge label; use -->|Yes|");
          edgeLabel = label(source.slice(pos, end)); pos = end + 1;
        }
        const to = node(); edges.push({ from, to, ...(edgeLabel ? { label: edgeLabel } : {}) });
        if (edges.length > limits.edges) fail(`At most ${limits.edges} edges are supported`);
        from = to; space();
      }
      if (pos < source.length && !/[\n;]/.test(source[pos])) fail('Unsupported syntax; use A["Label"] -->|optional label| B["Label"]');
    }
    return validate({ nodes: [...nodes.values()], edges, direction: explicitDirection }, preferred);
  }
  return { parse, validate, limits };
});
