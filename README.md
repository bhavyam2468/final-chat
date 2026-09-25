# Minimalist AI Chat Workspace

A quiet, minimal AI operating surface — chat, sandboxed workspace, tools, generative UI (Blocks), and floating canvases — running entirely on your local machine with your own AI providers and zero mandatory cloud dependency.

> **Live instance** runs as a systemd user service at `http://localhost:3000`. Open it from the **"Minimalist AI Workspace"** desktop launcher (Zen Browser).

---

## What This App Does

| Capability | Description |
|---|---|
| **Chat** | Streaming multi-turn AI chat with branching, threading, and side-threads |
| **AI Agent Tools** | The AI can read/write files, run bash commands, run Python, search the web, scrape pages, extract structured data |
| **Workspace** | Sandboxed file tree the agent operates in; togglable "full disk" access |
| **Blocks / Generative UI** | `<canvas>` blocks in chat can render live interactive HTML+CSS+JS+Python (Pyodide) |
| **MCP Servers** | Add any stdio or HTTP MCP server via Settings → MCP |
| **Skills** | Progressive-disclosure skill system (SKILL.md files teach the agent new capabilities on demand) |
| **Hybrid Firecrawl** | Smart routing: local Firecrawl for free scraping, cloud key only for anti-bot bypass / AI extraction |
| **FreeLLMAPI** | Local proxy to 200+ AI models; dynamic model picker in Settings |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)  
- **Language**: TypeScript 5 + React 19  
- **Database**: PostgreSQL 16 (Docker) + Drizzle ORM  
- **Styling**: Tailwind CSS v4  
- **Markdown**: Custom `streammark` streaming renderer (KaTeX math, highlight.js, footnotes, embeds)  
- **AI**: OpenAI-compatible API (configured to FreeLLMAPI)  
- **Web Scraping**: Firecrawl (hybrid local + cloud)  

---

## File & Directory Reference

### Root

| File/Dir | Purpose |
|---|---|
| `package.json` | npm scripts and dependencies |
| `next.config.ts` | Next.js config |
| `tsconfig.json` | TypeScript config |
| `drizzle.config.json` | Drizzle ORM config pointing at `DATABASE_URL` |
| `docker-compose.yml` | Starts Postgres 16 on port 5432 |
| `.env` | **Local-only** environment variables (not committed) |
| `DESIGN.md` | Visual/UX design principles for the app |
| `workspace/` | Agent's working directory (gitignored). Contains `system/SYSTEM.md`, `system/AGENTS.md`, `system/skills/`, `system/mcp/servers.json`, `uploads/`, `artifacts/`, `notes/`, `chats/` |
| `workspace-template/` | Seed files copied into `workspace/` on first run |
| `public/blocks/` | Standalone Blocks runtime (extended HTML tags, Pyodide, relational style language) |
| `agent/` | Reserved for agent-authored scripts/tools |
| `.agents/` | Antigravity agent config (skills, hooks) |
| `.claude/` | Claude agent config |

### `src/app/` — Next.js App Router

| Route | Purpose |
|---|---|
| `page.tsx` | Root page — renders `<App>` |
| `layout.tsx` | Root HTML shell |
| `globals.css` | All CSS (vars, components, utilities) |
| `api/chat/route.ts` | POST — accepts user message, streams agent NDJSON response |
| `api/conversations/route.ts` | GET — list all conversations with branch metadata |
| `api/conversations/[id]/route.ts` | GET/PATCH/DELETE — get/rename/delete a conversation |
| `api/conversations/[id]/compact` | POST — compact/summarise a conversation |
| `api/conversations/[id]/export` | GET — export conversation as JSON |
| `api/settings/route.ts` | GET/PUT — read and write app settings to DB |
| `api/models/route.ts` | GET/POST — fetch available models from the configured LLM provider |
| `api/mcp/route.ts` | GET/PUT — read and write MCP server config |
| `api/mcp/registry` | GET — search the MCP registry |
| `api/skills/route.ts` | GET/POST — list installed skills; install from GitHub URL |
| `api/workspace/route.ts` | GET/POST/DELETE/PUT — workspace file CRUD |
| `api/workspace/upload` | POST — upload files into workspace |
| `api/python/route.ts` | POST — run Python snippet in workspace |
| `api/search/route.ts` | GET — search conversations |
| `api/health/route.ts` | GET — liveness probe (checks DB connection) |
| `files/[...path]/route.ts` | GET — serve workspace files over HTTP |

### `src/components/` — React Components

| Component | Purpose |
|---|---|
| `App.tsx` | Root client component: layout, panels, chat state, keyboard shortcuts |
| `Composer.tsx` | Message input box: slash commands, `@`-mentions, file attachments |
| `Message.tsx` | Renders a single message (user or assistant) with tool calls, sources, branches |
| `Panels.tsx` | Left panel (chat history, search), right panel (workspace file browser) |
| `Canvas.tsx` | Floating canvas overlay for expanded Blocks/generative-UI |
| `Block.tsx` | Renders a `<canvas>` block (isolated iframe sandboxed to `/blocks/`) |
| `Settings.tsx` | Settings modal: Model, Tools (Firecrawl), MCP servers, Skills |
| `ctx.ts` | Shared React contexts (conversation, settings, theme) |

### `src/lib/` — Backend Logic

| Module | Purpose |
|---|---|
| `agent.ts` | Core agent loop: system prompt, history building, streaming tool-call execution |
| `tools.ts` | All tool definitions (`CORE_TOOLS`) and `execTool()` dispatcher. Contains hybrid Firecrawl logic |
| `settings.ts` | Settings type, defaults, `getSettings()`, `saveSettings()`, `mask()`, `PRESETS` |
| `mcp.ts` | MCP client: load servers.json, start stdio/HTTP servers, call tools |
| `workspace.ts` | Workspace path resolution, `tree()`, `resolvePath()`, `ensureWorkspace()` |
| `streammark/StreamMarkdown.tsx` | Streaming Markdown renderer (React, memoised blocks) |
| `streammark/remend.ts` | Core markdown-to-VDOM streaming engine |
| `blocks/catalog.ts` | `ui_search` catalog: index of available Blocks UI components by tags |

### `src/db/` — Database

| File | Purpose |
|---|---|
| `index.ts` | Drizzle + `pg` pool connection |
| `schema.ts` | Tables: `conversations`, `messages`, `settings` |

---

## Environment Variables (`.env`)

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# LLM Provider (FreeLLMAPI local proxy)
LLM_BASE_URL=http://localhost:3001/v1
LLM_API_KEY=freellmapi-<your-key>
LLM_MODEL=gemini-2.5-flash

# Firecrawl — hybrid: local for free scraping, cloud for bot bypass & AI extraction
FIRECRAWL_URL=http://localhost:3002
FIRECRAWL_API_KEY=fc-<your-cloud-key>
FIRECRAWL_CLOUD_URL=https://api.firecrawl.dev

# Workspace
WORKSPACE_DIR=./workspace   # or an absolute path
ACCESS_MODE=sandbox          # "full" = agent can use absolute paths
```

---

## Key Customisations Made

### 1. FreeLLMAPI Integration with Dynamic Model Fetching
- Default provider set to `freellmapi` pointing at `http://localhost:3001/v1`
- Added `/api/models` endpoint that queries the provider's `/v1/models` and returns sorted, normalised model list
- Settings UI has a **"Fetch models"** button that populates a searchable dropdown; selecting a model auto-fills its context window size

### 2. Hybrid Firecrawl Routing (`src/lib/tools.ts`)
- **`web_fetch`** (scraping): tries local Firecrawl first; detects Cloudflare/bot-protection challenges in the response body; automatically falls back to Cloud Firecrawl with API key
- **`web_search`**: tries local Firecrawl with a 3-second timeout; falls back to Cloud Firecrawl if local SearXNG is down or slow
- **`web_extract`** (NEW tool): always routes to Cloud Firecrawl (local has no LLM); uses the `/v1/scrape` endpoint with `formats: ["extract"]` and a prompt for structured AI extraction

### 3. Background Service & Desktop App
- `~/.config/systemd/user/minimalist-chat.service`: runs `npm start` persistently; auto-starts Postgres on boot
- `~/.local/share/applications/minimalist-chat.desktop`: shows in app launcher as "Minimalist AI Workspace"; opens in Zen Browser
- `~/.local/bin/minimalist-chat`: CLI control script (`start|stop|restart|status|logs|open`)

---

## Quick Start (Fresh Machine)

```bash
# 1. Clone
git clone https://github.com/bhavyam2468/final-chat.git && cd final-chat

# 2. Copy and fill in your env
cp .env.example .env
# Edit .env with your FreeLLMAPI key, Firecrawl keys, etc.

# 3. Start Postgres
docker compose up -d db

# 4. Install and migrate
npm install
npx drizzle-kit push

# 5. Build and run
npm run build
npm start

# App is at http://localhost:3000
```

> For the systemd service and desktop launcher, see `SETUP.md`.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Type anywhere | Focus composer |
| `Backspace` on empty composer | Release / unfocus |
| `/` | Slash commands |
| `@` | Mention workspace files |
| `Enter` | Send message |
| `Shift+Enter` | Newline |
| `⌘K` / `Ctrl+K` | Search chats |
| `⌘B` / `Ctrl+B` | Toggle chat panel |
| `⌘.` / `Ctrl+.` | Toggle workspace panel |
| `⌘⇧O` / `Ctrl+Shift+O` | New chat |
| `Esc` | Close modal/overlay |
