/*
 * Templates: the format, and the shipped library as a whole.
 *
 * No server, no renderer: this checks the rules a template has to keep — parse, front matter, vars that match
 * the body, the kind's fence, and (for blocks) that the shipped shell passes the same structural check the app
 * runs before it renders one. Whether a *circuit* compiles is checked in dev/templates-e2e.mjs, against the
 * real engine.
 */
import fs from "node:fs";
import path from "node:path";
import { bodyVars, fillTemplate, parseTemplate, publicTemplate, scoreTemplate, templateText } from "../../src/lib/template-format.ts";
import { uiIssues } from "../../src/lib/ui-check.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown, diag?: unknown) => {
  if (cond) { pass++; console.log("ok  ", name); }
  else { fail++; console.log("FAIL", name, diag === undefined ? "" : `→ ${typeof diag === "string" ? diag : JSON.stringify(diag)}`); }
};

const SAMPLE = `---
name: demo-thing
kind: circuit
title: Demo thing
description: A demo used by the tests.
tags: demo, test
vars:
  - a | first input | A
  - b | second input | B
---
Prose about {{a}} and {{b}}.

\`\`\`tex
\\draw (0,0) -- ({{a}},{{b}});
\`\`\`
`;

const def = parseTemplate(SAMPLE, "/tmp/demo");
ok("front matter: name, kind, title, description", def.name === "demo-thing" && def.kind === "circuit" && def.title === "Demo thing" && def.description === "A demo used by the tests.");
ok("tags are split and lowercased", def.tags.join("|") === "demo|test", def.tags);
ok("vars are read with their example", def.vars.length === 2 && def.vars[0].name === "a" && def.vars[0].example === "A", def.vars);
ok("the artefact is the fence of the kind's language", def.code === "\\draw (0,0) -- ({{a}},{{b}});", def.code);
ok("bodyVars finds the placeholders in order", bodyVars(def.body).join(",") === "a,b", bodyVars(def.body));
ok("publicTemplate never leaks the source", !("body" in publicTemplate(def)) && !("code" in publicTemplate(def)));

const filled = fillTemplate(def.body, { b: "9" }, def.vars);
ok("a given value wins, a missing one falls back to its example", filled.text.includes("about A and 9.") && filled.usedExample.join(",") === "a", filled);
const short = parseTemplate(SAMPLE.replace("  - a | first input | A\n", ""), "/tmp/demo");
const nothing = fillTemplate(short.body, {}, short.vars);
ok("with no example and no value the placeholder stays, and is reported", nothing.missing.join(",") === "a" && nothing.text.includes("{{a}}"), nothing);

let bad = "";
try { parseTemplate("no front matter here", "/tmp/x"); } catch (e) { bad = String((e as Error).message); }
ok("front matter is required", /front matter/.test(bad), bad);
bad = "";
try { parseTemplate(SAMPLE.replace("kind: circuit", "kind: painting"), "/tmp/x"); } catch (e) { bad = String((e as Error).message); }
ok("the kind is checked", /circuit, block, doc/.test(bad), bad);
bad = "";
try { parseTemplate(SAMPLE.replace("description: A demo used by the tests.\n", ""), "/tmp/x"); } catch (e) { bad = String((e as Error).message); }
ok("a description is required (it is what a search shows)", /description/.test(bad), bad);

const back = parseTemplate(templateText({ name: "round-trip", kind: "block", title: "Round trip", description: "written from a spec", tags: "b, a", vars: [{ name: "x", label: "the x", example: "1" }], body: "Text {{x}}\n\n```html\n<x-stat :value=\"x\"></x-stat>\n```" }), "/tmp/rt");
ok("templateText → parseTemplate round-trips", back.name === "round-trip" && back.kind === "block" && back.vars[0]?.name === "x" && back.code.includes("x-stat"), back);
bad = "";
try { templateText({ name: "no body", kind: "doc", description: "d" }); } catch (e) { bad = String((e as Error).message); }
ok("a template with no body is refused", /body is required/.test(bad), bad);

const score = (q: string) => scoreTemplate(def, q);
ok("search ranks a name and a tag above prose", score("demo-thing") > score("thing") && score("test") > 0 && score("unrelated") === 0, { name: score("demo-thing"), tag: score("test"), none: score("unrelated") });

// ---------------------------------------------------------------- the shipped library
const ROOT = path.resolve("./workspace-template/templates");
const names = fs.readdirSync(ROOT).filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory()).sort();
ok("the library is not empty", names.length >= 12, names.length);

const kinds = new Map<string, number>();
const broken: string[] = [];
for (const name of names) {
  const file = path.join(ROOT, name, "template.md");
  let d;
  try { d = parseTemplate(fs.readFileSync(file, "utf8"), path.join(ROOT, name)); }
  catch (e) { broken.push(`${name}: ${(e as Error).message}`); continue; }
  kinds.set(d.kind, (kinds.get(d.kind) || 0) + 1);
  if (d.name !== name) broken.push(`${name}: front matter says "${d.name}"`);
  if (d.description.length < 20) broken.push(`${name}: description is too short to be useful in a search`);
  if (!d.tags.length) broken.push(`${name}: no tags`);
  const declared = new Set(d.vars.map((v) => v.name));
  for (const used of bodyVars(d.body)) if (!declared.has(used)) broken.push(`${name}: {{${used}}} is used but not declared`);
  for (const v of d.vars) {
    if (!bodyVars(d.body).includes(v.name)) broken.push(`${name}: var ${v.name} is declared but never used`);
    if (!v.example) broken.push(`${name}: var ${v.name} has no example (a preview would show braces)`);
  }
  if (d.kind === "circuit" && !d.code.includes("\\begin{circuitikz}")) broken.push(`${name}: a circuit needs a circuitikz source in its fence`);
  if (d.kind === "block" && !d.code.trim().startsWith("<x-")) broken.push(`${name}: a block template's fence should be the Blocks document`);
  if (d.kind === "doc" && d.code) broken.push(`${name}: a doc has no artefact fence`);
  if (d.kind === "block") {
    const problems = uiIssues(`<ui>\n${fillTemplate(d.code, {}, d.vars).text}\n</ui>`);
    if (problems.length) broken.push(`${name}: the block checker says ${problems.join(" · ")}`);
  }
}
ok("every shipped template parses, agrees with its front matter, uses its vars and fills its example", broken.length === 0, broken);
ok("all three kinds are represented", ["circuit", "block", "doc"].every((k) => (kinds.get(k) || 0) >= 2), [...kinds]);

// The engine itself is exercised in dev/templates-e2e.mjs (a real render per circuit); here the drawings must
// at least be well-formed environments, since a missing \end is the one failure that reads as "it works".
const lopsided = names.filter((n) => {
  const md = fs.readFileSync(path.join(ROOT, n, "template.md"), "utf8");
  if (!/^kind:\s*circuit/m.test(md)) return false;
  const opens = (md.match(/\\begin\{circuitikz\}/g) || []).length;
  const closes = (md.match(/\\end\{circuitikz\}/g) || []).length;
  return opens !== 1 || closes !== 1;
});
ok("every circuit is one balanced circuitikz environment", lopsided.length === 0, lopsided);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
