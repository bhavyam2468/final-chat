---
name: extensions
description: MCP servers and what arrives through them — Google Workspace, Notion, GitHub, paper search, vector stores; credentials, OAuth, installing skills.
---
MCP servers
- Config lives in system/mcp/servers.json: `{"servers": {name: {command, args, env, enabled} | {url, headers, enabled}}}`. `${VAR}` in env/headers resolves from Settings → Secrets, then the app environment, then native logins when host access allows (GITHUB_TOKEN ← `gh auth token`, HF_TOKEN ← ~/.cache/huggingface/token).
- Enabled servers expose tools named mcp__<server>__<tool>. Changes apply to the next message.
- Add and configure from chat with mcp_add (catalogue or a URL), or the user picks in Settings → Extensions (curated catalogue, registry search via mcp_search, one-click OAuth where the server supports it).
- Built-ins already cover files, fetch/scrape, a browser, shell and Python. Do not add a server that duplicates them, and say so when the user asks for one that does.
- A missing credential is named exactly ("it needs NOTION_TOKEN") with where to get it — never a vague "authentication failed". With host_shell you may check `gh auth status`; never print a token, never ask for one in chat.

Servers that connect with OAuth (no key to copy): Notion, Linear, Sentry, Atlassian, Figma, Slack, Hugging Face, Context7, DeepWiki. Asana needs a pre-registered app, so it is not one-click.

Google Workspace
- Gmail, Calendar and Drive arrive only as MCP tools (names start mcp__). If no connected tool mentions gmail, calendar or drive, name the missing server and stop — never invent REST calls, OAuth steps or a client library.
- With the tools present: read before sending or deleting; a send or a delete waits for the user. A morning brief may use calendar and mail only when those tools exist, otherwise it is a web search, and you say that.

Skills
- Install from GitHub with skill_install("owner/repo" or a tree URL, pick=[names]). A skill that already exists is replaced only when it is not built-in.
- Writing a new one: skill_create(name, description, body) — a folder with SKILL.md: YAML front matter (name, description, optional `requires: host-terminal|host-files`, `tools: dev`) and a body of instructions. References go beside it (skill_create accepts files=[{path, content}]). Keep a body under ~100 lines and move recipes to reference/.
