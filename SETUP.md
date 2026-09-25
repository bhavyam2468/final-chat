# Setup & Developer Context

This document explains exactly how this app was set up on the owner's machine and gives critical context for any AI coding assistant (Antigravity, Cursor, Claude, etc.) making future changes.

---

## System Environment

| Item | Value |
|---|---|
| **OS** | Arch Linux |
| **Desktop** | Niri (Wayland compositor) |
| **Browser** | Zen Browser (`~/Downloads/zen.linux-x86_64/zen/zen`) |
| **Node** | `/usr/bin/node` (v26+) |
| **npm** | `/usr/bin/npm` |
| **Docker** | `/usr/bin/docker` (running rootful, accessible without sudo) |
| **Python** | `python3` on PATH |

---

## Running Services

All services below are running locally via Docker containers. The app talks to them over `localhost`.

| Service | Container Name | Port | Description |
|---|---|---|---|
| **FreeLLMAPI** | `freellmapi-freellmapi-1` | `3001` | Local AI model proxy (200+ models). Network: `freellmapi_default` |
| **Firecrawl API** | `firecrawl-api-1` | `3002` | Local self-hosted Firecrawl (scraping + search). Network: `firecrawl_backend`. `USE_DB_AUTHENTICATION=false` — no key needed for local calls |
| **Firecrawl Redis** | `firecrawl-redis-1` | — | Internal Redis for Firecrawl job queue |
| **Firecrawl RabbitMQ** | `firecrawl-rabbitmq-1` | — | Internal job broker |
| **Firecrawl Playwright** | `firecrawl-playwright-service-1` | — | Headless browser for Firecrawl |
| **Firecrawl Postgres (NUQ)** | `firecrawl-nuq-postgres-1` | — | Internal DB for Firecrawl |
| **App Postgres** | `minimalist-ai-chat-workspace-db-1` | `5432` | The chat app's own Postgres DB |

> **Note on Firecrawl SearXNG**: The SearXNG container (`searxng`) is present but was `Exited`. Local search falls back to DuckDuckGo inside the Firecrawl container, and ultimately to Cloud Firecrawl if all else fails.

---

## How the App Runs

The app runs **natively on the host** (not inside Docker) so the AI agent can access the real terminal and real filesystem. This is intentional by design.

### systemd User Service

The app is managed as a systemd user service that starts on boot:

```
~/.config/systemd/user/minimalist-chat.service
```

**Service definition:**
```ini
[Unit]
Description=Minimalist AI Chat Workspace Service
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/home/thatguy/Projects/the chat application/minimalist-ai-chat-workspace
EnvironmentFile=-/home/thatguy/Projects/the chat application/minimalist-ai-chat-workspace/.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=PATH=/home/thatguy/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStartPre=/usr/bin/docker compose -f "...docker-compose.yml" up -d db
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

**Control commands:**
```bash
systemctl --user start minimalist-chat
systemctl --user stop minimalist-chat
systemctl --user restart minimalist-chat
systemctl --user status minimalist-chat
journalctl --user -u minimalist-chat -f   # live logs
```

Or use the helper CLI:
```bash
minimalist-chat open      # ensures running, opens in Zen
minimalist-chat start
minimalist-chat stop
minimalist-chat restart
minimalist-chat status
minimalist-chat logs
```

### Desktop Launcher

A `.desktop` file is installed at:
```
~/.local/share/applications/minimalist-chat.desktop
```

- Appears in the Niri/app launcher as **"Minimalist AI Workspace"**
- Opens `http://localhost:3000` in a **new Zen Browser window**
- Right-click actions: Open, Start Service, Stop Service, Restart Service
- Icon: `~/.local/share/icons/minimalist-chat.svg`

---

## `.env` File

Located at the project root (not committed to git). Must be recreated manually when cloning.

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

LLM_BASE_URL=http://localhost:3001/v1
LLM_API_KEY=freellmapi-<key>
LLM_MODEL=gemini-2.5-flash

FIRECRAWL_URL=http://localhost:3002
FIRECRAWL_API_KEY=fc-<cloud-key>
FIRECRAWL_CLOUD_URL=https://api.firecrawl.dev

WORKSPACE_DIR=./workspace
ACCESS_MODE=sandbox
```

---

## Custom Modifications Made by Setup

### 1. `src/lib/settings.ts` — Provider Defaults

- **Default provider** changed from `gemini` to `freellmapi`
- **PRESETS** now include `contextTokens` per provider (auto-fills context window on provider switch)
- Added `firecrawlCloudUrl` field to `Settings` type and defaults
- Default `firecrawlUrl` → `http://localhost:3002` (local)
- Default `firecrawlKey` → cloud API key (for bypass/extract only)
- FreeLLMAPI preset model updated to `gemini-2.5-flash`

### 2. `src/lib/tools.ts` — Hybrid Firecrawl

Three new internal functions replaced the old single `firecrawl()` helper:

**`firecrawlScrape(st, url)`**
1. Tries local Firecrawl (`http://localhost:3002/v1/scrape`) with 15s timeout, no auth key
2. Detects bot-protection in response (Cloudflare challenge text patterns)
3. Falls back to Cloud Firecrawl (`https://api.firecrawl.dev/v1/scrape`) with Bearer token if local fails or is blocked

**`firecrawlSearch(st, query, limit)`**
1. Tries local Firecrawl search with **3-second** timeout (local SearXNG is often down)
2. Falls back to Cloud Firecrawl search if local times out or returns empty results

**`firecrawlExtract(st, url, prompt)`**
- Always routes to Cloud (local has no LLM for AI extraction)
- Uses `/v1/scrape` with `formats: ["extract"]` and `extract: { prompt }` body

**New tool added to `CORE_TOOLS`:**
```typescript
T("web_extract", "Extract structured data from a web page using Firecrawl Cloud AI",
  { url: ..., prompt: ... }, ["url", "prompt"])
```

### 3. `src/app/api/models/route.ts` — Model Fetcher (NEW FILE)

Endpoint: `GET /api/models?baseUrl=<url>` or `POST /api/models` with `{ baseUrl, apiKey }` body.

- Calls the provider's `/v1/models` endpoint
- Normalises across providers (handles `data[]`, root array, `models[]` shapes)
- Extracts `id`, `name`, `contextWindow`, `available`, `execution_status`
- Sorts: ready/available models first, then alphabetical

### 4. `src/components/Settings.tsx` — Settings UI

**Model tab changes:**
- Provider dropdown now also applies `contextTokens` from preset on switch
- Model field replaced with a compound widget:
  - Free-text input with datalist autocomplete (populated after fetch)
  - "**Fetch models**" button → hits `/api/models`, populates dropdown
  - Dropdown selector showing all fetched models with status badges
  - Selecting a model from dropdown auto-saves model + context window

**Tools tab changes:**
- Firecrawl URL field label: `"Local Firecrawl URL (zero-credit)"`
- Firecrawl Key field label: `"Online Firecrawl Key (bypass / extract)"`
- Added explanatory subtitle under the fields

---

## What an AI Coding Assistant Should Know

### ⚠️ Critical: Do NOT Change

1. **`firecrawlScrape` local-first logic** — do not switch to always-cloud. Cloud uses paid credits. The whole point is local-first with targeted cloud fallback.
2. **`firecrawlSearch` 3-second timeout** — SearXNG is often down; the short timeout is intentional to fail fast to cloud.
3. **The agent runs on the host, not in Docker** — if you need to run commands, do so with `shell` tool directly on the host. Do not suggest moving the Next.js app into Docker.
4. **`workspace/` is gitignored** — it is the agent's live working directory with conversations, uploads, notes, etc. Never commit it.
5. **`.env` is not committed** — credentials are only in the local `.env` file.

### Architecture Patterns

- **Settings are stored in Postgres** (not just `.env`). The `.env` sets defaults; DB overrides them. `getSettings()` merges both. After changing settings via the UI, they persist in DB across restarts.
- **Tool results include `meta.source`** — `"local"` or `"cloud"` — useful for debugging which Firecrawl path was taken.
- **All API routes are `force-dynamic`** — no static caching. All data is always fresh from DB.
- **The agent loop** in `agent.ts` runs up to 10 tool-call iterations per user message before stopping.
- **Context window trimming** — `buildHistory()` drops oldest message pairs when the conversation exceeds `contextTokens`. Use `/compact` to summarise manually.

### Adding a New Tool

1. Add a `T(...)` entry to `CORE_TOOLS` in `src/lib/tools.ts`
2. Add a `case "tool_name":` handler in `execTool()` in the same file
3. Rebuild: `npm run build` and `systemctl --user restart minimalist-chat`

### Adding a New API Route

Create `src/app/api/<name>/route.ts` with `export const dynamic = "force-dynamic"`. DB is available via `import { db } from "@/db"`.

### Modifying the System Prompt

Edit `workspace/system/SYSTEM.md` directly — no rebuild needed. Changes take effect on the next message.

### Adding Skills to the Agent

Create `workspace/system/skills/<skill-name>/SKILL.md` with a YAML frontmatter `description:` field. The agent sees the name + description in its system prompt and can call `skill_open` to load the full instructions.

### After Any Source Code Change

```bash
npm run typecheck    # quick TS check without build
npm run build        # full production build
systemctl --user restart minimalist-chat
```

### Database Schema

Managed by Drizzle ORM. Schema is in `src/db/schema.ts`. To push schema changes:
```bash
npx drizzle-kit push
```

Tables:
- `conversations` — `id`, `title`, `summary`, `summaryUpTo`, `context[]`, `updatedAt`
- `messages` — `id`, `conversationId`, `parentId`, `threadOf`, `role`, `content`, `parts[]` (JSONB), `attachments[]`, `quote`
- `settings` — key-value store; only row is `key = "app"`

---

## Rebuilding the `.env` From Scratch

When cloning on a new machine:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# FreeLLMAPI — get key from https://freellmapi.com or your local instance
LLM_BASE_URL=http://localhost:3001/v1
LLM_API_KEY=freellmapi-<your-key>
LLM_MODEL=gemini-2.5-flash

# Firecrawl — local instance (run firecrawl docker-compose separately)
FIRECRAWL_URL=http://localhost:3002
# Cloud key for bot bypass + AI extraction
FIRECRAWL_API_KEY=fc-<your-cloud-key>
FIRECRAWL_CLOUD_URL=https://api.firecrawl.dev

WORKSPACE_DIR=./workspace
ACCESS_MODE=sandbox
```

---

## Re-installing the Desktop App & systemd Service

Run these commands from the project root:

```bash
# 1. systemd service
mkdir -p ~/.config/systemd/user
# Create the .service file (see above for contents)
systemctl --user daemon-reload
systemctl --user enable --now minimalist-chat

# 2. Launcher script
cp scripts/minimalist-chat ~/.local/bin/minimalist-chat
chmod +x ~/.local/bin/minimalist-chat

# 3. Desktop entry
cp scripts/minimalist-chat.desktop ~/.local/share/applications/
cp scripts/minimalist-chat.svg ~/.local/share/icons/
update-desktop-database ~/.local/share/applications
```
