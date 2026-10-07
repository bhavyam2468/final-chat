/** Cheap structural check for a `<ui>` block. One repair round, not a second opinion on design. */

const X = new Set([
  "x-stack", "x-row", "x-col", "x-grid", "x-card", "x-section", "x-divider", "x-spacer",
  "x-tabs", "x-tab", "x-deck", "x-slide", "x-md", "x-code", "x-callout", "x-kv",
  "x-badge", "x-kbd", "x-icon", "x-stat", "x-progress", "x-ring", "x-gauge",
  "x-chart", "x-sparkline", "x-table", "x-heatmap", "x-timeline", "x-math", "x-graph", "x-plot",
  "x-smiles", "x-mol3d", "x-draw", "x-tikz", "x-mermaid", "x-flow", "x-tree", "x-list", "x-todo", "x-timer", "x-stopwatch", "x-clock",
  "x-choice", "x-segmented", "x-toggle", "x-rating", "x-sortable", "x-sketch", "x-upload",
  "x-image", "x-video", "x-audio", "x-youtube", "x-embed", "x-map", "x-state",
]);

/** Models wrap `<ui>` in a fence and the user sees source. Lift those fences; leave real code alone. */
export function liftFences(text: string): string {
  return text.replace(/```[^\n]*\n([\s\S]*?)```/g, (full, body: string) => (/<(?:ui|canvas)\b/.test(body) ? body.trim() : full));
}

export function uiIssues(text: string): string[] {
  const issues: string[] = [];
  if ([...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].some((m) => /<(?:ui|canvas)\b/.test(m[1]))) issues.push("<ui> or <canvas> is inside a code fence, so it renders as source. Emit the tags raw.");
  const blocks = [...text.matchAll(/<ui\b[^>]*>([\s\S]*?)<\/ui>/g)].map((m) => m[1]);
  for (const b of blocks) {
    for (const t of new Set([...b.matchAll(/<\/?(x-[a-z0-9-]+)\b/g)].map((m) => m[1]))) {
      if (!X.has(t)) issues.push(`unknown component <${t}>. ui_search it, or use a tag from the system prompt.`);
    }
    for (const tag of ["x-card", "x-deck", "x-choice", "x-tabs", "x-stack", "x-row"]) {
      const self = (b.match(new RegExp(`<${tag}\\b[^>]*/>`, "g")) || []).length;
      const open = (b.match(new RegExp(`<${tag}\\b`, "g")) || []).length - self;
      const close = (b.match(new RegExp(`</${tag}>`, "g")) || []).length;
      if (open !== close) issues.push(`unclosed <${tag}> (${open} open, ${close} close)`);
    }
    if (/querySelector\(\s*['"]x-timer|x-timer['"]\s*\)|\.left\b/.test(b) && !/<x-timer\b/.test(b)) issues.push("the script reads a timer, but there is no <x-timer>. Add <x-timer id=\"t\" seconds=\"…\"> and call t.toggle() / t.reset().");
    if (/https?:\/\/(?:cdn\.|unpkg\.|jsdelivr|cdnjs)/i.test(b)) issues.push("the block loads a CDN script. Built-in components run offline; don't fetch a library.");
    if (/\bmatplotlib\b/.test(b)) issues.push("matplotlib does not render in a block. Use <x-chart> or <x-graph>.");
  }
  return [...new Set(issues)].slice(0, 6);
}
