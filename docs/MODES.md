# Modes

A mode is a **lens on one chat**. You type `/mode` and the composer expands into a picker; the one you choose
applies until you leave it. It changes three things at once, and that is the whole design: a mode the model
could ignore would be a prompt suggestion, not a mode.

| | What it is | Where it lives |
|---|---|---|
| **Tool policy** | the tools the mode refuses are not in the request at all | `MODES` in `src/lib/modes.ts` |
| **Prompt block** | a short constraint block appended to the system prompt (`# Mode: Plan (active …)`) | `prompt` in `src/lib/modes.ts` |
| **Skill file** | the long-form guidance, auto-loaded while the mode is active and hidden from the skills index | `workspace-template/system/skills/mode-<id>/SKILL.md` |

Enforcement is deliberately redundant. `toolsForMode()` filters the tool list sent to the provider, so a denied
tool does not exist as far as the model is concerned. The exec loop then checks every call again with
`modeAllows()` — MCP servers come and go, and a tool that appeared after the request was built must still be
refused (the model gets `modeRefusal()` back as the tool result, and the user sees a failed tool row). `steps`
caps how long a turn may run in that mode.

## The built-in modes

| `/mode` | Label | Refuses | Steps | Shape of the answer |
|---|---|---|---|---|
| `research` | Search | every write, run, canvas, memory write | 14 | every claim from a page opened this turn, `[n](url)`, nothing saved |
| `plan` | Plan | writes, runs, canvases, memory | 10 | ordered steps, open decisions asked once, smallest first step |
| `code` | Code | nothing | 40 | read the neighbourhood, smallest correct diff, run it, say what was verified |
| `learn` | Learn | writes, runs | 16 | idea → worked example → something you do yourself; figures, quizzes, timers |
| `write` | Write | runs, browser, device tools | 20 | prose into a file, plain voice, blocks only for data |
| `data` | Data | nothing | 20 | compute before answering, present as tables/charts/stats, unit + source on every number |

Why `research` and not `search`: `search` is already the stored id for the quiet General history, and one word
cannot mean two things. `general` itself is a *place*, not a lens — it has no tools, no prompt block and no
step budget.

## Adding a mode

1. Append an entry to `MODES` in `src/lib/modes.ts`:

```ts
{
  id: "review",                     // short, lowercase; becomes /mode review
  label: "Review",                  // what the picker and the chip show
  hint: "Read it like a reviewer — findings, not fixes",
  steps: 14,
  deny: [...WRITES, ...RUNS],       // or use `allow: [...]` to whitelist instead
  prompt: `…two or three sentences of hard rules…`,
}
```

2. Add `workspace-template/system/skills/mode-review/SKILL.md` with front matter `name: mode-review`,
   `description: …`, `mode: true`. It is loaded automatically while the mode is active, stripped of front
   matter, and appended to the prompt block. Nothing else is needed: the picker, the chip, `/mode <id>`, the
   registry type and the tests all read `MODES`.

3. Run the checks:

```bash
node --experimental-strip-types dev/tests/modes.test.ts   # policy, prompt, skill file per mode
node dev/modes-e2e.mjs                                    # real turns: what the model is actually given
```

`modes.test.ts` asserts each mode has a real prompt, a step budget in range, and a skill file that explains
it; `modes-e2e.mjs` runs actual turns through the app and inspects the request that reached the provider
(`/api/dev/mock/last` returns it verbatim while developer mode is on).

## In the interface

- `/mode` in the composer opens the picker; `/mode <id>` picks one directly; `/mode` from the command
  palette does the same. Picking the active mode again leaves it.
- The active mode is a chip on the composer with a one-line reminder and an × to leave.
- The mode belongs to the conversation (`conversations.state.mode`), so reopening a chat restores it. A chat
  that does not exist yet keeps it as *pending* and is born inside the mode on the first message
  (`POST /api/chat` takes `mode` at birth).
- Choosing a mode in a General (quiet history) conversation promotes it to the normal chat surface, because a
  lens only makes sense where the agent works.
