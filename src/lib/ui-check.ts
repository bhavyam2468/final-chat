/** Cheap structural check for a `<ui>` block. One repair round, not a second opinion on design. */

import schema from "../../public/blocks/schema.js";

/** Models wrap `<ui>` in a fence and the user sees source. Lift those fences; leave real code alone. */
export function liftFences(text: string): string {
  return text.replace(/```[^\n]*\n([\s\S]*?)```/g, (full, body: string) => (/<(?:ui|canvas)\b/.test(body) ? body.trim() : full));
}

export function uiIssues(text: string): string[] {
  const issues: string[] = [];
  if ([...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].some((m) => /<(?:ui|canvas)\b/.test(m[1]))) issues.push("<ui> or <canvas> is inside a code fence, so it renders as source. Emit the tags raw.");
  const blocks = [...text.matchAll(/<ui\b[^>]*>([\s\S]*?)(?:<\/ui>|$)/g)].map((m) => m[0]);
  for (const b of blocks) {
    issues.push(...schema.validate(b));
    if (/querySelector\(\s*['"]x-timer|x-timer['"]\s*\)|\.left\b/.test(b) && !/<x-timer\b/.test(b)) issues.push("the script reads a timer, but there is no <x-timer>. Add <x-timer id=\"t\" seconds=\"…\"> and call t.toggle() / t.reset().");
    if (/https?:\/\/(?:cdn\.|unpkg\.|jsdelivr|cdnjs)/i.test(b)) issues.push("the block loads a CDN script. Built-in components run offline; don't fetch a library.");
    if (/\bmatplotlib\b/.test(b)) issues.push("matplotlib does not render in a block. Use <x-chart> or <x-graph>.");
  }
  return [...new Set(issues)].slice(0, 6);
}
