---
name: mcp
description: Using and configuring MCP servers; marketplace; credentials (GitHub etc.) and native CLI logins.
---
Config: system/mcp/servers.json {"servers":{name:{command,args,env,enabled} | {url,headers,enabled}}}. ${VAR} expands from Settings secrets, then environment, then native logins when the user granted host access (GITHUB_TOKEN ← `gh auth token`, HF_TOKEN ← ~/.cache/huggingface/token). Users add servers in Settings → Extensions (curated catalog, registry search) and toggle them; changes apply next message.
Enabled servers' tools appear as mcp__<server>__<tool>.
Built-in tools already cover files, fetch/scrape, browser screenshots, shell and Python: do not add MCP servers that duplicate them.
If a server needs a credential that is missing, tell the user the exact variable and where to get it; with host_shell you may check `gh auth status` but never print tokens.
