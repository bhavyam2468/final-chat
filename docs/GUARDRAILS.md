# Guardrails

Where models reliably go wrong, and what the harness does about it. Principle: a rule in the prompt is advice; a guard in code runs whatever the model does. Prompt lines exist only where code cannot decide (SYSTEM.md → Truth / Code / Quality).

Every guard is silent until it fires, adds nothing to the context of a plain chat, and is off-switchable through `QUALITY_GUARD=fix|warn|off` where it costs a model round.

Try each one offline: developer mode → `__dev.mock()` → send `guard:<name>`.

| Failure | Evidence | Guard | Where | Try |
|---|---|---|---|---|
| `<think>` blocks leak into answers and get re-sent every turn; distills drop the opening tag | DeepSeek-R1 / Qwen3 / QwQ chat templates | Split `<think>`/`<thinking>`/`<reasoning>` across chunk boundaries; orphan `</think>` retracts the text already shown; `reasoning_content` deltas; collapsed "Thought for Ns"; never copied, never re-sent; stripped from summaries too | `harness/stream.ts` ReasoningSplitter, `llm.ts complete()`, `context.ts assistantText` | `think` `orphan` `reasoning` |
| Endless repetition (the same sentence until the token limit) | R1-Zero, QwQ reports; quantized small models | Tail check every ~240 chars (text) / 600 chars (reasoning), cut at a sentence end, one "continue without repeating" retry, then stop | `findLoop` + agent stream loop | `loop` |
| Tool call printed as text instead of called | Cline #10843, LocalLLaMA reports; qwen2.5-coder, Gemini `tool_code` | Parse `{"name","arguments"}`, `<tool_call>`, `<function=…>` (Qwen3-coder XML), `default_api.fn(...)`; only known tool names; promoted to a real call; the text is removed | `extractTextCalls` | `textcall` `toolcode` |
| Same failing call over and over | OpenHands StuckDetector | Same call+result ×3 or same error ×3 → one nudge in the tool result; ×4 → stop the turn. A/B ping-pong over 6 calls → nudge | `harness/stuck.ts` | `stuck` |
| Stray Chinese/Japanese/Korean tokens in non-CJK replies | R1-distill Qwen; median span 2 chars | Off unless the user writes CJK. Fullwidth punctuation fixed locally; words replaced by one short call; code blocks ignored | `foreignSpans`, `fixForeign` | `cjk` |
| Fabricated citations | Tow Center 2025: >60% wrong, most Gemini/Grok citations broken; SourceCheckup: 55% supported | Links never seen in a search result, fetched page, pinned file or user message → dotted underline + tooltip. In web-backed answers (fix mode) one forced round: fetch or drop them | `unverifiedUrls`, agent citation round, `StreamMarkdown` `.sm-unv` | `cite` |
| Hallucinated packages ("slopsquatting") | USENIX Sec 2025: 19.7% of 576k samples; 43% repeat every run | pip/npm/uv/pnpm/yarn/bun installs (tool or shell) checked against PyPI/npm, 3s timeout, offline = allow. Missing → refused with advice; first published < 45 days and < 5 versions → approval | `harness/guard.ts` installTargets / checkInstalls | `pkg` |
| Destructive commands | Replit DB deletion, Gemini CLI mv-overwrite (July 2025) | Recursive delete of non-build paths (host), `/ ~ * .` anywhere, reset --hard, clean -f, force push, checkout -- ., branch -D, DROP/TRUNCATE/DELETE without WHERE, mkfs/dd/wipefs, curl \| sh on host, docker volume prune… → held; the user sees the command + reason and clicks Run it / Deny. The approval is one-time and bound to the exact command (hash kept server-side) | `destructive`, `approvalGate`, `/api/conversations/:id/approve` | `danger` |
| Silent overwrite / unrecoverable delete | Gemini CLI incident | `fs_move` refuses to replace an existing file unless `overwrite=true`, moves into folders (`to/`), reports the real destination; `fs_delete` → `workspace/.trash/` or the desktop Trash | `tools/index.ts` | — |
| Sandbox git reaching an enclosing repository | Found while building this: an approved `git reset --hard` in the workspace reset the app's own checkout (no bwrap) | `GIT_CEILING_DIRECTORIES` = the workspace's parent for every sandbox command | `exec.ts baseEnv` | — |
| Reward hacking in code | Claude 3.7 system card; ImpossibleBench; METR | After a coding turn: newly added suppressions, skipped tests, empty catch, stubs, "special case for tests", hardcoded keys, tests edited or assertions removed when the user never mentioned tests | `harness/integrity.ts` | `integrity` |
| "Done" without running anything | Anthropic long-running harness notes | Code changed and nothing ran after the last edit → the check asks to run it or say it is untested | agent quality round | `integrity` |
| Generic AI design (neon, purple gradients, stripe cards, glass, sparkle badges, count-ups…) | avoid-ai-design catalogue, Impeccable, Anthropic cookbook | Design lint on touched UI files; one repair round. **The brief wins**: rules whose subject the user asked for stand down | `harness/slop.ts` | `slop` |
| AI prose tells in documents | Wikipedia "Signs of AI writing"; Pangram frequency data | Markdown files the agent writes: stock phrases, "not just X but Y", em-dash density, over-bolding | `slopLint(kind=md)` | — |
| Sycophantic openers and closers | SycEval (58% flip under pushback) | First sentence held until it can be judged; "Great question!", "Certainly! Here's" dropped; trailing "Let me know if…" paragraph trimmed. Bare "Sure." as an answer is kept | `OpenerGate`, `trimCloser`; SYSTEM.md Truth | `filler` |
| LaTeX in `\( \)` / `\[ \]` shown raw | DeepSeek, Qwen output style | Both delimiters render with KaTeX | `StreamMarkdown` | — |

## Limits

- The destructive-command parser is pattern-based, not a shell parser. It catches the common forms; `eval "$(echo …)"` style obfuscation is out of scope (the prompt forbids disguising commands, and the sandbox is the real boundary).
- The citation check proves a link was *seen*, not that it *supports* the claim.
- The integrity diff only compares the file before this turn's first write with the file at the end of the turn; edits made through `shell` (sed -i) are not snapshotted.
- CJK repair needs one extra model call when the span is a word; it is skipped if that call fails.

## Tests

`node --experimental-strip-types --no-warnings dev/tests/guards.test.ts` (unit) and the `guard:*` mock scenarios (end to end).
