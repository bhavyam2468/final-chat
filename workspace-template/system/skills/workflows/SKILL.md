---
name: workflows
description: Automated multi-step workflows (Deep Research, code review, data synthesis, task pipelines) with progress tracking and context isolation.
---
# Workflows
Workflows execute structured multi-step tasks using tools, skills, and blocks while keeping the main conversation context clean.

## Built-in Workflows
1. **Deep Research** (`workflow_deep_research` or `/research topic`):
   - Deconstructs topics into multi-angle research queries
   - Parallel searches and parallel document fetches outside context
   - Saves complete research dossiers into `chats/<id>/artifacts/research-<slug>.md`
   - Synthesizes a comprehensive, cited report with an interactive overview block

## Creating Custom Workflows
Use `skill_create` to define repeatable workflows:
- Specify the input schema and goals
- Order background tool operations (search, fetch, analyze, verify)
- Save bulky intermediate artifacts to `chats/<id>/artifacts/` to preserve context budget
- Return clear summary reports and `<ui>` status blocks to the user
