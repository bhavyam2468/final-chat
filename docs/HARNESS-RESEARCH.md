# Harness research — independent first pass

Date accessed: **2026-09-27**. This is a first pass, not an exhaustive literature review, a reproduction of published benchmarks, or proof that the proposed changes improve this app. The user's exports, prior agent chat and patch are not yet available. No live-model experiments have been run.

## Working conclusion

Separate four problems before rewriting prompts:

1. **Product state:** a prompt cannot fix cross-chat message ownership or an abort/persistence race.
2. **Provider protocol:** a prompt cannot restore metadata the client drops between tool calls.
3. **Tool/runtime contracts:** a model cannot reliably use a timer or UI event whose documented behavior differs from implementation.
4. **Behavioral guidance:** only once the above work can examples, component discovery and inline-first preferences be evaluated fairly.

The user is willing to spend more prompt tokens. Use that budget for tested examples and clear contracts, not repetitive rules or full manuals on every turn. This is a proposed app-specific strategy, not a universal benchmark result.

## Primary sources inspected and implications

### Anthropic: long-running harnesses

Read the complete article, including its failure-mode table and testing section: *Effective harnesses for long-running agents* (2025-11-26). It describes initializer/coding workflows, persistent feature lists, progress notes and incremental commits. It also explicitly distinguishes browser end-to-end testing from code changes or command-line checks that merely look successful. [1](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

**Apply here:** evidence tracker + recovery log + coherent tested checkpoints. A build does not pass “timer buttons work.” Before each new feature, reproduce and repair existing breakage. Our recovery files implement the documentation portion only; browser regressions are still pending.

**Do not infer:** that this article proves a particular larger prompt, multi-agent architecture or uninterrupted overnight run is best for this app. The article itself leaves specialist-vs-generalist orchestration as an open question. [1](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

### Anthropic: tool design and evaluation

Read the prototype/evaluation guidance, trace-analysis section, namespacing, response-format, pagination and tool-description sections of *Writing effective tools for AI agents — with agents* (2025-09-11). The guidance emphasizes realistic outcome-based tasks, reading raw tool transcripts, measuring calls/errors/tokens/latency, and using held-out cases. It recommends meaningful results, explicit concise/detailed formats and actionable truncation/error feedback. [1](https://www.anthropic.com/engineering/writing-tools-for-agents)

**Apply here:** distinguish model choosing the wrong tool from schema ambiguity, transport failure and runtime defects. For file/chat readers, expose scoped search, ranges, explicit continuation and output budgets. For Python/shell, return exit status, truncation, execution environment and cancellation, with streamed chunks for users. Give invalid-call errors precise correction guidance.

**Do not infer:** “large model” means tool ergonomics do not matter, or “fewer tokens” is always better. Measure successful task completion and extra turns alongside output size.

### Anthropic: context engineering

Read the introduction, effective-context anatomy and just-in-time retrieval sections of *Effective context engineering for AI agents* (2025-09-29). It recommends the smallest high-signal context sufficient for the job, canonical examples rather than exhaustive edge-case lists, and just-in-time retrieval. It explicitly says minimal does not necessarily mean short. The later long-horizon techniques section was not fully reviewed in this pass. [1](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

**Apply here:** a compact tested Blocks “everyday vocabulary” in the main prompt, full examples via catalog/skill, and explicit “inline unless it must stay beside the conversation.” Retrieve other chats intentionally; don't inject every global chat and workspace file.

**Do not infer:** that all detailed instructions should move out of the system prompt. The user needs frequent native UI; its basic syntax and selection guidance should be immediately available.

### Anthropic: session, harness and execution boundaries

Read the architecture, recovery and security sections of *Scaling Managed Agents: Decoupling the brain from the hands* (2026-04-08). The article separates a durable session event log, the agent loop, and the execution environment. It describes recovery from recorded events and keeping credentials away from untrusted execution. This is an engineering architecture account, not a comparative UI benchmark. [2](https://www.anthropic.com/engineering/managed-agents)

**Apply here:** durable conversation/run ownership independent of whichever chat is visible. Persist progress before final completion; separate event storage from the model's context projection. Keep per-chat files explicit without pretending folders alone are a security boundary.

**Do not copy blindly:** a distributed cloud service architecture. This local app can keep deployment simple while adopting those ownership boundaries. Network disconnect, explicit Stop and process crash need distinct semantics. No automatic retry of side-effecting operations without idempotency.

### Google DeepMind: AutoHarness

Read abstract, introduction, method, training and the start of evaluation in *AutoHarness: improving LLM agents by automatically synthesizing a code harness*, version 1. The study learns executable action verifiers and policies with environment feedback in TextArena games. Free-form-dialogue games are excluded; final gameplay evaluation covers a subset of the legality-test games. Appendices and complete results were not reviewed in this pass. [1](https://arxiv.org/html/2603.03329v1)

**Apply here:** enforce deterministic invariants in code: complete argument parsing, allowed tool name, required arguments, authorized scope, valid component contract, bounded repair. Let the model choose useful content within those constraints.

**Do not infer:** game legality improvements guarantee scientific diagram correctness, prompt quality or browser UX. A valid graph can still be the wrong graph; a rendered physics diagram can still violate physics. Evaluate structure and semantic correctness separately. Do not adopt self-modifying production validators from this paper without review.

### DeepSeek: current thinking/tool wire protocol

Read official *Thinking Mode*, including input/output parameters and tool-call replay requirements. The current guide says that thinking requests carrying `tools` must pass `reasoning_content` back on subsequent requests, including relevant assistant turns without tool calls, and describes a 400 error when required content is absent. Requests without tools behave differently. [1](https://api-docs.deepseek.com/guides/thinking_mode/)

**Local finding:** `agent.ts` accumulates provider `reasoning_content`, but its `loopMsgs.push({ role: "assistant", content, tool_calls })` omits it; `OAMsg` in `llm.ts` has no field for it. This is a concrete compatibility gap for providers enforcing that contract.

**Required before repair:** identify the actual FreeLLMAPI model/version/mode and capture a redacted request/response fixture. Preserve provider-required metadata per provider capability, across tool rounds and persistence as needed; do not synthesize missing provider reasoning or send it indiscriminately to other providers. Displayed thinking and protocol replay data must be separate concerns. Do not repair a protocol failure by asking the model to restate its thinking.

**Version caveat:** old V3.1 model-card guidance and the current API contract differ. Pin the version under test and record the observed proxy behavior; “OpenAI-compatible” does not establish identical reasoning/tool semantics.

## First-hand open-source prompt / implementation inspection

Retrieved through GitHub's API at the exact commits below. These are source inspections, not benchmark replications. Only the indicated files/sections were examined, not entire projects. No upstream code is vendored in this checkpoint.

| Project / pinned source | What was actually read | Useful mechanism; caution |
| --- | --- | --- |
| [Google Gemini CLI `snippets.ts`](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/prompts/snippets.ts) | Core mandates/context-efficiency examples and primary development lifecycle; surrounding tool-rule sections searched | Explicit examples of scoped reads, enough context to avoid extra turns, research/plan/act/validate, empirically reproduce before fix. It even warns changes to context-efficiency guidance need benchmark checks. Do not copy its tool names, permission assumptions or entire prompt. |
| [OpenAI Codex `gpt-5.2-codex_prompt.md`](https://github.com/openai/codex/blob/334b6e7321d55697a2415a42e1725c814d3c0df4/codex-rs/core/gpt-5.2-codex_prompt.md) | Complete 80-line prompt file | Conditional planning, dirty-worktree preservation, named editing/search behaviors and exception for an existing design system. Some generic frontend guidance conflicts with Quiet Paper; copying multiple harnesses verbatim would introduce contradictions. |
| [SWE-agent `config/default.yaml`](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/config/default.yaml) | Complete config | Concrete reproduce -> edit -> rerun -> edge-case workflow and separate tool/env configuration. Its benchmark-specific instructions to avoid/revert test edits and remove reproduction scripts are inappropriate for our product regression suite. Keep our tests. |
| [OpenUI prompt compiler example](https://github.com/thesysdev/openui/blob/faf911b81458240294c6a20cbb2f5427339adf34/examples/harnesses/grok-build/src/lib/openui-prompt.ts) and [system-prompt documentation](https://github.com/thesysdev/openui/blob/faf911b81458240294c6a20cbb2f5427339adf34/docs/content/docs/openui-lang/system-prompts.mdx) | Complete small compiler adapter and documentation through generated-content sections | Prompt generated from a serialized library spec; feature flags for bindings, tool calls, edits and inline mode. Share a component contract between runtime validation, tool discovery and prompt examples. This inspection does not verify the previous report's numerical claims, complete parser, autofix behavior or benchmark results. |

### What “better system prompt” means for this app

Proposed organization, to evaluate after runtime fixes:

1. **Stable core:** role, current environment, user-controlled access, truthful source handling, tool-vs-text boundaries, visible results and reporting verification limits.
2. **Immediate useful capabilities:** common native Blocks with tiny correct examples; inline default; canvas purpose; current chat scope and explicit global lookup.
3. **Task guidance on demand:** research, code, science, richer layouts. Canonical examples from executable fixtures rather than a second hand-maintained API reference.
4. **Provider adapter outside the prompt:** request modes, required replay fields, delta assembly, finish reasons and unsupported-capability errors.
5. **Deterministic checks outside the prompt:** schema validation, authorization, cancellation, event ownership, timers, aspect ratio, persistence and retry limits.

Keep good chemistry untouched. Replace conflicting plot/canvas guidance instead of accumulating more negations. Strong tool failures should produce structured corrective feedback. Avoid pretending that stripping filler or policing visual tastes establishes correctness.

## Evaluation plan

Not implemented or run yet:

- **Replay suite:** redacted user failures plus successful chemistry/graph examples; exact model and provider metadata where available.
- **Deterministic UI tests:** identical fixture inline/docked/floating, resize, event routing, timer controls, custom/skip, slow/disconnected streams, stop/reload and simultaneous chats.
- **Provider fixtures:** split tool args, Unicode chunk boundaries, required reasoning fields, final chunk/finish reason, malformed JSON, tool error/retry, truncation and unknown model capabilities.
- **Prompt comparison:** existing prompt vs revised prompt with identical tools/model/task set; multiple repetitions; held-out variants. Measure task success, valid native UI, unnecessary canvases, wrong tools, unsupported APIs, repair rounds, token use and latency.
- **Search experiments:** separate first-results latency from final answer; compare lightweight result retrieval vs selective full-page fetch; record p50/p95, cold/warm cache and local/cloud failure paths. Explicit fresh mode must not use a stale cache silently.
- **Scientific review:** structure/render validity is not physics or chemistry validity. Test numerical invariants and use trusted references/manual review for diagrams.

## Remaining research / evidence gaps

- User's actual trajectories, screenshots, previous accepted decisions and patch.
- Full OpenUI validator/repair/edit implementation, tests and licensing review before any code reuse; published benchmark claims not independently reproduced.
- DeepSeek research-paper review beyond the API/model protocol source; no claim to have covered its paper corpus.
- Full AutoHarness results/appendices and broader DeepMind agent work.
- Manim execution, dependency footprint and reproducible video workflow; do not assume it is installed or solves scientific correctness.
- Current search-provider contracts and latency in the user's local Firecrawl setup.
- Meaning of “discussions”; do not manufacture a feature from an absent conversation.

Research should continue against a specific failing trace or implementation decision, with a written hypothesis and measurable outcome. More links alone are not progress toward making the app less broken.
