/* Native flowcharts. Models supply a graph, never coordinates. ELK is loaded only on demand.
 * Each layout uses an isolated worker with a time budget; rendering uses app theme tokens. */
(function () {
  "use strict";
  const B = window.Blocks;
  let engine;
  const loadEngine = () => (engine ||= B.load(B.vendor("elk", "elk-api.js")).catch((e) => { engine = null; throw e; }));
  const textLines = (text, width, measure) => {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (line && measure(line + " " + word) > width) { lines.push(line); line = ""; }
        for (const char of (line ? " " : "") + word) {
          if (line && measure(line + char) > width) { lines.push(line); line = ""; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  B.define("x-flowchart", class extends B.Base {
    static owns = true;
    init() {
      this._revision = 0; this._zoom = 1; this._pan = { x: 0, y: 0 }; this._touched = false;
      this.innerHTML = '<div class="flow-head"><strong></strong><div class="flow-tools"><button type="button" data-act="out" aria-label="Zoom out">−</button><output aria-label="Zoom level">100%</output><button type="button" data-act="in" aria-label="Zoom in">+</button><button type="button" data-act="fit">Fit</button><button type="button" data-act="reset">Reset</button></div></div><div class="flow-view" tabindex="0" role="region" aria-label="Flowchart. Arrow keys pan; plus and minus zoom; F fits; Home resets."></div><div class="flow-status" role="status"></div><details class="flow-outline"><summary>Text outline</summary><div></div></details>';
      this._view = this.querySelector(".flow-view");
      this._status = this.querySelector(".flow-status");
      this._ro = new ResizeObserver(() => { if (!this._touched) this.fit(false); });
      this._ro.observe(this._view);
      this.querySelectorAll("[data-act]").forEach((button) => {
        button.onclick = () => {
          this._touched = true;
          const a = button.dataset.act;
          if (a === "fit") this.fit(true);
          else if (a === "reset") { this._touched = false; this.fit(false); }
          else this.zoom(a === "in" ? 1.25 : 0.8);
        };
      });
      let drag;
      this._view.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("[data-node]")) return;
        this._view.focus(); this._touched = true;
        drag = { x: e.clientX, y: e.clientY, pan: { ...this._pan } }; this._view.setPointerCapture(e.pointerId);
      });
      this._view.addEventListener("pointermove", (e) => {
        if (!drag) return;
        this._pan = { x: drag.pan.x + e.clientX - drag.x, y: drag.pan.y + e.clientY - drag.y }; this.transform();
      });
      for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) this._view.addEventListener(event, () => { drag = null; });
      this._view.addEventListener("wheel", (e) => {
        // Ordinary wheel/touch scrolling belongs to the conversation, not the diagram.
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault(); this._touched = true; this.zoom(Math.exp(-e.deltaY * 0.003));
      }, { passive: false });
      this._view.addEventListener("keydown", (e) => {
        if (e.target !== this._view) return;
        const moves = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (moves[e.key]) { e.preventDefault(); this._touched = true; this._pan.x += moves[e.key][0]; this._pan.y += moves[e.key][1]; this.transform(); }
        else if (["+", "=", "-", "f", "F", "Home"].includes(e.key)) {
          e.preventDefault(); this._touched = true;
          if (e.key === "f" || e.key === "F") this.fit(true);
          else if (e.key === "Home") { this._touched = false; this.fit(false); }
          else this.zoom(e.key === "-" ? 0.8 : 1.25);
        }
      });
    }
    dispose() {
      this._revision++; this._layoutKey = null;
      this._elk?.terminateWorker(); this._elk = null;
      if (this._workerURL) URL.revokeObjectURL(this._workerURL);
      this._workerURL = null; this._ro?.disconnect();
      super.dispose();
    }
    connectedCallback() { super.connectedCallback(); if (this._ro) this._ro.observe(this._view); }
    render() {
      const source = this.a("data", this._src || ""), direction = this.a("direction", "");
      this.querySelector(".flow-head strong").textContent = this.a("title", "");
      this._view.style.height = Math.max(160, Math.min(1200, this.n("height", document.body.classList.contains("fill") ? 440 : 340))) + "px";
      const key = source + "\n" + direction;
      if (key === this._layoutKey) return;
      this._layoutKey = key;
      const revision = ++this._revision;
      this._elk?.terminateWorker(); this._elk = null;
      if (this._workerURL) URL.revokeObjectURL(this._workerURL);
      this._workerURL = null;
      let graph;
      try { graph = window.BlocksFlow.parse(source, direction); }
      catch (e) { this.failure(e); return; }
      this._status.textContent = "Arranging diagram…"; this.setAttribute("aria-busy", "true");
      this.layout(graph, revision).catch((e) => { if (revision === this._revision && this.isConnected) this.failure(e); });
    }
    failure(error) {
      this.removeAttribute("aria-busy");
      this._status.textContent = `${this._drawing ? "Showing previous diagram. " : ""}${error.message || error}`;
      this._status.dataset.error = "true";
      B.post("error", { text: "x-flowchart: " + (error.message || error) });
    }
    async layout(graph, revision) {
      await loadEngine();
      if (revision !== this._revision || !this.isConnected) return;
      // A blob bootstrap allows an opaque-origin sandbox to start the local CORS-enabled worker.
      const workerURL = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(B.vendor("elk", "elk-worker.min.js"))});`], { type: "text/javascript" }));
      this._workerURL = workerURL;
      const elk = this._elk = new window.ELK({ workerUrl: workerURL, workerFactory: (url) => new Worker(url) });
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = '14px ' + getComputedStyle(this).fontFamily;
      const children = graph.nodes.map((node) => {
        const lines = textLines(node.label, 170, (s) => ctx.measureText(s).width);
        const contentWidth = Math.max(64, ...lines.map((s) => ctx.measureText(s).width));
        const factor = node.kind === "decision" ? 2 : 1;
        return { id: node.id, width: Math.ceil((contentWidth + 32) * factor), height: Math.ceil((lines.length * 20 + 26) * factor), lines, node };
      });
      ctx.font = '12px ' + getComputedStyle(this).fontFamily;
      const edges = graph.edges.map((edge) => {
        const lines = edge.label ? textLines(edge.label, 180, (s) => ctx.measureText(s).width) : [];
        return { id: edge.id, sources: [edge.from], targets: [edge.to], ...(edge.label ? { labels: [{ text: edge.label, lines, width: Math.max(...lines.map((s) => ctx.measureText(s).width)) + 16, height: lines.length * 18 + 6 }] } : {}) };
      });
      let timer;
      try {
        const result = await Promise.race([
          elk.layout({ id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": graph.direction, "elk.edgeRouting": "ORTHOGONAL", "elk.spacing.nodeNode": "32", "elk.layered.spacing.nodeNodeBetweenLayers": "60", "elk.padding": "[top=24,left=24,bottom=24,right=24]" }, children, edges }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Layout timed out; split this diagram into smaller parts")), 8000); }),
        ]);
        if (revision !== this._revision || !this.isConnected) return;
        this._graph = graph; this.outline(graph); this.draw(result, children);
        this._status.textContent = ""; delete this._status.dataset.error; this.removeAttribute("aria-busy");
      } finally {
        clearTimeout(timer); elk.terminateWorker(); URL.revokeObjectURL(workerURL);
        if (this._elk === elk) { this._elk = null; this._workerURL = null; }
      }
    }
    outline(graph) {
      const target = this.querySelector(".flow-outline>div"); target.replaceChildren();
      const list = document.createElement("ol");
      for (const node of graph.nodes) {
        const item = document.createElement("li");
        const outgoing = graph.edges.filter((edge) => edge.from === node.id);
        item.textContent = node.label + (outgoing.length ? ": " + outgoing.map((edge) => `${edge.label ? edge.label + " → " : "→ "}${graph.nodes.find((n) => n.id === edge.to).label}`).join("; ") : " (end)");
        list.appendChild(item);
      }
      target.appendChild(list);
    }
    draw(layout, definitions) {
      const { svg } = B;
      const drawing = svg("svg", { width: "100%", height: "100%", role: "group", "aria-label": this.a("title", "Flowchart") });
      const markerId = "flow-arrow-" + Math.random().toString(36).slice(2);
      const defs = svg("defs", {}, drawing);
      const marker = svg("marker", { id: markerId, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "userSpaceOnUse" }, defs);
      svg("path", { d: "M0,0 L8,4 L0,8 Z", fill: "var(--muted)" }, marker);
      this._layer = svg("g", {}, drawing);
      // ELK lays out node bounding boxes. Decision ports must meet the diamond itself,
      // not stop in the empty corners of its rectangle (especially on loops/branches).
      const portOnShape = (point, id) => {
        const node = layout.children.find((n) => n.id === id);
        const def = definitions.find((n) => n.id === id);
        if (!node || def?.node.kind !== "decision") return point;
        const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
        if (Math.abs(point.y - node.y) < 1 || Math.abs(point.y - node.y - node.height) < 1) {
          const half = node.height / 2 * (1 - Math.abs(point.x - cx) / (node.width / 2));
          return { x: point.x, y: cy + (point.y < cy ? -half : half) };
        }
        const half = node.width / 2 * (1 - Math.abs(point.y - cy) / (node.height / 2));
        return { x: cx + (point.x < cx ? -half : half), y: point.y };
      };
      for (const edge of layout.edges || []) {
        for (const section of edge.sections || []) {
          const points = [portOnShape(section.startPoint, edge.sources?.[0]), ...(section.bendPoints || []), portOnShape(section.endPoint, edge.targets?.[0])];
          svg("path", { d: points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" "), class: "flow-edge", "marker-end": `url(#${markerId})` }, this._layer);
        }
        for (const label of edge.labels || []) {
          svg("rect", { x: label.x, y: label.y, width: label.width, height: label.height, rx: 4, class: "flow-edge-label-bg" }, this._layer);
          const text = svg("text", { x: label.x + label.width / 2, y: label.y + 16, "text-anchor": "middle", class: "flow-edge-label" }, this._layer);
          (label.lines || [label.text]).forEach((line, i) => { svg("tspan", { x: label.x + label.width / 2, dy: i ? 18 : 0 }, text).textContent = line; });
        }
      }
      for (const node of layout.children) {
        const def = definitions.find((n) => n.id === node.id);
        const g = svg("g", { transform: `translate(${node.x},${node.y})`, "data-node": node.id, tabindex: 0, role: "button", "aria-label": def.node.label, class: "flow-node" }, this._layer);
        const w = node.width, h = node.height;
        if (def.node.kind === "decision") svg("polygon", { points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`, class: "flow-shape" }, g);
        else svg("rect", { width: w, height: h, rx: def.node.kind === "terminal" ? h / 2 : 12, class: "flow-shape" }, g);
        const text = svg("text", { x: w / 2, y: h / 2 - (def.lines.length - 1) * 10 + 5, "text-anchor": "middle", class: "flow-node-label" }, g);
        def.lines.forEach((line, i) => { svg("tspan", { x: w / 2, dy: i ? 20 : 0 }, text).textContent = line; });
        const select = () => {
          this._touched = true; this._zoom = Math.max(1, this._zoom);
          this._pan = { x: this._view.clientWidth / 2 - (node.x + w / 2) * this._zoom, y: this._view.clientHeight / 2 - (node.y + h / 2) * this._zoom };
          this.transform(); this._value = node.id;
          this.dispatchEvent(new Event("change", { bubbles: true }));
        };
        g.addEventListener("click", select);
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
      }
      this._size = { w: layout.width, h: layout.height };
      this._drawing = drawing; this._view.replaceChildren(drawing);
      if (!this._touched) this.fit(false); else this.transform();
    }
    get value() { return this._value || null; }
    fit(full) {
      if (!this._size || !this._view.clientWidth) return;
      const z = Math.min((this._view.clientWidth - 16) / this._size.w, (this._view.clientHeight - 16) / this._size.h, 1);
      this._zoom = full ? Math.max(0.03, z) : Math.max(0.8, z);
      this._pan = { x: Math.max(8, (this._view.clientWidth - this._size.w * this._zoom) / 2), y: Math.max(8, (this._view.clientHeight - this._size.h * this._zoom) / 2) };
      this.transform();
    }
    zoom(factor) {
      const next = Math.max(0.03, Math.min(4, this._zoom * factor)), ratio = next / this._zoom;
      this._pan.x = this._view.clientWidth / 2 - (this._view.clientWidth / 2 - this._pan.x) * ratio;
      this._pan.y = this._view.clientHeight / 2 - (this._view.clientHeight / 2 - this._pan.y) * ratio;
      this._zoom = next; this.transform();
    }
    transform() {
      if (this._layer) this._layer.setAttribute("transform", `translate(${this._pan.x},${this._pan.y}) scale(${this._zoom})`);
      this.querySelector("output").textContent = Math.round(this._zoom * 100) + "%";
    }
  });
})();
