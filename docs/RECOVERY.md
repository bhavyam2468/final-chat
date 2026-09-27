# Recovery and hardening log

Branch: `arena/01a0e1af-final-chat`. Starting commit: `6ff9501`. Date: 2026-09-27.

## Repository map

- Next 16 / React 19 app: `src/components/App.tsx` owns chat, branching, streaming, panels and windows; Composer owns input/uploads; Message/StreamMarkdown render responses; Canvas/viewers render artifacts; Block bridges sandboxed Blocks iframes.
- `public/blocks/runtime.js`, `elements.js`, `runtime.css`: incremental HTML-like language, state/bindings, custom elements and presentation. Component catalog in `src/lib/blocks/catalog.ts`; instructions in `workspace-template/system/skills/blocks`.
- `src/lib/agent.ts`: context assembly, OpenAI-compatible streaming loop, tools, guards, persistence. `llm.ts`, `context.ts`, `harness/*`: provider requests, compaction, verification/loop/approval heuristics.
- `src/lib/tools/*`, `exec.ts`, `procs.ts`, `browser.ts`, `web.ts`: filesystem, Python/shell, background processes, browser and web backends. `skills.ts`, `mcp.ts`, `market.ts`: extensions.
- `src/app/api/*`: chat, conversations, workspace, settings, previews and extension routes. `src/db/*`: Postgres or embedded PGlite with idempotent schema initialization.
- `workspace-template`: editable prompt/skills seeded into runtime workspace with hash-based upgrades. `setup.sh`, `scripts/*`, SETUP.md: local installation/service.
- `dev/*`: offline model, regression fixtures; `testing-changelog/*`: user evidence and cumulative patch. Runtime data and secrets must not be committed.

## Patch recovery

A direct `git apply --check` fails because the cumulative patch predates this checkout. Reconstructed target files using the patch's postimage hunks and unchanged context, then verified their Git blob hashes against the patch. Already-identical files were retained. README and Panels needed unchanged tails restored before hash verification. The lockfile was regenerated with npm rather than applying an incompatible old lockfile. The existing `.claude` directory was preserved instead of replacing it with the patch's symlink; generated tsbuildinfo was not recovered.

The recovery commit intentionally separates inherited work from subsequent fixes. Passing typecheck alone does not establish that the patch is complete. Initial checks: typecheck passes; lint fails in Elapsed (Date.now during render). Search backend exists but frontend never switches mode; several lifecycle races remain.

## Evidence → requirements

All eight JSON exports were parsed (two are snapshots of the same eayZEaQwHb conversation), including tool arguments/results. Screenshot observations exclude wallpaper/blur, as requested. Images establish appearance, not whether a button executes.

| Evidence | Observation | Area / acceptance check |
|---|---|---|
| `chat-Z0IgQs8OIL.json`, user ABpKi7SbH9PO | Explicit inline pie chart becomes fs_write + canvas_open; .html contains Blocks markup | Prompt + rendering: inline first, no file/tool for simple chart |
| Same chat, pulley/manim turns | Missing invented reference path; poor pulley diagram; Python/module execution attempts | Skill discovery; TikZ for static diagrams, optional Manim for animation; native video |
| `chat-eayZEaQwHb.json` and `(1)` | Repeated repairs, mixed event syntaxes; “start/stop doesn't work”, “start button doesn't start it”; browser calls use nonexistent action fields | Runtime compatibility + examples + actual interaction assertions, inline AND fill |
| `chat-s18ZXLEYZF.json` | PIL/cv2 missing; pip_install succeeds but imports still fail; eventually --break-system-packages | Same interpreter/mount for pip and Python; no silent installation mismatch |
| `chat-AM29UDh72n.json` | Empty fs_write args hit workspace directory; unquoted spaced cwd; host_shell used for persistent server; erroneous proc_stop repeat | Validate tool args before effects; actionable errors; separate foreground/background and sandbox/host |
| `chat-v_Te4f_I6W.json` | Many searches for Discord/browser extensions after assuming DMS means Discord; user corrects it | Preserve exact proper nouns, resolve ambiguity before repeated searches; targeted official docs |
| `chat-xMMW8--8di.json` | Broad searches through global files/chats to infer missing context | Per-chat workspace, explicit cross-chat access, readable/paged chat exports |
| `chat-kz4GO_CcA1.json` | Cava host issue starts by reading unrelated workspace/upload/README | Inspect relevant host environment when enabled, search exact user's software |
| Screenshots 2026-09-26 15-27-* | Graph panels include empty parametric/implicit plots and width-dependent distortion | Equation support + non-stretched coordinates/labels at multiple widths |
| Screenshots 2026-09-27 00-41-* / 00-42-* | Quiz, timer, chart, failed bindings and extra artifact icon evidence across set | Replay actual exports, timer buttons, choice submit/custom/skip, no stray per-read artifact button |
| Screenshots 2026-09-25 12-52-21 / 2026-09-26 11-02-43 / 15-20-25 | Visual reference and Blocks failures (including malformed drawing/counter presentation) | Preserve Quiet Paper design; validate content rather than flagging background blur |
| Journal (`note.txt`, user message) | Chat switching/Stop loses progress; drafts vanish; paste doesn't open; input overlaps thread | Server-owned runs; explicit stop; draft isolation/reload; paste; resizable nonoverlapping panels |
| Journal | Search-first landing, History separate from Chats, promote to chat, fast search/fetch | Complete frontend/backend integration, preserve full trace on promotion |
| `chat with agent.txt`, discussion section | Memory profile/episodes/project notes with undo; Android/adb; deep research/background/scheduled brief; Workspace MCP; copy semantics; sources/queue/file diffs | Not all restored by patch; track separately, do not claim complete |

## Remaining scope / verification ledger

Update this section at every checkpoint. No real provider keys from the attached logs will be used. Offline regressions validate application behavior, not model quality on real providers.

- Restored: patch's Blocks changes, chat-run registry, live output, per-chat artifact paths, chat canvas viewer, search backend, sudo prompt scaffolding, TikZ backend and local vendor assets.
- Hardening in progress: run replay/races, drafts, search frontend, tool validation, stop/error persistence, provider reasoning compatibility, regression portability.
- Not yet verified: real DeepSeek/FreeLLMAPI/Firecrawl, password sudo on user's host, real Manim rendering, every Blocks vendor under offline networking.
- Discussion features still need dedicated work: inspectable memory with undo, Android device tools, scheduled morning brief, credential/OAuth connector UX, file-diff viewer.
- Architectural limit: run registry is process-local. Browser disconnect/reload is supported; server restart/multi-worker durable continuation is not.
