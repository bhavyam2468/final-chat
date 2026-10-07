#!/usr/bin/env node
/**
 * Offline OpenAI-compatible mock for UI development and demos (no key, no network).
 * Streams deliberately irregular chunks (1–60 chars, 5–160 ms gaps, bursts) to exercise the streaming renderer.
 *   node dev/mock-llm.mjs [port=3099]   then LLM_BASE_URL=http://127.0.0.1:3099/v1
 * In the app: developer mode (DEV_MODE=1 or window.__dev.enable()) adds the "mock" provider, served at /api/dev/mock/v1.
 * Scenarios by keyword in the last user message: jee|mock test, graph, chem|molecule, open <path>, plan|todo, ask, samples, else markdown.
 * Guardrail scenarios: "guard:think|orphan|reasoning|filler|link|loop|textcall|toolcode|cjk|cite|danger|pkg|stuck|slop|integrity".
 */
import http from "node:http";


const JEE = String.raw`Built from the pattern of recent JEE Main papers: 6 questions, +4 / −1, one hour. It opens beside the chat so you can ask about any question while you work.

<canvas title="JEE Main mock 1" dock>
<ui>
<style type="rel">
root { max: wide }
.bar { sticky: top }
.res { gap: loose }
.stats { columns: 3 }
</style>
<script type="data" name="qs">[
{"s":"Physics","t":"Laws of motion","q":"A block slides down a smooth incline of angle $\\theta$. Its acceleration is","o":["$g$","$g\\sin\\theta$","$g\\cos\\theta$","$g\\tan\\theta$"],"a":"B","fig":"ground 170\nincline 30 70 220 100\nmass 130 100 \"m\"\narrow 130 100 130 150 \"mg\"\nangle 250 170 30 150 180 \"θ\""},
{"s":"Physics","t":"Electrostatics","q":"Two charges $+q$ and $-q$ are $2a$ apart. The field at the midpoint has magnitude","o":["$0$","$\\frac{kq}{a^2}$","$\\frac{2kq}{a^2}$","$\\frac{kq}{2a^2}$"],"a":"C"},
{"s":"Chemistry","t":"Nomenclature","q":"The IUPAC name of the compound shown is","smiles":"CC(C)CO","o":["2-methylpropan-1-ol","butan-1-ol","2-methylpropan-2-ol","butan-2-ol"],"a":"A"},
{"s":"Chemistry","t":"Chemical kinetics","q":"For a first-order reaction, $t_{1/2}$ is","o":["proportional to $[A]_0$","independent of $[A]_0$","inversely proportional to $[A]_0$","proportional to $[A]_0^2$"],"a":"B"},
{"s":"Mathematics","t":"Definite integrals","q":"$\\int_0^{\\pi/2} \\sin^2 x\\,dx$ equals","o":["$\\frac{\\pi}{2}$","$\\frac{\\pi}{4}$","$1$","$\\pi$"],"a":"B"},
{"s":"Mathematics","t":"Functions","q":"How many real roots does $x^3 - 3x + 1 = 0$ have? (see graph)","o":["0","1","2","3"],"a":"D","fn":"y=x^3-3x+1"}
]</script>
<x-state submitted="false" res="[]" picks="[]"></x-state>
<x-row class="bar">
  <h3>JEE Main · Mock 1</h3>
  <x-spacer></x-spacer>
  <x-badge>{{ answered() }} / {{ qs.length }}</x-badge>
  <x-timer id="clock" seconds="3600" autostart @done="submit()"></x-timer>
</x-row>
<x-deck id="deck" nav="numbers" show="!submitted">
  <x-slide each="(q, i) in qs" :label="'Q' + (i + 1)">
    <small>{{ q.s }} · {{ q.t }}</small>
    <p>{{ q.q }}</p>
    <x-draw show="q.fig" w="300" h="190" :text="q.fig || ''"></x-draw>
    <x-smiles show="q.smiles" :smiles="q.smiles || ''"></x-smiles>
    <x-graph show="q.fn" :fn="q.fn || ''" xmin="-3" xmax="3" ymin="-4" ymax="4"></x-graph>
    <x-choice :name="'q' + i" :options="q.o.join('|')" :answer="q.a" :reveal="res.length > 0"></x-choice>
    <x-row>
      <button show="i > 0" @click="deck.prev()">Previous</button>
      <x-spacer></x-spacer>
      <button tone="accent" @click="i === qs.length - 1 ? submit() : deck.next()">{{ i === qs.length - 1 ? 'Submit' : 'Next' }}</button>
    </x-row>
  </x-slide>
</x-deck>
<x-section class="res" show="submitted" title="Result">
  <x-grid class="stats">
    <x-stat :value="score" label="Score" :unit="'/ ' + qs.length * 4"></x-stat>
    <x-stat :value="res.filter(r => r === true).length" label="Correct"></x-stat>
    <x-stat :value="fmt(clock.elapsed || 0)" label="Time"></x-stat>
  </x-grid>
  <x-chart type="stacked" :data="bySubject()" labels="Physics,Chemistry,Mathematics" series="Correct|Wrong|Skipped" title="By subject"></x-chart>
  <x-card each="(q, i) in qs" :tone="res[i] === true ? 'success' : res[i] === false ? 'danger' : 'neutral'" :title="'Q' + (i + 1) + ' · ' + q.t">
    <p>{{ q.q }}</p>
    <small>You: {{ picks[i] || 'skipped' }} · Answer: {{ q.o['ABCD'.indexOf(q.a)] }}</small>
  </x-card>
  <x-row>
    <button @click="deck.go(0); submitted = false">Review questions</button>
    <button tone="accent" @click="sendToLm({ test: 'JEE Main mock 1', score, correct: res.filter(r => r === true).length, wrong: res.filter(r => r === false).length, topics: qs.map((q, i) => q.t + ':' + (res[i] === true ? 'right' : res[i] === false ? 'wrong' : 'skipped')) })">Analyse my attempt</button>
  </x-row>
</x-section>
<script>
function answered() { return $$('x-choice').filter(c => c.answered).length }
function submit() {
  clock.stop();
  const cs = $$('x-choice');
  res = cs.map(c => c.answered ? c.correct : null);
  picks = cs.map(c => c.value);
  score = res.reduce((a, r) => a + (r === true ? 4 : r === false ? -1 : 0), 0);
  submitted = true;
}
function bySubject() {
  const subj = ['Physics', 'Chemistry', 'Mathematics'];
  const k = (v) => subj.map(s => qs.filter((q, i) => q.s === s && res[i] === v).length).join(',');
  return [k(true), k(false), k(null)].join('|');
}
</script>
</ui>
</canvas>

Submit when done and press **Analyse my attempt** for per-topic feedback.`;

const TIKZ = String.raw`An Atwood machine: two masses on one rope over a frictionless pulley.

<ui>
<x-tikz>
\begin{tikzpicture}[scale=1.1]
\fill[pattern=north east lines] (-1.6,0.3) rectangle (1.6,0.5);
\draw[thick] (-1.6,0.3) -- (1.6,0.3);
\draw (0,0.3) -- (0,-0.4);
\draw[thick] (0,-0.9) circle (0.5);
\fill (0,-0.9) circle (0.05);
\draw[thick] (-0.5,-0.9) -- (-0.5,-3.0);
\draw[thick] (0.5,-0.9) -- (0.5,-2.2);
\draw[fill=gray!20] (-0.85,-3.0) rectangle (-0.15,-3.7) node[midway]{$m_1$};
\draw[fill=gray!20] (0.15,-2.2) rectangle (0.85,-2.9) node[midway]{$m_2$};
\draw[->,thick] (-1.2,-3.1) -- (-1.2,-3.9) node[left]{$m_1 g$};
\draw[->,thick] (1.2,-2.3) -- (1.2,-3.1) node[right]{$m_2 g$};
\draw[->] (-1.2,-2.9) -- (-1.2,-2.2) node[left]{$T$};
\draw[->] (1.2,-2.1) -- (1.2,-1.4) node[right]{$T$};
\end{tikzpicture}
</x-tikz>
</ui>

With $m_1 > m_2$: $a = \frac{(m_1 - m_2)g}{m_1 + m_2}$ and $T = \frac{2 m_1 m_2 g}{m_1 + m_2}$.`;

const GRAPH = String.raw`Drag the sliders; the curve and its derivative update live.

<ui>
<style type="rel">
.plot { size: 3x }
.ctl { group: sliders }
landscape { .plot { place: start } }
</style>
<x-graph class="plot" fn="y=a*sin(b*x); y=a*b*cos(b*x)" xmin="-6.3" xmax="6.3" legend></x-graph>
<label class="ctl">a = {{ a }} <input type="range" name="a" min="0.2" max="3" step="0.1" value="1"></label>
<label class="ctl">b = {{ b }} <input type="range" name="b" min="0.2" max="4" step="0.1" value="1"></label>
</ui>

Period is $\frac{2\pi}{b}$; the derivative's amplitude is $ab$.`;

const CHEM = String.raw`Aspirin is acetylsalicylic acid: an ester of salicylic acid with acetic acid.

<ui>
<x-row>
<x-smiles smiles="CC(=O)Oc1ccccc1C(=O)O" label="Aspirin"></x-smiles>
<x-kv>Formula: C₉H₈O₄
Molar mass: 180.16 g/mol
pKa: 3.5</x-kv>
</x-row>
</ui>`;

const MD = String.raw`## Streaming check

Plain paragraphs arrive in irregular chunks; the renderer paces them. A table:

| Model | Context | Notes |
|---|---|---|
| Local 8B | 16k | fits the lean prompt |
| Flash-Lite | 1M | free tier |

${"```"}python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
${"```"}

Euler: $e^{i\pi} + 1 = 0$, and

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$

- [x] markdown
- [x] math
- [ ] your next question`;

/**
 * Guardrail scenarios ("guard:<name>" in the message). Each reproduces a documented failure of weak models so the
 * harness response can be seen end to end. See docs/GUARDRAILS.md. Every command here is harmless even if approved.
 */
const DANGER = "sqlite3 guard-demo.db \"DROP TABLE IF EXISTS demo\"";
function guard(name, messages, q) {
  const afterTool = messages[messages.length - 1]?.role === "tool";
  const tools = messages.filter((m) => m.role === "tool").length;
  const auto = /\[automatic/.test(q);
  switch (name) {
    case "think": return { text: "<think>The user asks what 17 × 23 is. 17 × 20 = 340, 17 × 3 = 51, total 391.</think>\n\nGreat question! 17 × 23 = **391**." };
    case "orphan": return { text: "Okay, the user wants a haiku about rain. Five, seven, five syllables. Let me draft one.</think>\n\nSoft rain on tin roofs\nthe kettle hums its answer\nno one needs to speak" };
    case "reasoning": return { reasoning: "Reasoning arrives in a separate reasoning_content field here (DeepSeek, OpenRouter, vLLM). It should show collapsed and never be re-sent.", text: "Paris is the capital of France." };
    case "filler": return { text: "Absolutely! Here's the short version: `git switch -c name` creates a branch and switches to it.\n\nI hope this helps! Let me know if you have any other questions." };
    case "loop": return auto ? { text: "The config file is valid; nothing else to change." } : { text: "Here is what I found in the config. " + "I will now check the config file again to be sure. ".repeat(40) };
    case "textcall": return afterTool ? { text: "The workspace has the folders listed above." } : { text: "Let me look at the workspace.\n```json\n{\"name\": \"fs_list\", \"arguments\": {\"path\": \".\"}}\n```" };
    case "toolcode": return afterTool ? { text: "Listed." } : { text: "```tool_code\nprint(default_api.fs_list(path=\".\", depth=1))\n```" };
    case "link": return { text: "The official guide is at [docs.python.org/3/library/pathlib](https://docs.python.org/3/library/pathlib.html), and the PEP is [PEP 428](https://peps.python.org/pep-0428/)." };
    case "cjk": return { text: "The function 返回 a list of users，then the caller filters them by role：admins first." };
    case "cite": return auto ? { text: "I could not open a page confirming that, so I removed the link. The release notes I found do not mention a version 9." } : afterTool ? { text: "Bun 9 ships a new bundler, according to [the release notes](https://bun.sh/blog/bun-v9-imaginary) and [this benchmark](https://example-benchmarks.dev/bun9)." } : { call: { name: "web_search", args: { query: "bun 9 release notes", limit: 3 } } };
    case "danger": return afterTool ? { text: /approved/.test(q) ? "Done." : "That needs your approval first." } : { text: /approved/.test(q) ? "" : "Dropping the demo table.", call: { name: "shell", args: { command: DANGER } } };
    case "pkg": return afterTool ? { text: "Noted." } : { call: { name: "pip_install", args: { packages: ["requests", "fastapi-turbo-utils-pro"] } } };
    case "stuck": return tools < 6 ? { text: tools ? "" : "Reading the file.", call: { name: "fs_read", args: { path: "does/not/exist.txt" } } } : { text: "Gave up." };
    case "slop": return afterTool || auto ? { text: auto ? "Left as is (mock)." : "Built the landing page." } : { call: { name: "fs_write", args: { path: "artifacts/guard-slop.html", content: "<!doctype html><html><head><style>body{margin:0;background:#0a0a0f;color:#39ff14;font-family:Orbitron,sans-serif}.hero{background:linear-gradient(135deg,#6366f1,#a855f7);text-align:center;padding:120px}.card{border-left:4px solid #a855f7;border-radius:16px;box-shadow:0 0 40px #a855f7;backdrop-filter:blur(12px)}</style></head><body><section class=\"hero\"><h1>🚀 UNLEASH THE FUTURE</h1><p>Supercharge your workflow with next-gen AI-powered synergy.</p><button>Get Started</button></section><div class=\"card\">✨ Blazing fast</div></body></html>" } } };
    case "integrity": return afterTool || auto ? { text: auto ? "Left as is (mock)." : "Implemented and all done." } : { call: { name: "fs_write", args: { path: "artifacts/guard_calc.py", content: "API_KEY = \"sk-proj-abcdefghijklmnopqrstuvwxyz123456\"\n\ndef parse(expr):\n    try:\n        return eval(expr)\n    except Exception:\n        pass\n\ndef simplify(expr):\n    raise NotImplementedError\n" } } };
  }
  return { text: "Unknown guard scenario. Try: " + GUARDS.join(", ") };
}
const GUARDS = ["think", "orphan", "reasoning", "filler", "link", "loop", "textcall", "toolcode", "cjk", "cite", "danger", "pkg", "stuck", "slop", "integrity"];

function searchAnswer(q) {
  const urls = [...q.matchAll(/^(https:\/\/\S+)$/gm)].map((m) => m[1]);
  const topic = (q.match(/<search_results query="([^"]*)"/) || [])[1] || "that";
  if (!urls.length) return { text: `I couldn't reach search just now, so this is from memory: ${topic} is covered in most references.` };
  return { text: `**${topic}** comes down to three facts. The official docs describe the current behaviour [1](${urls[0]}), and the wiki has the background and history [2](${urls[1] || urls[0]}).\n\nRecent coverage adds the newest changes [3](${urls[2] || urls[0]}).` };
}

function scenario(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const q = (typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content || "")).toLowerCase();
  const afterTool = messages[messages.length - 1]?.role === "tool";
  const g = [...messages].reverse().filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join(" ").match(/guard:(\w+)/);
  if (g && (q.includes("guard:") || /\[automatic|approved|denied/.test(q) || afterTool)) return guard(g[1], messages, q);
  // a workflow brief (deep research): answer with a cited report built from the sources it was handed
  if (q.includes("# workflow:") || q.includes("# the workflow's brief")) {
    const urls = [...q.matchAll(/\[(\d+)\] .+? — (https?:\/\/[^\s]+)/g)].map((m) => m[2]);
    const list = urls.length ? urls : ["https://docs.example/research"];
    return { text: `CSS anchor positioning is specified and shipping; the practical changes are in how fallbacks and overflow are handled [1](${list[0]}).\n\n## What changed\n\nThe position-try fallback syntax replaced the older \`position-fallback\` proposal, and \`anchor-scope\` limits which anchors a query can see [2](${list[1] || list[0]}). Browsers that shipped early still accept the older spelling, so feature detection is worth keeping [3](${list[2] || list[0]}).\n\n## Where the sources disagree\n\nOne source calls the fallback ordering deterministic, another describes it as implementation-defined for overlapping candidates; the specification is the tiebreaker [1](${list[0]}), [2](${list[1] || list[0]}).\n\n## Not known\n\nNone of the pages states a date for the last specification change, so the schedule is not settled here.` };
  }
  // the workflows pair: save a definition, then run one — enough to exercise both tools end to end
  if (/^tmpl:/.test(q)) {
    // The template library through the tool path the model actually uses: search, read (which verifies),
    // then quote the check line back. The chat e2e asserts on that summary.
    const want = (q.split(":")[1] || "").trim() || "half adder";
    const seen = messages.filter((m) => m.role === "tool").map((m) => String(typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const found = seen.find((t) => /templates\//.test(t));
    if (!found) return { text: `Looking that up in the template library.`, call: { name: "template_search", args: { query: want } } };
    const id = (found.match(/templates\/([\w-]+)/) || [])[1] || "half-adder";
    const read = seen.find((t) => /checked:/i.test(t) || /NOT usable/i.test(t));
    if (!read) return { text: "", call: { name: "template_get", args: { name: id } } };
    const line = (read.match(/(Checked:|NOT usable)[^\n]*/) || [])[0] || "read it";
    return { text: `Took ${id} from the library. ${line}\n\nThe source below is the verified one.` };
  }
  if (/^wfsave:/.test(q)) {
    const name = (q.split(":")[1] || "").trim().split(/\s+/)[0] || "digest";
    return afterTool ? { text: `Saved workflows/${name}/workflow.md — search, read, then the report.` } : { call: { name: "workflow_save", args: {
      name, title: "Digest", description: "Searches, opens the pages, writes a short digest with links.",
      inputs: [{ name: "topic", label: "What should it cover?" }],
      steps: [{ kind: "search", title: "Find sources", opts: { limit: 5 } }, { kind: "read", title: "Open the pages", opts: { limit: 4 } }, { kind: "agent", title: "Write the digest", opts: { expect: 6 } }],
      body: "# What this run is for\n\nFive items, newest first, one line each, each with a link.",
    } } };
  }
  if (/^wfrun:/.test(q)) {
    const rest = (q.split(":")[1] || "").trim();
    const m = /^(\S+)\s+(.+)$/.exec(rest);
    const call = { name: "start_workflow", args: { name: m ? m[1] : rest, input: m ? m[2] : "what changed this week" } };
    return afterTool ? { text: "It is running — the report will land here when it is done." } : { call };
  }
  if (q.includes("<search_results") && !afterTool) return searchAnswer(q);
  if (q.includes("ui_event")) return { text: "You scored well on mechanics; kinetics and function graphs need work. Next: 10 targeted questions on first-order kinetics and cubic root counting via turning points." };
  if (/jee|mock test/.test(q)) return afterTool ? { text: JEE } : { text: "Checking recent paper patterns.", call: { name: "web_search", args: { query: "JEE Main 2026 question paper pattern physics chemistry maths", limit: 3 } } };
  // Presentation guard: a wall of tabular text first, blocks once the harness asks for them.
  const asked = [...messages].filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join(" ").toLowerCase();
  if (/compare options|benchmark these/.test(asked) && !afterTool) {
    const nudged = /automatic format check/i.test(asked);
    const rows = [["Runtime", "Cold start", "Memory", "Size"], ["bun", "42 ms", "58 MB", "94 MB"], ["node", "130 ms", "72 MB", "110 MB"], ["deno", "85 ms", "64 MB", "102 MB"], ["go", "9 ms", "12 MB", "8 MB"], ["python", "210 ms", "38 MB", "26 MB"], ["ruby", "180 ms", "44 MB", "31 MB"], ["julia", "1.2 s", "210 MB", "180 MB"]];
    if (nudged) return { text: "Sorted by cold start:\n\n<ui><x-table>Runtime,Cold start,Memory,Size\n" + rows.slice(1).map((r) => r.join(",")).join("\n") + "</x-table></ui>\n\nGo wins on every axis; bun is the fastest of the script runtimes." };
    return { text: "Here is the comparison:\n\n| " + rows[0].join(" | ") + " |\n|" + rows[0].map(() => "---").join("|") + "|\n" + rows.slice(1).map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n\nGo wins on every axis; bun is the fastest of the script runtimes." };
  }
  const open = q.match(/open\s+(\S+)/);
  if (open) return afterTool ? { text: "Opened beside the chat." } : { call: { name: "canvas_open", args: { target: open[1], dock: true } } };
  if (/samples|files/.test(q)) return { text: "The example files:\n\n[deck.pptx](uploads/samples/deck.pptx)\n\n[budget.xlsx](uploads/samples/budget.xlsx)\n\n[project.zip](uploads/samples/project.zip)\n\n[chart.png](uploads/samples/chart.png)\n\nAsk to open any of them." };
  if (/plan|todo/.test(q)) return afterTool ? { text: "Plan set. Starting with the data model." } : { text: "Breaking this into steps.", call: { name: "todo", args: { items: [{ text: "Data model", status: "doing" }, { text: "List view", status: "todo" }, { text: "Persistence", status: "todo" }, { text: "Verify in browser", status: "todo" }] } } };
  if (/procsuite/.test(q)) {
    const calls = messages.filter((m) => m.role === "assistant" && m.tool_calls).flatMap((m) => m.tool_calls.map((t) => t.function?.name || "")).filter((n) => n.startsWith("proc_"));
    const steps = [
      { text: "Starting the test process.", call: { name: "proc_start", args: { name: "repl", command: "bash -c 'echo READY; while read l; do echo got:$l; done'" } } },
      { text: "", call: { name: "proc_logs", args: { name: "repl", wait_for: "pattern", pattern: "READY", timeout: 5 } } },
      { text: "", call: { name: "proc_write", args: { name: "repl", input: "hello-write" } } },
      { text: "", call: { name: "proc_logs", args: { name: "repl", grep: "got:" } } },
      { text: "", call: { name: "proc_signal", args: { name: "repl", signal: "SIGHUP" } } },
      { text: "", call: { name: "proc_logs", args: { name: "repl", wait_for: "exit", timeout: 5 } } },
      { text: "", call: { name: "proc_restart", args: { name: "repl" } } },
      { text: "", call: { name: "proc_logs", args: { name: "repl", grep: "READY", tail: 400 } } },
      { text: "", call: { name: "proc_stop", args: { name: "repl" } } },
    ];
    const step = calls.length;
    if (step < steps.length) return steps[step];
    const results = messages.filter((m) => m.role === "tool").slice(-9).map((m, i) => `step ${i + 1}: ${String(typeof m.content === "string" ? m.content : JSON.stringify(m.content)).slice(0, 220)}`);
    return { text: "Process suite finished.\n\n" + results.join("\n\n") };
  }
  if (/slowpy/.test(q)) return afterTool ? { text: "Done counting." } : { text: "Running it.", call: { name: "run_python", args: { code: "import time\nfor i in range(8):\n    print('step', i, flush=True)\n    time.sleep(0.8)" } } };
  if (/longtext/.test(q)) return { text: MD, slow: 20 }; // same answer, ~20x slower (~15s): for testing chat switching and Stop
  if (/\bask\b/.test(q)) return { call: { name: "ask_user", args: { question: "Which stack should the app use?", options: ["Plain HTML/JS", "React + TypeScript", "Electron"] } } };
  if (/atwood|tikz|pulley/.test(q)) return { text: TIKZ };
  if (/graph|plot/.test(q)) return { text: GRAPH };
  if (/chem|molecule|aspirin/.test(q)) return { text: CHEM };
  return { text: MD };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function chunks(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    const burst = Math.random() < 0.08;
    const n = burst ? 80 + Math.floor(Math.random() * 160) : 1 + Math.floor(Math.random() * 60);
    out.push(text.slice(i, i + n)); i += n;
  }
  return out;
}

/** Non-streaming completion (compaction/summaries). */
export function complete(j) {
  lastRequest = { at: Date.now(), model: j.model, messages: j.messages, tools: j.tools?.map((t) => t.function?.name) ?? null };
  const msgs = j.messages || [];
  const sys = msgs.find((m) => m.role === "system")?.content || "";
  const last = JSON.stringify(msgs.slice(-1));
  if (/Fragments in another script/.test(last)) { const n = (last.match(/\\n\d+\. /g) || []).length || 1; return { choices: [{ message: { role: "assistant", content: JSON.stringify(Array(n).fill("returns")) } }] }; }
  const text = /summar|compact/i.test(sys + last) ? "Goal: practice JEE. Done: mock 1 built (6 q). Facts: +4/−1 marking. Open: analysis of attempt." : "Mock chat";
  return { choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
}

/**
 * What the app last sent us — the system prompt and the tool list, verbatim. Kept because "did the app
 * really withhold that tool?" is otherwise invisible from the outside, and it is the only honest way to
 * test a policy end to end. Dev-only: this file is loaded from disk by /api/dev/mock, never bundled.
 */
let lastRequest = null;
export const last = () => lastRequest;

/** Streaming completion as SSE lines. */
export async function* stream(j) {
  lastRequest = { at: Date.now(), model: j.model, messages: j.messages, tools: j.tools?.map((t) => t.function?.name) ?? null };
  const send = (delta, finish = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const sc = scenario(j.messages || []);
  for (const c of chunks(sc.reasoning || "")) { yield send({ reasoning_content: c }); await sleep(10 + Math.random() * 60); }
  for (const c of chunks(sc.text || "")) { yield send({ content: c }); await sleep((sc.slow || 1) * (5 + Math.random() * (Math.random() < 0.1 ? 400 : 160))); }
  if (sc.call) {
    const id = "call_" + Date.now();
    yield send({ tool_calls: [{ index: 0, id, type: "function", function: { name: sc.call.name, arguments: "" } }] });
    for (const c of chunks(JSON.stringify(sc.call.args))) { yield send({ tool_calls: [{ index: 0, function: { arguments: c } }] }); await sleep(20); }
  }
  yield send({}, sc.call ? "tool_calls" : "stop");
  yield "data: [DONE]\n\n";
}

export const models = () => ({ data: [{ id: "mock" }] });

/**
 * Fake pages for the scrape step: a deep-research run offline still reads real-looking articles, so the
 * workflow's read step, the sources table and the report all have something to chew on. .example domains.
 */
export function scrape(j) {
  const url = String(j.url || "");
  const m = url.match(/^https:\/\/([^/]+)\/(.*)$/);
  const host = m ? m[1] : "docs.example";
  const slug = (m ? m[2] : "").replace(/[^a-z0-9-]+/gi, " ").trim() || "overview";
  const paras = Array.from({ length: 6 }, (_, i) => `## ${slug} (part ${i + 1})\n\n${host} covers ${slug} in some detail. Paragraph ${i + 1} states the position, gives a number someone would quote (${10 + i * 7}% in ${2000 + i * 4}), and names the trade-off: the short path is faster, the long path is cheaper to change. It also notes when that changed, and what the previous guidance was.\n\n- point ${i + 1}.1 with a figure\n- point ${i + 1}.2 with a caveat`);
  return { data: { markdown: `# ${slug} — ${host}\n\n${paras.join("\n\n")}`, metadata: { title: `${slug} — ${host}` } } };
}

/** Fake Firecrawl /v1/search (search mode offline). Domains are .example so nothing real is ever linked. */
export function search(j) {
  const q = String(j.query || "").slice(0, 80);
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "query";
  const sites = ["docs", "wiki", "news", "forum", "blog", "guide"];
  return { success: true, data: sites.slice(0, Math.min(Number(j.limit) || 5, 6)).map((d, i) => ({
    url: `https://${d}.example/${slug}`, title: `${q} - ${d[0].toUpperCase() + d.slice(1)} ${i + 1}`,
    description: `What ${d} says about ${q}: a short snippet with the key facts, dates and numbers someone would look for.`,
  })) };
}

const direct = process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href;
if (direct) {
  const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 3099);
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url.endsWith("/models")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(models())); }
    if (req.method !== "POST") { res.statusCode = 404; return res.end(); }
    let body = ""; for await (const c of req) body += c;
    let j = {}; try { j = JSON.parse(body); } catch {}
    if (!j.stream) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(complete(j))); }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for await (const line of stream(j)) res.write(line);
    res.end();
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`mock LLM on http://127.0.0.1:${PORT}/v1`));
}
