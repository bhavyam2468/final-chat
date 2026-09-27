# Stress-test requirements and evidence matrix

Intake: 2026-09-27. Baseline: `b2e7d14`. **No reported defect or new feature is marked fixed.**

## Evidence register

| ID | Evidence | Availability |
| --- | --- | --- |
| J | User's stress-test journal and surrounding instructions | Present in initial conversation; summarized below |
| A | `chat with agent.txt` | Missing; not read |
| C | App conversation exports/tool traces | Missing; not read |
| S | Screenshots | Missing; not viewed |
| P | Previous agent's overlapping full patch | Offered; requested; not received |
| B | This checkout's code and baseline checks | Inspected; see `RECOVERY.md` |

Every row currently has **J only as user evidence**. The code findings are independent evidence B, not a substitute for C/S. Attach exact message/tool IDs and screenshot filenames when they arrive. The earlier agent's research claims have not been accepted on trust.

Layer: **R** runtime/data/UI, **T** tool or provider contract, **P** prompting. Priority **0** prevents data loss, cross-chat leakage or unsafe execution; **1** repairs core interactions; **2** adds workflow/polish. This is implementation ordering, not permission to drop lower-priority work.

| ID | Request / complaint | Layer / priority | Baseline finding / evidence still needed | Acceptance criterion (not yet passed) |
| --- | --- | --- | --- | --- |
| ST-01 | Expanded input overlaps thread panel | R / 1 | Global fixed `.dock`; composer width based on viewport. Need S for layout and viewport. | Long prompt stays inside its chat column with thread/workspace/canvas open at narrow and wide widths. |
| ST-02 | Thread panel horizontally resizable | R / 1 | Docked canvas has resize code; thread requires separate audit. | Pointer and keyboard resizing, sensible minimums, persisted width, no composer overlap. |
| ST-03 | Each chat owns workspace by default | R,T / 0 | `WS` is global; no conversation scope in path API. | Same relative filename in A/B stays separate; migration preserves existing files. |
| ST-04 | Explicit global workspace access | R,T,P / 1 | Shared root is default today. | Clear local/global browsing and tool scope; explicit cross-chat access without accidental context inclusion. |
| ST-05 | Chats visible in workspace; multiple chats in canvases | R / 2 | JSON chat mirrors exist; ordinary file opening does not create a chat session. | Open B in canvas while A remains usable; each has independent draft, context, run and interactions. |
| ST-06 | AI can read other chats; better long-file reads | T,P / 1 | `fs_read(start,end)` already exists with 250-line cap. Need actual bad-call traces. | Search/list/read by chat/message/range with truncation and continuation metadata; no unrequested entire transcript in prompt. |
| ST-07 | Chat-specific artifacts | R,T / 0 | Global title-derived canvas paths can collide. | Same artifact title in two chats cannot overwrite either; own artifacts are default, global view explicit. |
| ST-08 | Timer/Pomodoro buttons unreliable | R,T,P / 1 | start/stop/toggle/reset/set methods exist; seconds attribute synchronizes on render. Need C's actual source. | Start/pause/resume/reset/duration changes and completion events work before/after resize and canvas promotion; intervals cleaned up. |
| ST-09 | Blocks generation unreliable / poor UI | R,T,P / 1 | Runtime, catalog and skill maintained separately; existing Blocks lint is limited. | Fixture-backed contract validation; bounded repair; helpful error without blanking valid siblings. |
| ST-10 | Discover common Blocks naturally | P,T / 1 | Base prompt has little syntax and gates on skill. | Small tested common-component reference; model uses useful interactive visuals without explicit demand and without decorating every answer. |
| ST-11 | Prefer inline Blocks; canvas deliberate | P,R / 1 | Prompt positions canvas for tools/tests/dashboards; exact model traces missing. | Ordinary timer/quiz/graph inline; pinned reference or explicit user request opens canvas; no duplicated UI. |
| ST-12 | Native graphs rather than matplotlib | P,T / 1 | Prompt explicitly says save Python plots to files. | Native graph/chart when supported; Python may compute data, not silently replace supported graph UI; explain real exceptions. |
| ST-13 | Physics diagrams; assess Manim | T,P,R / 2 | Native `x-draw` exists. No evidence yet of specific incorrect physics. | Check units, labels, geometry and scientific content; use reproducible Manim video when motion adds value, not as correctness guarantee. |
| ST-14 | Canvas video playback | R,T,P / 1 | Player already exists; Range/MIME serving needs work. | Open representative supported clips, play/pause/seek/resize and useful failure state; no claim every codec works. |
| ST-15 | Graph stretches with canvas width | R / 1 | `x-graph` fixed 400-wide viewBox with `preserveAspectRatio=none`. | Resize preserves intended unit/aspect policy; circles stay circular in equal mode; pan/zoom/hover remain accurate. |
| ST-16 | Components work inline but not canvas, especially questions | R / 1 | Shared Block renderer exists; event ownership is global. Need failing C/S. | Same fixture and event destination across inline/floating/docked modes, including background-chat canvas. |
| ST-17 | Keep chemistry working | R / 1 | User reports success; no attached successful fixture yet. | Existing SMILES/3D examples preserved in all modes and themes. |
| ST-18 | Custom answer and skip | R,T,P / 1 | No first-class flags in `ask_user` or `x-choice`; separate generated inputs possible. | Explicit custom/skip schema, accessible controls, meaningful answer payload and no forced selection. |
| ST-19 | Borrow useful OpenUI ideas | R,T,P / 2 | Earlier report proposes validation, patches, live bindings etc.; no blanket verified implementation. | Map accepted ideas from A; schema-derived guidance, bounded repair and incremental updates evaluated separately; tool-bound UI permission-reviewed. |
| ST-20 | Premium minimal design; retain good chart animations | R / 2 | Existing Quiet Paper design document. No screenshot comparison available. | Consistent buttons/borders/loaders, focus, reduced-motion support and interaction feedback; no wallpaper-related false defects. |
| ST-21 | Unwanted artifact button under read/write calls | R / 1 | `ToolCall.openable` includes reads/writes and renders extra button. | Compact tool rows; artifacts shown as deliverables rather than every file read; file inspection remains available on demand. |
| ST-22 | Multiline tool labels (e.g. host execution) | R / 1 | Need screenshot and width to reproduce. | Stable concise status row; long args/output in expandable body, no clipped critical state. |
| ST-23 | Sudo cannot get password noninteractively | T,R,P / 0 | Askpass / `sudo -n` already implemented; host/access gates exist. | Deterministic fake-sudo tests plus user-side verification; actionable permission errors; no passwords in model context, commands, logs or exports. |
| ST-24 | Ctrl/Cmd+V opens composer naturally | R / 1 | Capture ignores modifiers; paste handler only on textarea. | Text/image paste from noneditable surface reaches correct composer; native paste in other fields is untouched. |
| ST-25 | Python feels broken; no live tool output | T,R / 1 | Spawn buffers stdout/stderr; run_python schema minimal. Need C for execution errors. | Correct interpreter/cwd, real streaming output, no silent exceptions, bounded logs, timeout/abort results. |
| ST-26 | Thinking/tool stays expanded while running; no random silence | R,T / 1 | Reasoning defaults collapsed; pending tool body hidden. | Genuine model/tool activity visible and user-collapse respected; elapsed/heartbeat when no output exists; never fabricate reasoning/progress. |
| ST-27 | Switching chats shares Responding/Stop and hides history | R / 0 | Single global stream/messages/abort in App. | A continues while B can send; A's partial history visible on return; metadata and completion cannot mutate B. |
| ST-28 | Draft survives switching/reload | R / 0 | Composer state only, no persistence. | Text and uploaded attachment references/quote scoped to chat/thread; clear on accepted send; handle unavailable browser storage. |
| ST-29 | Stop preserves partial response | R,T / 0 | End-only assistant insert plus timed refetch; tools lack cancellation signal. | Partial content durable after stop/reload, tools terminate, explicit stopped state, no unrelated request canceled. |
| ST-30 | High token burn; accurate usage visibility | T,R,P / 1 | Context estimate exists; user estimate >15M unverified. | Record actual provider usage when present, label estimates, show retries/repair costs; bounded loops, targeted retrieval and held-out task-quality checks. |
| ST-31 | Default temporary adaptive search/answer/action surface | R,P,T / 2 | Current root is chat UI; DB has no session-kind field. | Centered empty composer; natural answer/search/action with explicit intent override and current-fact verification; not brittle first-token routing. |
| ST-32 | Separate lightweight History from saved Chats | R / 2 | No history/chat distinction in schema. | Quick sessions absent from Chats; searchable history preserves answers/sources with documented retention; saved chats retain full traces. |
| ST-33 | Promote temporary session into full chat | R / 2 | Not implemented in baseline. | Atomic promotion, no duplicate messages, preserve current draft/resources; honestly handle already-discarded traces. |
| ST-34 | Faster search/fetch/scrape | T,R / 1 | Sequential local/cloud Firecrawl fallback; no measured latency yet. | Separate snippets/search from deep scrape, cancellation/cache/bounded concurrency; measure p50/p95 and first-results latency with failures. |
| ST-35 | Search-backed freshness and command verification | P,T / 1 | Existing prompt requires freshness search; enforcement/trace quality unknown. | Inspect local versions, consult relevant current primary docs for version-sensitive commands; cite opened sources; no unnecessary web dependency for simple timeless answers. |
| ST-36 | Previously discussed “discussions” feature | Unknown / 2 | Meaning blocked on A; do not equate it to existing threads. | Recover exact agreed scope from previous chat before implementation. |
| ST-37 | Deep independent harness research | T,P / 1 | First primary-source round documented; no live-model evaluation yet. | Trace-backed hypotheses, pinned implementations, provider contract checks, repeatable held-out comparison; no guaranteed gains from prompt length. |
| ST-38 | Commit and push recoverable checkpoints | Workflow / 0 | Authorized by user; recovery docs created. | Each coherent checkpoint includes tests/status/next action and verified remote push; keep raw private evidence out of Git. |

## Additional audit risks to test, not user-reported conclusions

- **AR-01:** provider reasoning fields dropped in tool follow-up. Cross-reference ST-09, ST-25, ST-37; actual proxy/model needs validation.
- **AR-02:** Blocks bridge checks a payload frame ID, not `MessageEvent.source`; binding tool-capable messages to an actual frame/session must precede adding more live bindings.
- **AR-03:** sandbox has a documented soft fallback when bubblewrap is unavailable. Do not describe cwd/env scoping or separate chat folders as security isolation.
- **AR-04:** printed tool-call text can be promoted into execution. Test quoted examples, malformed output and untrusted content before expanding this compatibility behavior.

## Evidence mapping format for the next checkpoint

`ST-ID -> filename/SHA256 -> conversation ID -> message ID -> tool-call ID or Blocks source -> screenshot -> exact observation -> reproduction -> fix commit -> passed regression`

Keep hypotheses visibly separate from reproductions. Add successful cases as regression fixtures, not just broken ones. Do not mark a whole row passing when only one subcase was checked.
