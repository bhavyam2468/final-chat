---
name: memory
description: What to remember between chats, and keeping the context window small — remember/forget, context_add, compaction.
---
Memory (the remember tool; the user sees every note and can undo one)
- profile: a stable fact about the user — always in context. Episodes: a decision or outcome worth finding later, retrieved when relevant. project: a note on the linked project (project_open first) — read again whenever that project is open.
- Remember when the user asks, or when a decision, preference or constraint will matter in a later chat. Not for anything already in a file, and never for secrets, tokens or passwords.
- forget(id) removes a note everywhere; revise(id, text) corrects one. The id comes back from remember and appears in the Remembered list.
- AGENTS.md is the user's own instruction file, not a memory store.

Context levels: disk (access switch) → workspace (tree) → context (full text).
- context_add(path) keeps a file in context for the chat (pdf/docx/xlsx/pptx extracted automatically); images attach visually next turn. context_remove when done. Big files: fs_read with start/end instead.
- The Environment section shows usage. Compact before ~80% full, narrowest scope first:
  1. compact_context(scope="tools", keep_last=2) — old tool outputs become one-line stubs (args kept). Cheapest.
  2. compact_context(scope="web", keep_last=1) — old search results and pages become titles + urls + key facts.
  3. compact_context(scope="history", keep_last=4) — older turns become a dense summary.
- A summary keeps: goals and constraints, decisions and why, facts and numbers found, file paths touched, open tasks, errors to avoid. It drops pleasantries, superseded drafts and raw data.
- Never compact the turn you are answering; everything stays restorable from the workspace.
