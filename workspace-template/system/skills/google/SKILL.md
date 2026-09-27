---
name: google
description: Google Workspace (mail, calendar, drive) through an MCP server the user connected. No invented Google API.
---
Google Workspace is not built in. It arrives as MCP tools (names starting mcp__) after the user adds a server in Settings → MCP.

- If no connected tool mentions gmail, calendar, drive, or workspace, say which server is missing and stop. Do not invent REST calls, OAuth steps, or a client library.
- If the tools are there, use them. Read before you send or delete. A send or a delete waits for the user.
- A morning brief may use calendar and mail only when those tools exist. Otherwise it is a web search, and you say that.
