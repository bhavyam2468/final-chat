# Prompt system audit — findings and decisions

Date: 2026-10-07. Scope: every prompt the model sees, the skill set, the MCP catalog and the memory system.

## 1. Everything the model is told (inventory)

| Where | What | Size (approx) |
|---|---|---|
| `workspace-template/system/SYSTEM.md` | Main system prompt ("base") | 9.3 KB ≈ 2.6k tok |
| `buildSystem()` in `src/lib/agent.ts` | Composes system + memory + skills index + env/access + tree + pinned files + **SEARCH_MODE** | code |
| `workspace-template/system/AGENTS.md` | Injected verbatim as `# Memory` every turn | unbounded |
| `memoryPrompt()` in `src/lib/memory.ts` | Profile (≤1200 chars) + up to 4 keyword-matched episodes (≤1800 chars) | code |
| `workspace-template/system/skills/*/SKILL.md` (23) | Progressive disclosure: name + description in the index; body only on `skill_open` | index ≈ 23 lines |
| Tool descriptions in `src/lib/tools/index.ts` | Ride along with every request | ~4 KB JSON |
| `workspace-template/system/skills/blocks/SKILL.md` | The BlocksUI language reference | 7.4 KB |
| `docs/BLOCKS.md`, `docs/GUARDRAILS.md`, `docs/OPENUI-REPORT.md` | Human docs (not sent) | — |

Total always-on cost: SYSTEM.md (2.6k) + memory + skills index (~350) + tool schemas (~1.4k) ≈ **4.5k tokens before history**. The fragmentation was deliberate (small models, 16k windows) and that is still the right call. The failure is not *fragmentation* — it is that the **behavioural rules were fragmented along with the reference material**.

## 2. What broke

### 2.1 Blocks are not the native medium
The main prompt mentions `<ui>` in the *Output* section, near the bottom, as one of several features. Nothing says "present with blocks unless there is a reason not to". Concretely seen failures:

- Asked for a graph → the model runs `run_python` with matplotlib.
  Root cause: `skills/python/SKILL.md` says *"Plots: `plt.savefig('artifacts/name.png'…)`; then show with `![](artifacts/name.png)`"* — a direct contradiction of SYSTEM.md ("Never render with matplotlib/PIL … Charts the user should see are `<x-chart>` or `<x-graph>`") and of the `run_python` tool description. When two prompts disagree, the skill (read last, more specific) wins.
- Asked for system specs / memory contents → prose or a markdown table, where `x-kv` / `x-stat` / `x-table` exist.
- Markdown tables used for datasets that `x-table` renders sortable.

### 2.2 Contradictions and duplicate homes (audited)

| Topic | Conflicting instructions |
|---|---|
| Charts | SYSTEM.md `<x-chart>` vs `python` skill matplotlib PNG |
| Memory | SYSTEM.md "AGENTS.md … append durable user facts" vs `memory` skill "Prefer the remember tool … AGENTS.md is the older file" |
| Files | SYSTEM.md "never use the shell to cat/grep" vs `files` skill duplicating the same rules; `terminal` skill again |
| Blocks depth | SYSTEM.md examples vs `blocks` skill component table vs `ui_search` catalog — three sources that drift |
| Canvas | SYSTEM.md canvas rules vs `canvas` skill vs `blocks` skill (placement paragraph) |
| Skills index | `android`, `google`, `home-files`, `host` describe things SYSTEM.md already states (or the access switches handle) |
| Search | `web` skill (query craft, budgets, citation) vs SEARCH_MODE in `agent.ts` vs `research` skill |

### 2.3 Skill set: 23 default skills, overlapping
- `python` ⊂ `spreadsheets`/`presentations`/`pdf` (all "manipulate a file with Python").
- `files` ⊂ SYSTEM.md + `context`.
- `home-files` + `host` ⊂ `terminal` (both are access-mode notes).
- `literature-review` + `hypothesis-testing` ⊂ `research` (methods of it).
- `context` + `memory` — one subject (what the model remembers, what it keeps in the window).
- `google` ⊂ `extensions` (an MCP note, not a capability).
Result: an index the model must disambiguate, and bodies that repeat each other. Fewer, better skills with **reference files** is strictly superior for the same tokens.

### 2.4 Memory: works, but weakly
- **Two homes** for the same thing (AGENTS.md appends + profile/episodes), and AGENTS.md is injected **unbounded** every turn → context creep.
- Episode retrieval is exact-word overlap on the *current* message. "what theme should I use" never matches "prefers dark mode"; "yes, do that" matches nothing. Stored dates are never shown, so stale notes look fresh.
- `profile.md` grows without a cap; the prompt slice cuts at 1200 chars mid-line, silently.
- Episodes are appended with no dedupe (the same fact remembered twice appears twice).
- `remember(scope="project")` needs a linked project and writes `NOTES.md`, which `buildSystem` also injects — two paths, one file.

### 2.5 What the reference prompt does well (Claude Sonnet 4.5, `x1xhlol/system-prompts-and-models-of-ai-tools`)
Read in full (43 KB). Transferable, without its length:

1. **The special medium has explicit always/never lists plus a decision test.** Artifacts: "use for …", "you must always use artifacts for: …", and the heuristic *"will the user want to copy/paste this outside the conversation? If yes, ALWAYS create the artifact"*, plus an "if unsure, use it" default. Our equivalent test: *"will the user want to read, compare, manipulate or keep this?"* → block.
2. **Per-medium constraints stated as hard rules with the reason** ("NEVER use localStorage — it will fail here"), and version gotchas ("do not use THREE.CapsuleGeometry, introduced in r142"). We need the same for Blocks: never CSS, never CDN, never matplotlib, never a fence, name must exist.
3. **Decision lists for search** — a "do NOT search for" list, a "DO search for" list, query craft (1-6 words, no operators), and "OFFER to search rarely". Our SEARCH_MODE has this shape; the `web` skill duplicated it badly.
4. **Critical reminders at the end** repeating the top failure modes, and **long-conversation reminders** re-injected when the model drifts. We already re-inject `todo`; the same mechanism should re-inject presentation when a turn drifts text-only.
5. **Tone/format rules with the failure named** ("no 'Certainly!', 'Great!'", "no lists in chit-chat", "avoid over-formatting"). We have this via `OpenerGate` + prompt; keep.
6. **Anti-plagiarism**: never reproduce source text, claims in your own words, no long displacive summaries. Missing here — added in compact form.

## 3. Decisions

**Keep** progressive disclosure: a compact always-on core, reference material in skills. **Change** what belongs where:

- **Behaviour → the core prompt.** Anything that must hold every turn (presentation defaults, truth, tone, failures, safety) lives in SYSTEM.md, never in a skill.
- **Reference → skills.** Component tables, per-platform commands, file-format recipes.
- **One home per fact.** Every rule appears exactly once; other places point at it.

### 3.1 New skill set (23 → 11)

| Skill | Absorbs | Notes |
|---|---|---|
| `blocks` | — | The UI language; reference unchanged in substance |
| `canvas` | — | Windows, dock rules, viewers |
| `documents` | `pdf`, `spreadsheets`, `presentations`, `python` | One skill for office/PDF/CSV work + the Python data rules; references per format |
| `research` | `literature-review`, `hypothesis-testing`, `web` | One workflow with references: search craft, literature review, hypothesis testing |
| `build` | `android` (+ existing platform references) | `reference/android.md` already existed |
| `debug` | — | Reproduction → isolate → fix → verify |
| `design` | — | Anti-slop rules for built UI |
| `memory` | `context` | Recall + compaction in one place |
| `extensions` | `mcp`, `google` | MCP config/credentials/catalog, skills install, Google Workspace |
| `terminal` | `home-files`, `host` | Sandbox vs host, sudo, git, long commands; access notes |
| `learn` | — | Tutoring workflow |

Removed outright: `files` (rules moved into the core prompt + `documents`). Template sync moves unmodified copies of removed skills to `.trash/template-updates` so existing installs converge.

### 3.2 Core prompt rewrite
Blocks move to the **first** section with always/never lists, the "read, compare, manipulate or keep" test, the medium ladder (inline text → block → docked canvas → artifact), and a pre-send self-check. Contradictions removed (matplotlib, AGENTS.md, cat/grep, canvas). A **presentation nudge** in the agent loop re-injects one line when a turn ends text-only while the content was tabular (mirrors `todoReminder`).

### 3.3 Memory (single home)
- `AGENTS.md` → **the user's own instruction file** (bounded injection, no auto-append advice). It is not a memory store.
- Memory = `profile.md` (stable facts) + `episodes.jsonl` (dated, deduped, capped, scored retrieval with recency) + `projects/<p>/NOTES.md`. All through `remember` / `forget`, all visible and undoable in the UI.

### 3.4 Extensions — shipped
The old catalog's five entries were all disabled and credential-gated, so a first-run user got nothing. The catalog is now curated for things a built-in tool cannot do, and anything the service supports is one click with **no API key**:

- OAuth with dynamic client registration (`oauth: true`): Notion `https://mcp.notion.com/mcp`, Linear `https://mcp.linear.app/mcp`, Jira & Confluence `https://mcp.atlassian.com/v1/mcp`, Figma `https://mcp.figma.com/mcp`, Sentry `https://mcp.sentry.dev/mcp` (endpoints checked against the official registry).
- Keyless: DeepWiki `https://mcp.deepwiki.com/mcp`, Context7 `https://mcp.context7.com/mcp`.
- Token, but often already present on the machine: GitHub (`gh auth token`), Hugging Face (`~/.cache/huggingface/token`), Postgres, paper search.
- Google Workspace (Calendar, Gmail, Drive): Google's own MCP servers need a Google Cloud OAuth client, and Google does not support dynamic registration, so they are listed as `prereg` with the exact variables to create. Slack and Asana are excluded for the same reason — no DCR.
- Anything else: one registry search (`mcp_search`) away.

Implementation: `src/lib/mcp-auth.ts` (a file-backed `OAuthClientProvider`: discovery, registration, PKCE, per-server tokens in `system/mcp/auth.json` at mode 600, refresh, sign-out), `api/mcp/oauth` + `api/mcp/oauth/callback`, a Connect/sign-out row in Extensions, and chat-side tools `mcp_search`, `mcp_add`, `mcp_remove` (they hand the user a sign-in link). Nothing enabled by default: an unconnected server costs nothing, keeps the app offline-first, and the tool schemas stay out of the prompt until it is in use.

Chat-side skill authoring: `skill_create` (folder + SKILL.md + reference files), `skill_install` (GitHub, with a picker when a repo holds several). Skill-set changes reach existing workspaces: `ensureWorkspace()` now moves shipped-and-unmodified skills that no longer ship to `.trash/template-updates`, and leaves anything the user wrote or edited alone.
