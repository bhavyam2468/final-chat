/* Shared Blocks contract: loaded as a browser script and imported by server validation/catalog.
 * Add metadata here when registering an element. Browser tests verify registry/renderer parity.
 * No DOM or model calls: validation is deterministic and safe on the server. */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./flow-core.js") : root.BlocksFlow);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BlocksSchema = api;
})(globalThis, function (flow) {
  "use strict";
  const registry = {
  "x-stack": {
    "tags": "layout container arrange row column grid responsive",
    "usage": "<x-row>\u2026</x-row> wraps; <x-grid cols=\"3\"> (reflows to fit its own width)",
    "container": true
  },
  "x-row": {
    "tags": "layout container arrange row column grid responsive",
    "usage": "<x-row>\u2026</x-row> wraps; <x-grid cols=\"3\"> (reflows to fit its own width)",
    "container": true
  },
  "x-col": {
    "tags": "layout container arrange row column grid responsive",
    "usage": "<x-row>\u2026</x-row> wraps; <x-grid cols=\"3\"> (reflows to fit its own width)",
    "container": true
  },
  "x-grid": {
    "tags": "layout container arrange row column grid responsive",
    "usage": "<x-row>\u2026</x-row> wraps; <x-grid cols=\"3\"> (reflows to fit its own width)",
    "container": true,
    "attrs": {
      "cols": {
        "type": "integer",
        "min": 1,
        "max": 12
      }
    }
  },
  "x-card": {
    "tags": "layout box panel group container",
    "usage": "<x-card title=\"Totals\" tone=\"success\">\u2026</x-card>",
    "container": true
  },
  "x-section": {
    "tags": "layout heading section group subtitle",
    "usage": "<x-section title=\"Part A\" subtitle=\"Physics\">\u2026</x-section>",
    "container": true
  },
  "x-divider": {
    "tags": "layout separator line rule space",
    "usage": "<x-divider label=\"or\"> \u00b7 <x-spacer> pushes siblings apart in x-row",
    "void": true
  },
  "x-spacer": {
    "tags": "layout separator line rule space",
    "usage": "<x-divider label=\"or\"> \u00b7 <x-spacer> pushes siblings apart in x-row",
    "void": true
  },
  "x-tabs": {
    "tags": "layout tabs views switch sections",
    "usage": "<x-tabs><x-tab label=\"Chart\">\u2026</x-tab><x-tab label=\"Data\">\u2026</x-tab></x-tabs> .index",
    "container": true
  },
  "x-deck": {
    "tags": "pages slides wizard steps paging next previous quiz test flashcards carousel one at a time",
    "usage": "<x-deck id=\"d\" nav=\"numbers|dots|steps|none\" loop><x-slide label=\"Q1\">\u2026</x-slide>\u2026</x-deck> d.next() d.prev() d.go(i) d.index d.count; nav marks slides whose inputs are answered; x-slide tone=\"warning\" flags",
    "container": true,
    "attrs": {
      "nav": {
        "enum": [
          "numbers",
          "dots",
          "steps",
          "none"
        ]
      }
    }
  },
  "x-md": {
    "tags": "markdown text rich body prose",
    "usage": "<x-md>**bold**, lists, tables</x-md>"
  },
  "x-code": {
    "tags": "code snippet syntax highlight copy",
    "usage": "<x-code lang=\"python\">print(1)</x-code>"
  },
  "x-callout": {
    "tags": "note tip warning info alert hint explanation",
    "usage": "<x-callout tone=\"warning\" title=\"Careful\">\u2026</x-callout>",
    "container": true
  },
  "x-kv": {
    "tags": "key value properties details summary facts",
    "usage": "<x-kv>Mass: 2 kg\nSpeed: 3 m/s</x-kv>"
  },
  "x-badge": {
    "tags": "label tag status pill keyboard shortcut icon lucide",
    "usage": "<x-badge tone=\"success\">Done</x-badge> <x-kbd>Ctrl</x-kbd> <x-icon name=\"flame\">"
  },
  "x-kbd": {
    "tags": "label tag status pill keyboard shortcut icon lucide",
    "usage": "<x-badge tone=\"success\">Done</x-badge> <x-kbd>Ctrl</x-kbd> <x-icon name=\"flame\">"
  },
  "x-icon": {
    "tags": "label tag status pill keyboard shortcut icon lucide",
    "usage": "<x-badge tone=\"success\">Done</x-badge> <x-kbd>Ctrl</x-kbd> <x-icon name=\"flame\">",
    "void": true
  },
  "x-stat": {
    "tags": "number kpi metric value dashboard score",
    "usage": "<x-stat value=\"{{score}}\" label=\"Score\" delta=\"+3%\" unit=\"pts\"> (animates count-up)",
    "void": true
  },
  "x-progress": {
    "tags": "progress bar percentage completion",
    "usage": "<x-progress :value=\"done\" :max=\"total\" tone=\"success\">",
    "void": true,
    "attrs": {
      "value": {
        "type": "number"
      },
      "max": {
        "type": "number",
        "exclusiveMin": 0
      }
    }
  },
  "x-ring": {
    "tags": "progress circle radial gauge meter percentage",
    "usage": "<x-ring value=\"0.7\" label=\"70%\"> <x-gauge value=\"72\" min=\"0\" max=\"100\" label=\"km/h\">",
    "void": true,
    "attrs": {
      "value": {
        "type": "number"
      },
      "max": {
        "type": "number",
        "exclusiveMin": 0
      }
    }
  },
  "x-gauge": {
    "tags": "progress circle radial gauge meter percentage",
    "usage": "<x-ring value=\"0.7\" label=\"70%\"> <x-gauge value=\"72\" min=\"0\" max=\"100\" label=\"km/h\">",
    "void": true,
    "attrs": {
      "value": {
        "type": "number"
      },
      "min": {
        "type": "number"
      },
      "max": {
        "type": "number"
      }
    }
  },
  "x-chart": {
    "tags": "data visualization chart line bar hbar stacked area pie donut scatter radar trend compare histogram share",
    "usage": "<x-chart type=\"line|bar|hbar|stacked|area|pie|donut|scatter|radar\" data=\"1,3,2|2,2,4\" labels=\"a,b,c\" series=\"A|B\" title=\"\" x-label=\"\" y-label=\"\" center=\"(donut)\"> scatter data=\"1:2,3:4\"; data may be JSON; bind with :data=\"json(arr)\"",
    "void": true,
    "attrs": {
      "type": {
        "enum": [
          "line",
          "bar",
          "hbar",
          "stacked",
          "area",
          "pie",
          "donut",
          "scatter",
          "radar"
        ]
      }
    }
  },
  "x-sparkline": {
    "tags": "tiny inline trend chart",
    "usage": "<x-sparkline data=\"1,4,2,5\">",
    "void": true
  },
  "x-table": {
    "tags": "table data csv grid rows sortable",
    "usage": "<x-table sortable>name,score\\nA,3</x-table> or csv=\"\u2026\" or :data=\"json(rows)\" (array of objects or arrays)"
  },
  "x-heatmap": {
    "tags": "heatmap matrix grid intensity calendar correlation",
    "usage": "<x-heatmap data=\"1,2,3|4,5,6\" x-labels=\"a,b,c\" y-labels=\"r1,r2\">",
    "void": true
  },
  "x-timeline": {
    "tags": "timeline history events chronology schedule",
    "usage": "<x-timeline>1905 | Relativity | special theory\n1915 | GR</x-timeline>"
  },
  "x-math": {
    "tags": "math latex equation formula tex",
    "usage": "<x-math tex=\"\\int_0^1 x^2 dx\"> or $inline$ / $$display$$ in any text"
  },
  "x-graph": {
    "tags": "math function graph desmos plot curve calculus trigonometry polar parametric slider interactive",
    "usage": "<x-graph fn=\"y=a*sin(b*x); x^2/4\" xmin=\"-6\" xmax=\"6\" points=\"0,0,O\"> free letters bind to inputs: <input type=\"range\" name=\"a\" min=\"0\" max=\"5\" step=\"0.1\">; r=1+cos(theta); x=cos(t),y=sin(t); equal = 1:1 axes; drag pans, wheel zooms, dblclick resets",
    "attrs": {
      "xmin": {
        "type": "number"
      },
      "xmax": {
        "type": "number"
      },
      "ymin": {
        "type": "number"
      },
      "ymax": {
        "type": "number"
      },
      "tmin": {
        "type": "number"
      },
      "tmax": {
        "type": "number"
      },
      "height": {
        "type": "number"
      }
    }
  },
  "x-smiles": {
    "tags": "chemistry molecule organic structure smiles 2d compound",
    "usage": "<x-smiles smiles=\"CC(=O)Oc1ccccc1C(=O)O\" label=\"Aspirin\">",
    "void": true
  },
  "x-mol3d": {
    "tags": "chemistry molecule 3d structure protein pubchem pdb rotate",
    "usage": "<x-mol3d name=\"caffeine\"> or cid=\"2519\" smiles=\"\u2026\" pdb=\"1CRN\"; still = no spin",
    "void": true
  },
  "x-draw": {
    "tags": "physics diagram pulley spring incline mass force arrow vector geometry circuit optics wave drawing",
    "usage": "<x-draw w=\"320\" h=\"200\">ground 180\\nincline 40 80 200 100\\nmass 150 110 \"m\"\\narrow 150 110 150 160 \"mg\"\\nangle 240 180 30 150 180 \"\u03b8\"</x-draw>"
  },
  "x-tikz": {
    "tags": "tikz latex physics diagram free body force pulley incline circuit circuitikz geometry pgfplots feynman chemfig commutative textbook figure",
    "usage": "<x-tikz caption=\"Atwood machine\">\\draw[thick] (0,0) circle (0.5); \\draw (-0.5,0) -- (-0.5,-2) node[below]{$m_1$};</x-tikz> Body = TikZ commands, a tikzpicture, or a full document; rendered on the server to a theme-aware SVG (black\u2192text colour, grey tints\u2192background mix). Packages: circuitikz pgfplots tikz-cd tikz-3dplot chemfig tikz-feynhand; libraries arrows.meta calc positioning patterns decorations angles quotes. Best for physics, circuits, geometry: textbook-quality, labels never overlap if you place them with anchors (above/below/left/right). TeX errors show in the block."
  },
  "x-mermaid": {
    "tags": "flowchart diagram sequence mindmap process tree org chart state",
    "usage": "<x-mermaid>flowchart LR\nA-->B</x-mermaid>"
  },
  "x-todo": {
    "tags": "checklist todo tasks plan steps study plan tick checkbox",
    "usage": "<x-todo name=\"plan\" title=\"Week 1\" add>- [x] Read ch. 1\\n- [ ] Problems 1-10</x-todo> .value=[{text,done}] .done .total; add = user can add/remove; change event"
  },
  "x-timer": {
    "tags": "time timer countdown stopwatch exam test deadline",
    "usage": "<x-timer id=\"t\" seconds=\"3600\" autostart @done=\"submit()\"> t.start() t.stop() t.toggle() t.reset(s); t.left t.elapsed t.running; events tick, done; mode=\"up\" counts up; :seconds=\"expr\" re-arms when it changes (keep-running = continue if it was running)",
    "void": true,
    "attrs": {
      "seconds": {
        "type": "number",
        "min": 0,
        "max": 31536000
      },
      "mode": {
        "enum": [
          "down",
          "up"
        ]
      }
    }
  },
  "x-stopwatch": {
    "tags": "time timer countdown stopwatch exam test deadline",
    "usage": "<x-timer id=\"t\" seconds=\"3600\" autostart @done=\"submit()\"> t.start() t.stop() t.toggle() t.reset(s); t.left t.elapsed t.running; events tick, done; mode=\"up\" counts up; :seconds=\"expr\" re-arms when it changes (keep-running = continue if it was running)",
    "void": true,
    "attrs": {
      "seconds": {
        "type": "number",
        "min": 0,
        "max": 31536000
      }
    }
  },
  "x-clock": {
    "tags": "time clock analog dial",
    "usage": "<x-clock> live \u00b7 time=\"14:30\" \u00b7 for=\"t\" mirrors a timer",
    "void": true
  },
  "x-choice": {
    "tags": "quiz mcq multiple choice options question answer test exam select",
    "usage": "<x-choice name=\"q1\" answer=\"B\" reveal? lock? multi? layout=\"grid\">option A\noption B\noption C</x-choice> or options=\"A|B|C\"; answer = text, letter or 1-based index; .value .index .correct .answered; :reveal=\"submitted\" shows right/wrong; other = free-text answer row, skip = Skip link (value \"skipped\")"
  },
  "x-segmented": {
    "tags": "input choice switch boolean mode options",
    "usage": "<x-segmented name=\"mode\" options=\"Day,Week\" value=\"Day\"> <x-toggle name=\"grid\" checked>"
  },
  "x-toggle": {
    "tags": "input choice switch boolean mode options",
    "usage": "<x-segmented name=\"mode\" options=\"Day,Week\" value=\"Day\"> <x-toggle name=\"grid\" checked>",
    "void": true
  },
  "x-rating": {
    "tags": "rating stars feedback score",
    "usage": "<x-rating name=\"r\" max=\"5\">",
    "void": true,
    "attrs": {
      "max": {
        "type": "integer",
        "min": 1,
        "max": 20
      }
    }
  },
  "x-sortable": {
    "tags": "order rank sort drag reorder sequence",
    "usage": "<x-sortable name=\"order\">first\nsecond\nthird</x-sortable> value = array in current order"
  },
  "x-sketch": {
    "tags": "draw sketch handwriting canvas whiteboard scratchpad",
    "usage": "<x-sketch name=\"work\"> value = PNG data URL"
  },
  "x-upload": {
    "tags": "file upload attach input",
    "usage": "<x-upload name=\"f\" accept=\"image/*\" dir=\"uploads\"> value = workspace path"
  },
  "x-image": {
    "tags": "media image picture gif video audio sound",
    "usage": "<x-image src=\"uploads/a.png\" caption=\"\"> (workspace paths or URLs)",
    "void": true
  },
  "x-video": {
    "tags": "media image picture gif video audio sound",
    "usage": "<x-image src=\"uploads/a.png\" caption=\"\"> (workspace paths or URLs)",
    "void": true
  },
  "x-audio": {
    "tags": "media image picture gif video audio sound",
    "usage": "<x-image src=\"uploads/a.png\" caption=\"\"> (workspace paths or URLs)",
    "void": true
  },
  "x-youtube": {
    "tags": "media youtube video embed iframe map location geography",
    "usage": "<x-youtube id=\"dQw4w9WgXcQ\" start=\"30\"> <x-embed src=\"https://\u2026\" height=\"400\"> <x-map markers=\"28.6,77.2,Delhi|19,72.8,Mumbai\">",
    "void": true
  },
  "x-embed": {
    "tags": "media youtube video embed iframe map location geography",
    "usage": "<x-youtube id=\"dQw4w9WgXcQ\" start=\"30\"> <x-embed src=\"https://\u2026\" height=\"400\"> <x-map markers=\"28.6,77.2,Delhi|19,72.8,Mumbai\">",
    "void": true
  },
  "x-map": {
    "tags": "media youtube video embed iframe map location geography",
    "usage": "<x-youtube id=\"dQw4w9WgXcQ\" start=\"30\"> <x-embed src=\"https://\u2026\" height=\"400\"> <x-map markers=\"28.6,77.2,Delhi|19,72.8,Mumbai\">",
    "void": true
  },
  "x-state": {
    "tags": "state variables initial data reactive store",
    "usage": "<x-state score=\"0\" submitted=\"false\" answers=\"{}\">",
    "void": true
  },
  "x-tab": {
    "tags": "layout tabs panel",
    "usage": "<x-tab label=\"Details\">\u2026</x-tab> inside x-tabs",
    "container": true
  },
  "x-slide": {
    "tags": "layout deck page slide",
    "usage": "<x-slide label=\"Question\">\u2026</x-slide> inside x-deck",
    "container": true
  },
  "x-plot": {
    "tags": "math function graph desmos plot curve calculus trigonometry polar parametric slider interactive",
    "usage": "<x-graph fn=\"y=a*sin(b*x); x^2/4\" xmin=\"-6\" xmax=\"6\" points=\"0,0,O\"> free letters bind to inputs: <input type=\"range\" name=\"a\" min=\"0\" max=\"5\" step=\"0.1\">; r=1+cos(theta); x=cos(t),y=sin(t); equal = 1:1 axes; drag pans, wheel zooms, dblclick resets",
    "attrs": {
      "xmin": {
        "type": "number"
      },
      "xmax": {
        "type": "number"
      },
      "ymin": {
        "type": "number"
      },
      "ymax": {
        "type": "number"
      },
      "tmin": {
        "type": "number"
      },
      "tmax": {
        "type": "number"
      },
      "height": {
        "type": "number"
      }
    }
  },
  "x-flowchart": {
    "tags": "flowchart diagram process algorithm decision branch tree flow structure",
    "usage": "<x-flowchart direction=\"down\" title=\"Process\">A[\"Read\"] --> B{\"Understood?\"}\nB -->|Yes| C[\"Practice\"]\nB -->|No| A</x-flowchart> Native auto-layout; down/right/up/left; nodes [], {}, (); labeled --> edges; define every node. No coordinates, styling, or scripts.",
    "attrs": {
      "direction": {
        "enum": [
          "down",
          "right",
          "up",
          "left",
          "TD",
          "TB",
          "LR",
          "BT",
          "RL"
        ]
      },
      "height": {
        "type": "number",
        "min": 160,
        "max": 1200
      }
    }
  },
  "x-split": {
    "tags": "layout responsive weighted split row column ratios arrangement",
    "usage": "<x-split weights=\"2:1\" min=\"240\"><x-block>\u2026</x-block><x-col>\u2026</x-col></x-split> axis=\"horizontal|vertical\"; stacks when children cannot fit. Weights never change typography.",
    "container": true,
    "attrs": {
      "axis": {
        "enum": [
          "horizontal",
          "vertical"
        ]
      },
      "min": {
        "type": "number",
        "min": 80,
        "max": 1000
      }
    }
  },
  "x-block": {
    "tags": "layout reusable composition scope state block elements",
    "usage": "<x-block id=\"focus\" title=\"Focus\" x-data=\"{count:0}\">\u2026</x-block> Scoped state, named inputs and references; no card chrome unless surface=\"card\". Use a stable id.",
    "container": true,
    "attrs": {
      "surface": {
        "enum": [
          "plain",
          "card"
        ]
      }
    }
  }
};
  registry["x-grid"].attrs.min = { type: "number", min: 80, max: 1000 };
  registry["x-grid"].usage += " Optional min=180: minimum cell width before reflow; measures its own container.";
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  function attributes(source) {
    const out = {};
    for (const m of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1]] = decode(m[2] ?? m[3] ?? m[4] ?? "");
    return out;
  }
  function attributeIssues(tag, attrs, names = new Set()) {
    const issues = [];
    for (const [key, rule] of Object.entries(registry[tag]?.attrs || {})) {
      const v = attrs[key];
      if (v === undefined || v.includes("{{") || names.has(v)) continue;
      if (rule.enum && !rule.enum.includes(v)) issues.push(`${tag}.${key}: expected ${rule.enum.join(" | ")}, got ${JSON.stringify(v)}`);
      if (rule.type) {
        const n = Number(v);
        if (v.trim() === "" || !Number.isFinite(n) || (rule.type === "integer" && !Number.isInteger(n)) || (rule.min !== undefined && n < rule.min) || (rule.max !== undefined && n > rule.max) || (rule.exclusiveMin !== undefined && n <= rule.exclusiveMin))
          issues.push(`${tag}.${key}: invalid ${rule.type} ${JSON.stringify(v)}`);
      }
    }
    if (tag === "x-split" && attrs.weights && !/^\s*\d+(?:\.\d+)?(?:\s*[:,]\s*\d+(?:\.\d+)?)*\s*$/.test(attrs.weights)) issues.push("x-split.weights: use positive weights such as 2:1");
    if (tag === "x-split" && attrs.weights && attrs.weights.split(/[:,]/).some((v) => Number(v) <= 0)) issues.push("x-split.weights: weights must be positive");
    return issues;
  }
  // Owning elements treat their body as data, not HTML. Scripts/styles must never be scanned as tags.
  const raw = new Set("script style x-code x-md x-draw x-tikz x-mermaid x-flowchart x-table x-kv x-timeline x-todo x-sortable x-choice".split(" "));
  function validate(source) {
    const issues = [], stack = [], ids = new Set(), names = new Set();
    // Names declared in state/data/inputs are legal soft bindings on numeric attributes.
    for (const m of source.matchAll(/<(x-state|input|select|textarea|script)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
      const a = attributes(m[2]);
      if (m[1] === "x-state") Object.keys(a).forEach((k) => names.add(k));
      else if (a.name) names.add(a.name);
    }
    for (const m of source.matchAll(/\bx-data\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      for (const key of decode(m[1] ?? m[2]).matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/g)) names.add(key[1]);
    }
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let m;
    while ((m = re.exec(source))) {
      if (!m[2]) continue;
      const tag = m[2].toLowerCase(), spec = registry[tag];
      if (m[1]) {
        if (spec && !spec.void || tag === "ui" || tag === "canvas") {
          if (stack[stack.length - 1] !== tag) issues.push(`Unexpected </${tag}>; expected ${stack.length ? '</' + stack[stack.length - 1] + '>' : 'an opening tag'}`);
          const i = stack.lastIndexOf(tag); if (i !== -1) stack.splice(i);
        }
        continue;
      }
      const attrs = attributes(m[3]);
      if (tag.startsWith("x-") && !spec) issues.push(`unknown component <${tag}>. Use ui_search for supported components.`);
      if (attrs.id && !attrs.id.includes("{{")) { if (ids.has(attrs.id)) issues.push(`Duplicate id "${attrs.id}"; give each element a unique id`); ids.add(attrs.id); }
      issues.push(...attributeIssues(tag, attrs, names));
      if ((tag === "x-tab" && stack.at(-1) !== "x-tabs") || (tag === "x-slide" && stack.at(-1) !== "x-deck")) issues.push(`${tag} must be inside ${tag === 'x-tab' ? 'x-tabs' : 'x-deck'}`);
      const selfClosed = /\/\s*$/.test(m[3]);
      if (raw.has(tag) && !selfClosed) {
        const close = new RegExp(`</${tag}\\s*>`, "ig"); close.lastIndex = re.lastIndex;
        const end = close.exec(source);
        if (!end) { issues.push(`unclosed <${tag}>`); break; }
        if (tag === "x-flowchart" && !attrs[":data"] && !attrs.data?.includes("{{")) {
          try { flow.parse(attrs.data || decode(source.slice(re.lastIndex, end.index)), attrs.direction); }
          catch (e) { issues.push("x-flowchart: " + e.message); }
        }
        re.lastIndex = close.lastIndex;
      } else if (!selfClosed && ((spec && !spec.void) || tag === "ui" || tag === "canvas")) stack.push(tag);
    }
    stack.reverse().forEach((tag) => issues.push(`unclosed <${tag}>`));
    return [...new Set(issues)].slice(0, 12);
  }
  const guides = {
    "native inputs": { tags: "form input text number range slider date color checkbox radio select textarea button submit", usage: '<label>Mass <input type="range" name="m" min="1" max="10" value="2"></label> <button @click="sendToLm(form())">Send</button>; form(selector) collects only that form; x-block scopes repeated names.' },
    "bindings": { tags: "reactive binding each loop repeat key show hide if condition click event handler template interpolation", usage: '{{expr}} :attr="expr" show="expr" each="(item,i) in items" :key="item.id" @click="count++"; <x-block x-data="{count:0}"> gives local state; stable keys preserve editable nodes on reorder.' },
    "backend": { tags: "backend python shell bash process streaming live resource cancellation abort", usage: "await backend(kind, input, opts); backendStream(kind,input,onChunk,opts) returns a promise with .cancel(); opts.signal accepts AbortSignal. kind: python|bash|process|resource. Execution uses the app's configured workspace permissions." }
  };
  return { registry, guides, attributes, attributeIssues, validate };
});
