// Run: node --experimental-strip-types dev/tests/modes.test.ts
// Modes are a promise about what the agent *cannot* do, so the tool policy is checked directly against the
// registry and against the prompt the server builds — a mode that only lives in a prompt is a suggestion.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MODES, isModeId, modeOf, modeAllows, toolsForMode, modeBlock, isModeSkill } from "../../src/lib/modes.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };
const mode = (id: string) => MODES.find((m) => m.id === id)!;
const allows = (id: string, tool: string) => modeAllows(mode(id), tool);
const defs = (names: string[]) => names.map((name) => ({ type: "function" as const, function: { name, description: "", parameters: {} } }));
const ALL = ["skill_open", "fs_list", "fs_read", "fs_search", "fs_write", "fs_edit", "fs_insert", "fs_move", "fs_delete", "run_python", "pip_install", "shell", "host_shell", "web_search", "web_fetch", "web_extract", "view_image", "todo", "ask_user", "remember", "forget", "canvas_open", "ui_search", "proc_start", "proc_logs", "proc_stop", "browser", "check", "adb_devices", "mcp__notion__search"];
const denied = (id: string) => ALL.filter((name) => !allows(id, name));

t("there are at least five modes, and only real ids are accepted", () => {
  assert.ok(MODES.length >= 5, `only ${MODES.length} modes`);
  for (const m of MODES) assert.ok(isModeId(m.id), m.id);
  for (const bad of ["chat", "general", "nope", "", undefined, null, 7]) assert.equal(isModeId(bad), false, String(bad));
  assert.equal(modeOf("plan")!.label, "Plan");
  assert.equal(modeOf(null), null);
});

t("search mode can read the web and nothing else", () => {
  for (const tool of ["web_search", "web_fetch", "web_extract", "fs_read", "fs_search", "ui_search", "ask_user", "todo"]) assert.ok(allows("research", tool), `blocked ${tool}`);
  for (const tool of ["fs_write", "fs_edit", "fs_insert", "fs_move", "fs_delete", "shell", "host_shell", "run_python", "pip_install", "browser", "canvas_open", "remember", "forget", "proc_start", "adb_devices", "skill_create", "mcp_add"]) assert.equal(allows("research", tool), false, `still allows ${tool}`);
});

t("plan mode reads, asks, and touches nothing", () => {
  for (const tool of ["fs_read", "fs_search", "fs_list", "web_search", "web_fetch", "ask_user", "todo", "ui_search"]) assert.ok(allows("plan", tool), `blocked ${tool}`);
  for (const tool of ["fs_write", "fs_edit", "shell", "run_python", "canvas_open", "remember", "browser"]) assert.equal(allows("plan", tool), false, `still allows ${tool}`);
});

t("code mode keeps every tool", () => {
  assert.deepEqual(denied("code"), []);
});

t("learn mode teaches without writing or running", () => {
  for (const tool of ["fs_write", "fs_edit", "shell", "run_python", "pip_install", "browser"]) assert.equal(allows("learn", tool), false, `still allows ${tool}`);
  assert.ok(allows("learn", "ui_search"));
  assert.ok(allows("learn", "ask_user"));
});

t("write mode saves documents but runs nothing", () => {
  for (const tool of ["fs_write", "fs_edit", "fs_insert"]) assert.ok(allows("write", tool), `blocked ${tool}`);
  for (const tool of ["shell", "host_shell", "run_python", "pip_install", "browser", "adb_devices", "proc_start"]) assert.equal(allows("write", tool), false, `still allows ${tool}`);
});

t("data mode keeps computing and blocks nothing it needs", () => {
  for (const tool of ["run_python", "pip_install", "shell", "fs_read", "fs_write", "ui_search", "ask_user"]) assert.ok(allows("data", tool), `blocked ${tool}`);
});

t("the tool list sent to the model is filtered, not annotated", () => {
  const plan = toolsForMode(mode("plan"), defs(ALL)).map((d) => d.function.name);
  assert.ok(!plan.includes("fs_write") && !plan.includes("shell"), plan.join(","));
  assert.ok(plan.includes("fs_read"));
  const search = toolsForMode(mode("research"), defs(ALL)).map((d) => d.function.name);
  assert.ok(search.includes("mcp__notion__search"), "an MCP tool whose name looks like research stays available");
  assert.ok(!search.includes("fs_write"));
  assert.equal(toolsForMode(null, defs(ALL)).length, ALL.length, "no mode changes nothing");
});

t("the prompt names the mode, its rules and its blocked tools", () => {
  const block = modeBlock(mode("research"), "---\nname: mode-research\n---\n# Search mode\nOpen the page.");
  assert.match(block, /# Mode: Search \(active/);
  assert.match(block, /blocked here/);
  assert.match(block, /fs_write/);
  assert.match(block, /Open the page\./, "the skill body travels with the block");
  assert.ok(!block.includes("name: mode-research"), "front matter is stripped");
  assert.ok(block.length < 6000);
});

t("every mode has a real prompt and a sane step budget", () => {
  const steps = Object.fromEntries(MODES.map((m) => [m.id, m.steps]));
  for (const m of MODES) {
    assert.ok(m.prompt.length > 200, `${m.id} has a thin prompt`);
    assert.ok(m.hint.length > 10 && m.label.length <= 8, `${m.id} has a weak label/hint`);
    assert.ok(m.steps >= 6 && m.steps <= 60, `${m.id} budget ${m.steps}`);
  }
  assert.ok(steps.plan <= steps.research, "planning is a short turn");
  assert.ok(steps.code >= 30, "building takes many steps");
});

t("each mode ships a skill file that explains it", () => {
  for (const m of MODES) {
    const file = path.join(process.cwd(), "workspace-template/system/skills", `mode-${m.id}`, "SKILL.md");
    assert.ok(fs.existsSync(file), `missing ${file}`);
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, new RegExp(`^---\\nname: mode-${m.id}\\n`), "front matter names the skill");
    assert.match(text, /description: /);
    assert.ok(text.length > 700, `${m.id} skill is a stub`);
    assert.ok(isModeSkill(`mode-${m.id}`), `${m.id} skill is not recognised as a mode skill`);
  }
  assert.equal(isModeSkill("mode-nonsense"), false);
  assert.equal(isModeSkill("blocks"), false);
});

console.log(`\n${n} mode tests passed`);
