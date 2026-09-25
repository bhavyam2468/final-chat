---
name: context
description: Managing active context, file mentions, compaction for small context windows.
---
Levels: disk (full access mode only) -> workspace (tree visible) -> context (content visible).
- context_add(path): pulls file text into context for rest of chat. PDFs/docx/xlsx are extracted to text. Images are attached visually on next turn.
- context_remove(path) when finished to free tokens.
- Big files: fs_read with start/end line ranges instead of context_add.
- compact_context(): replaces older history with a dense summary (decisions, facts, open tasks, file paths touched, tool results that matter). Call when history feels long or user asks.
