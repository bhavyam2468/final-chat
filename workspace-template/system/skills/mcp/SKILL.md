---
name: mcp
description: Using and configuring Model Context Protocol servers (filesystem, github, postgres, pdf, papers, vector DB).
---
Config: system/mcp/servers.json {"servers":{name:{command,args,env,enabled} | {url,headers,enabled}}}. ${VAR} expands from environment/settings secrets. User toggles in Settings > MCP; edits apply next message.
Enabled servers' tools appear as mcp__<server>__<tool>. Preconfigured:
- filesystem: read/write chosen directories outside workspace.
- github: repos, issues, PRs, commits (needs GITHUB_TOKEN personal access token; remote server).
- postgres: read-only SQL/schema inspection (DATABASE_URL).
- pdf-reader: structured PDF extraction.
- papers: search_arxiv, search_pubmed, search_biorxiv, download/read papers (needs uv).
- chroma: vector store for notes; add documents with metadata tags, query semantically (needs uv).
