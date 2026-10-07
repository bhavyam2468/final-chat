// Run: node --experimental-strip-types dev/tests/workflows.test.ts
// The workflow file format and what a run's progress means — pure logic, no workspace writes. The runs
// themselves (search → read → agent, the report into the chat, the window) are covered by dev/workflows-e2e.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { agentBrief, parseWorkflow, progressOf, publicRun, workflowText, type WorkflowRun } from "../../src/lib/workflow-format.ts";

let n = 0;
const t = (name: string, f: () => void) => { try { f(); n++; console.log("ok", name); } catch (e) { console.log("FAIL", name); throw e; } };
const refuses = (text: string, why: RegExp) => {
  const dir = "/tmp/wf-test";
  assert.throws(() => parseWorkflow(text, dir), why);
};
const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: "r1", name: "x", title: "X", description: "", input: {}, chat: null, messageId: null, process: "",
  status: "running", startedAt: 0, endedAt: null, steps: [], sources: [], log: [], progress: 0, activity: "",
  report: "", artifacts: [], error: "", ...over,
});

// ---- the format
t("the shipped deep-research file parses", () => {
  const file = path.join(process.cwd(), "workspace-template/workflows/deep-research/workflow.md");
  const def = parseWorkflow(fs.readFileSync(file, "utf8"), path.dirname(file));
  assert.equal(def.name, "deep-research");
  assert.equal(def.inputs.length, 1);
  assert.equal(def.inputs[0].name, "question");
  assert.equal(def.inputs[0].required, true);
  assert.deepEqual(def.steps.map((s) => s.kind), ["search", "read", "agent"]);
  assert.equal(def.steps[0].opts.limit, "8");
  assert.equal(def.steps[0].title, "Find sources");
  assert.equal(def.steps[2].opts.expect, "8");
  assert.match(def.body, /receipts/);
});

t("a spec round-trips through the file and back", () => {
  const spec = {
    name: "price-watch", title: "Price watch", description: "Compares prices for a thing.",
    inputs: [{ name: "question", label: "What and where?" }, { name: "note", label: "Anything else", optional: true }],
    steps: [
      { kind: "search", title: "Find shops", opts: { query: "{{question}} price", limit: 5 } },
      { kind: "read", title: "Open the listings", opts: { limit: 6, parallel: 3 } },
      { kind: "agent", title: "Write the comparison", opts: { expect: 9 } },
    ],
    body: "# What this run is for\n\nCheapest first, with the date.",
  };
  const def = parseWorkflow(workflowText(spec), "/tmp/wf-test");
  assert.equal(def.name, "price-watch");
  assert.equal(def.description, "Compares prices for a thing.");
  assert.deepEqual(def.inputs, [
    { name: "question", label: "What and where?", required: true },
    { name: "note", label: "Anything else", required: false },
  ]);
  assert.deepEqual(def.steps.map((s) => [s.kind, s.title, s.opts]), [
    ["search", "Find shops", { query: "{{question}}price", limit: "5" }],
    ["read", "Open the listings", { limit: "6", parallel: "3" }],
    ["agent", "Write the comparison", { expect: "9" }],
  ]);
  assert.equal(def.body, "# What this run is for\n\nCheapest first, with the date.");
});

t("options with spaces would break a line, so they lose the spaces", () => {
  const def = parseWorkflow(workflowText({ name: "a", steps: [{ kind: "search", opts: { query: "two words" } }], body: "b" }), "/tmp/x");
  assert.equal(def.steps[0].opts.query, "twowords");
});

t("a step with no title is still named in the window", () => {
  const def = parseWorkflow(workflowText({ name: "a", steps: [{ kind: "read" }, { kind: "agent" }], body: "b" }), "/tmp/x");
  assert.deepEqual(def.steps.map((s) => s.title), ["Read", "Agent"]);
});

t("the name falls back to the folder, and the title to the name", () => {
  const def = parseWorkflow("---\nsteps:\n  - agent | Answer\n---\nbrief", "/tmp/wf-test/mine");
  assert.equal(def.name, "mine");
  assert.equal(def.title, "mine");
});

// ---- what the parser refuses (each of these has been a real mistake)
t("no front matter", () => refuses("# just a brief\n\nrun it", /front matter/));
t("an unknown step kind", () => refuses("---\nname: a\nsteps:\n  - browse | Look\n---\nb", /not a step kind/));
t("an agent step that is not last", () => refuses("---\nname: a\nsteps:\n  - agent | Think\n  - read | Open\n---\nb", /has to be last/));
t("two agent steps", () => refuses("---\nname: a\nsteps:\n  - agent | One\n  - search | Two\n  - agent | Three\n---\nb", /one agent step|has to be last/));
t("a list item outside a list", () => refuses("---\nname: a\n  - stray | Nope\nsteps:\n  - agent | Go\n---\nb", /outside a list/));
t("an unknown key", () => refuses("---\nname: a\nwhen: never\nsteps:\n  - agent | Go\n---\nb", /unknown key/));
t("an option that is not key=value", () => refuses("---\nname: a\nsteps:\n  - search 6 | Find\n---\nb", /key=value/));
t("an input name with a space", () => refuses("---\nname: a\ninputs:\n  - the question | Why?\nsteps:\n  - agent | Go\n---\nb", /single word/));
t("no steps at all", () => refuses("---\nname: a\ntitle: A\n---\nb", /no steps/));
t("a name that is not one word", () => refuses("---\nname: deep research\nsteps:\n  - agent | Go\n---\nb", /one word/));

// ---- progress: the bar has to mean something
t("a run that has started nothing is at zero", () => {
  assert.equal(progressOf(run()), 0);
  assert.equal(progressOf(run({ steps: [{ id: "0", title: "Find", kind: "search", status: "pending", note: "", detail: "", weight: 1, count: 0, target: 0 }] })), 0);
});
t("a finished step counts in full, the active one by what it has done", () => {
  const steps = [
    { id: "0-search", title: "Find", kind: "search", status: "done" as const, note: "", detail: "", weight: 1, count: 0, target: 0 },
    { id: "1-read", title: "Open", kind: "read", status: "active" as const, note: "", detail: "", weight: 1, count: 3, target: 6 },
    { id: "2-agent", title: "Write", kind: "agent", status: "pending" as const, note: "", detail: "", weight: 3, count: 0, target: 8 },
  ];
  // 1 done + half of the read step, over 5 units of weight
  assert.equal(Math.round(progressOf(run({ steps })) * 100), 30);
  // an active step never counts as finished, however much of its own work it has done
  steps[1].count = 6;
  const capped = progressOf(run({ steps }));
  assert.equal(Math.round(capped * 100), 39);
  assert.ok(capped < 0.4, "a step that has not reported done is not done");
  steps[1].status = "done"; steps[2].status = "active"; steps[2].count = 4;
  assert.equal(Math.round(progressOf(run({ steps })) * 100), 70);
});
t("a failed step is not nothing: it is half", () => {
  const steps = [{ id: "0", title: "Open", kind: "read", status: "failed" as const, note: "", detail: "", weight: 2, count: 0, target: 4 }];
  assert.equal(progressOf(run({ steps })), 0.5);
});

// ---- the brief the thinking step receives
t("the brief carries the inputs, the pages already fetched and the file's body", () => {
  const def = parseWorkflow("---\nname: a\ninputs:\n  - question | What?\nsteps:\n  - read | Open\n  - agent | Write\n---\nBe exact.", "/tmp/x");
  const r = run({
    input: { question: "why is the sky blue" },
    sources: [
      { url: "https://a.example/x", title: "A", snippet: "", read: true, words: 300, file: ".workflows/r1/pages/01.md" },
      { url: "https://b.example/y", title: "B", snippet: "refused", read: false },
    ],
    steps: [{ id: "0-read", title: "Open", kind: "read", status: "done", note: "", detail: "", weight: 1, count: 1, target: 1 }],
  });
  const brief = agentBrief(def, r);
  assert.match(brief, /question: why is the sky blue/);
  assert.match(brief, /\.workflows\/r1\/pages\/01\.md/);
  assert.match(brief, /https:\/\/b\.example\/y/);
  assert.match(brief, /Do not search for or fetch these again/);
  assert.match(brief, /# The workflow's brief\nBe exact\./);
});
t("with nothing fetched the brief says so instead of pretending", () => {
  const def = parseWorkflow("---\nname: a\nsteps:\n  - agent | Write\n---\nb", "/tmp/x");
  assert.match(agentBrief(def, run()), /No pages were fetched/);
});

// ---- what the window and the catalog see
t("the draft never leaves the server", () => {
  const r = run({ draft: "half a sentence" });
  assert.equal("draft" in publicRun(r), false);
  assert.equal(publicRun(r).id, "r1");
});

console.log(`\n${n} passed`);
