# Recovery checkpoint — 2026-09-27

## Read this first

This is an **initial audit, not an implemented repair**. The user requested evidence mapping before implementation and offered a previous agent's large patch. No attachments were delivered with the initial message. Do not infer their contents or claim to have reproduced the user's sessions.

- Repository baseline: `b2e7d148b44a6c23d64edb8ab2752c8463785df9`.
- Working branch: `arena/01a0e160-final-chat`. Stay on this branch; push checkpoints here.
- Worktree was clean at intake.
- User explicitly authorized periodic commits **and pushes** to avoid losing progress.
- Runtime code and system prompts have **not** been changed in this checkpoint.
- Added repeatable `npm test` / `npm run check` commands for the existing tests, and recovery documentation.
- The requirements/evidence matrix is [STRESS-TEST-TRACKER.md](STRESS-TEST-TRACKER.md).
- Initial independent research and its limitations are [HARNESS-RESEARCH.md](HARNESS-RESEARCH.md). The previous OpenUI report is not treated as verified research.

## Missing evidence — ask for these before rebuilding overlapping features

1. `chat with agent.txt`: prior design decisions, research, and meaning of the proposed “discussions” feature.
2. App chat exports, including successful examples, complete tool arguments/results, model ID and provider if present.
3. Screenshots. User explicitly says unusual wallpapers/background blur come from their browser; do not diagnose those as app defects.
4. Previous agent's full patch, renamed `.txt` if necessary. User estimates +14,000/-3,000 lines and says its base predates BlocksUI, so it overlaps this baseline. **Do not apply blindly.**

The user was asked for all four. Uploading them is the immediate next action; no additional broad product questionnaire is needed.

## User intent to preserve

- Fix existing behavior first, then features, then regression testing. Do not substitute a cosmetic rewrite.
- More system-prompt tokens are acceptable when they improve reliability. Large models are the priority, but capability/protocol correctness must not be confused with model size.
- Blocks should be useful naturally and inline by default, not compulsory decoration. Canvas is a deliberate persistent reference surface.
- Chat-specific workspace/artifacts, explicit global browsing, and other chats readable/openable as interactive canvases.
- Independent concurrent chats; drafts persist; stopping preserves partial progress.
- Visible real activity during model/tool work, not fabricated progress or uninformative silence.
- Default landing experience is an adaptive temporary search/answer/action session, centered composer when empty. Separate lightweight history from full saved chats; allow promotion to a chat.
- Native graphing first; physics correctness; consider Manim where animation warrants it. Preserve working chemistry and chart animation.
- Quiet, premium UI: refine existing visual language, do not replace it with a dashboard or ban the user's browser effects.
- Search/current command verification without forcing web calls for every timeless general-knowledge answer.

## Baseline verification

Environment: Node `v22.22.3`; dependencies installed using `npm ci --no-audit --no-fund`.

| Check | Result | Limit |
| --- | --- | --- |
| `node --experimental-strip-types --no-warnings dev/tests/edit.test.ts` | 17 checks passed | Editing helpers and a small amount of design/Blocks lint only |
| `node --experimental-strip-types --no-warnings dev/tests/guards.test.ts` | 24 checks passed | Guard/stream helper checks; not agent end-to-end |
| `npm run check` (new convenience command) | Passed: both test files / 41 internal checks, types, lint | Re-runs existing checks; no new behavioral coverage claimed |
| `npm run typecheck` | Passed | Does not validate runtime Blocks JS/browser behavior |
| `npm run lint` | 0 errors, 13 warnings | Existing warnings; not suppressed or auto-fixed |
| `npm run build` | Passed | One existing Turbopack file-tracing warning involving `src/app/vendor/[...path]/route.ts` and `next.config.ts` |

No browser interaction tests, live model evaluations, Firecrawl latency measurements, host sudo execution, or attached-session replays have been performed. No application credentials were requested or provisioned. Passing these baseline checks does not establish that the reported problems are fixed.

## Strongest code findings (static inspection, not session reproduction)

1. `src/components/App.tsx`: one `msgs`, `streamId`, `abort` and `convRef` serves all conversations. `loadConv` replaces visible state while an old send continues. The `meta` handler rewrites every current message's `conversationId`, not only the initiating run's messages. Canvas/context events also target global state. `newChat` aborts the existing run. Fix ownership before enabling chat canvases or search sessions.
2. `src/lib/agent.ts`: assistant is inserted only at end of execution. `App.send` refetches after 300 ms even after abort. `exec.ts` tool processes do not accept the run's abort signal. A slow tool can delay saving, and the refetch can erase the visible partial message. Need durable run state, cancellation propagation, and ownership/version-aware reconciliation, not just a longer timeout.
3. `src/lib/agent.ts:389` and `src/lib/llm.ts`: provider `reasoning_content` is received but omitted from subsequent assistant messages. Current official DeepSeek thinking/tool protocol requires round-tripping it. Verify the actual model/proxy wire protocol before introducing a provider-aware adapter; do not indiscriminately attach these fields to all providers.
4. `src/lib/exec.ts`: stdout/stderr are collected until close, so Python/shell activity is not streamed. `Message.ToolCall` hides pending bodies even when opened; reasoning starts collapsed.
5. `src/components/Composer.tsx`: drafts are only component state. Capture ignores all Ctrl/Meta/Alt events; paste upload handling exists only on the textarea.
6. `src/lib/workspace.ts`: one process-global workspace root. `agent.ts` saves canvas artifacts using a title-derived path in global `artifacts/`; same-title cross-chat collisions are possible. Chats already have JSON mirrors under global `chats/` but opening one uses the ordinary file viewer.
7. `public/blocks/elements.js`: graph uses fixed width 400 and `preserveAspectRatio="none"`. Timer methods exist; reset/set interacts with render-time synchronization of the `seconds` attribute. Exact failing generated source is required before calling either the user's proven root cause.
8. `src/components/Canvas.tsx` / `viewers.tsx`: native video viewer already exists. File serving reads the whole file without Range support; MIME list has mp4 but not every extension recognized by Canvas. Distinguish missing player from media-route/codec/discovery failures.
9. `workspace-template/system/SYSTEM.md`: recommends Python plots saved to files, barely introduces inline Blocks, and says open the Blocks skill first. This can steer away from the user's native-first preference. Do not just append contradictory instructions.
10. `Message.AskCard`, `x-choice`, and tool schema have no first-class custom-answer or skip option. Generated forms can add separate controls but this is not parity.

## Recovery procedure once uploads arrive

1. Keep private exports, screenshots, credentials, and full raw patch out of Git. Use ignored local evidence storage. Commit only redacted fixtures and consent-appropriate summaries.
2. Inventory every attachment with exact filename and SHA-256. Assign evidence IDs. Map screenshot -> export/conversation -> message/tool call -> tracker item. Record ambiguity instead of guessing.
3. Read the full previous agent chat and relevant successful/failed trajectories. Extract accepted feature decisions (including “discussions”). Classify each failure: prompting, tool contract/protocol, runtime implementation, or combination.
4. Inspect patch file paths and diff metadata, including deletions and non-code content. Use `git apply --stat`/`--numstat` and read-only `--check` where applicable. Compare overlapping hunks to current files; recover coherent units selectively. Do not use blind three-way application or change branches.
5. Add deterministic reproductions first. Initial priority: cross-chat stream ownership; stop while text/tool streams; persistence and reload. Then Blocks parity, tool observability and provider protocol.
6. Implement/test/commit/push one coherent unit at a time. Update this file and the tracker in the same checkpoint. Record exact passed tests and unverified paths; never mark all features complete based on a build.
7. After foundations, add scoped workspace/chat canvases and adaptive quick mode, then polish and live-model evaluations with the user's configured providers.

## Proposed regression gates (not implemented yet)

- Delayed/chunked mock model: switch A -> B before metadata, during reasoning, during tool args, during tool output, and at completion. A's data never appears in B.
- Stop during text and Python subprocess; partial content survives refetch/reload; no continued side effects; unrelated chat continues.
- Out-of-order conversation loads, disconnects, duplicate submits, failed persistence, and failed provider response are observable and non-destructive.
- Exact same Blocks fixture inline, floating and docked: timer controls, graph resize/pan/zoom, question submit/custom/skip, chemistry and file video.
- Quick mode/history -> saved-chat promotion retains displayed content and required resources without manufacturing previously discarded tool logs.
- Provider contract fixtures cover split JSON/tool deltas, reasoning round-trip, truncation, finish reasons, duplicate IDs and malformed calls. Never execute an incomplete call.
- Live evals separate structural validity, task correctness, unnecessary canvas/tool usage, latency and token cost. Use held-out variants, not only the user's original examples.
