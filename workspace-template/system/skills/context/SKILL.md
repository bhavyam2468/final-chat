---
name: context
description: Active context, file mentions, and scoped compaction for small context windows.
---
Levels: disk (home/full access) → workspace (tree visible) → context (content visible).
- context_add(path): file text stays in context for the chat (pdf/docx/xlsx/pptx extracted). Images attach visually next turn. context_remove when done.
- Big files: fs_read with start/end instead of context_add.
- The Environment section shows usage. Compact before ~80% full, narrowest scope first:
  1. compact_context(scope="tools", keep_last=2): old tool outputs → one-line stubs (args kept). Cheapest, lossless for decisions already made.
  2. compact_context(scope="web", keep_last=1): old search results/pages → titles+urls+key facts.
  3. compact_context(scope="history", keep_last=4): older turns → dense summary.
- Summaries must keep: user goals and constraints, decisions and why, facts/numbers found, file paths touched, open tasks, errors to avoid. Drop pleasantries, superseded drafts, raw data.
- Never compact the turn you are answering. The user can restore everything from the workspace panel.
