# Harness research and implementation decisions — 2026-09-27

This is a fresh source review, not a reproduction of the previous agent's unverified research claims. The attached conversations are our regression evidence. Reading a paper does not establish that a prompt improves this app; real-provider comparative evaluations remain necessary.

## Sources read / checked

1. Anthropic, *Writing effective tools for agents* (2025-09-11): clear tool boundaries, meaningful tool results, typed unambiguous inputs, pagination/ranges and evaluation using real tasks. [2](https://www.anthropic.com/engineering/writing-tools-for-agents)
2. Anthropic, *Effective context engineering for AI agents* (2025-09-29): focused instruction sections, just-in-time retrieval, tool-result clearing, careful compaction and persistent notes. More prompt text is not automatically better context. [1](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
3. Google Research, *Towards a science of scaling agent systems* (2026-01-28): measured coordination overhead and sequential-task degradation caution against automatically adding multiple agents. This is evidence for evaluating architecture per task, not a universal performance prediction for our app. [3](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)
4. Google Gemini Deep Research API documentation: long-running tasks run in background; collaborative planning and explicit treatment of missing information are supported patterns. We are adopting the lifecycle principle, not depending on this paid API. [2](https://ai.google.dev/gemini-api/docs/interactions/deep-research)
5. DeepSeek current thinking-mode documentation: tool-enabled requests require provider `reasoning_content` round trips. Do not apply an old blanket “never resend reasoning” rule to in-turn tool continuations. [1](https://api-docs.deepseek.com/guides/thinking_mode/)
6. DeepSeek-V3.1 model card: version-specific tool templates differ between thinking/non-thinking modes. A generic OpenAI-compatible URL does not imply identical provider semantics. [2](https://huggingface.co/deepseek-ai/DeepSeek-V3.1)
7. Firsthand source inspection: [Codex gpt-5.2-codex prompt](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt-5.2-codex_prompt.md). Relevant patterns: small-task proportionality, respect existing work, explicit destructive-action boundaries, concise reporting and preservation of existing design systems. We do **not** copy its unrelated default design tastes or identity.
8. Firsthand source inspection: [OpenHands summary prompt](https://raw.githubusercontent.com/OpenHands/software-agent-sdk/main/openhands-sdk/openhands/sdk/context/condenser/prompts/summarizing_system.j2). Relevant pattern: preserve requirements, task IDs/status, completed vs pending, errors/tests, file paths and version-control state. Memory should record evidence and unresolved work, not just a generic prose recap.

Two older guessed raw GitHub paths returned 404; the working paths above were found through repository trees. This is exactly why invented skill/reference paths are a poor recovery strategy.

## Applied here

- **Typed execution contracts:** validate built-in tool argument structure before effects. An empty fs_write now gets a missing-field error instead of opening the workspace directory. Reject `host: "True"` and nonexistent browser action keys rather than silently ignoring them.
- **Evidence-driven prompt changes:** exact product names/acronyms; change the hypothesis after unhelpful searches; finite foreground commands vs background servers; shared Python interpreter; explicit untrusted-data boundaries. These target observed failures, not personality polishing.
- **Inline Blocks in main prompt:** restored concrete catalog examples, simple bindings and timer API; fuller layout/form instructions remain lazy-loaded. Static diagrams use the restored TikZ component; Manim remains optional, not silently installed.
- **Lifecycle in code, not prompt:** per-conversation runs, synchronous admission reservation, replay reset, output bounds, explicit Stop and process-group termination. Browser disconnect does not cancel a run. These invariants cannot be solved by asking the model to behave better.
- **Reasoning transport:** retain provider-supplied reasoning_content within native tool continuations and include it in token accounting. Not synthesized from visible text. This is not a complete adapter for every provider's signed reasoning/history protocol.
- **Search latency:** speculative presearch only for recognizable lookup/current-info intent. No presearch for every ordinary question. Other queries remain model-adaptive with the same tools. Firecrawl operations inherit cancellation and retain finite timeouts.
- **Verification:** deterministic tool/lifecycle tests, offline model chat/search E2E, Blocks interaction tests in both sizes, and production build. Keep real-model quality claims separate.

## Next evaluations (not claimed complete)

Replay a redacted corpus of the user's actual prompts against their configured model, once with the baseline prompt and once with the new prompt. Record: correct tool schema on first call, unrelated searches, repeated failures, tokens, time to first visible activity, task completion and inline/canvas choice. Use a separate workspace for each run. Include adversarial retrieved instructions and provider-specific tool/reasoning transcripts.

Do not optimize only for lower token count or a successful HTTP response. Font identification, physical diagrams and host troubleshooting require semantic/visual checks that the offline model cannot provide.
