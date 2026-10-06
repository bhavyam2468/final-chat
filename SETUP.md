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
| **SearXNG** | `searxng` | `8080` | Local JSON metasearch discovery for ordinary web research |
| **SearXNG cache** | `searxng-cache` | — | Valkey cache used by the local SearXNG service |
| **Firecrawl API** | `firecrawl-api-1` | `3002` | Optional self-hosted escalation for difficult pages; not used by ordinary searches |
| **Firecrawl Redis** | `firecrawl-redis-1` | — | Internal Redis for Firecrawl job queue |
| **Firecrawl RabbitMQ** | `firecrawl-rabbitmq-1` | — | Internal job broker |
| **Firecrawl Playwright** | `firecrawl-playwright-service-1` | — | Headless browser for Firecrawl |
| **Firecrawl Postgres (NUQ)** | `firecrawl-nuq-postgres-1` | — | Internal DB for Firecrawl |
| **App Postgres** | `minimalist-ai-chat-workspace-db-1` | `5432` | The chat app's own Postgres DB |

> **Search note**: the app's compose file now runs a small SearXNG + Valkey pair on `:8080`. The app tries SearXNG first, then keyless adapters. Firecrawl is intentionally a separate, opt-in escalation because its browser workers are too heavy for routine local/mobile use.

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
ExecStartPre=/usr/bin/docker compose -f "...docker-compose.yml" up -d db searxng-cache searxng
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

SEARXNG_URL=http://localhost:8080
FIRECRAWL_ENABLED=0
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

### 2. Local-first web research (`src/lib/web.ts`)

The ordinary path queries local SearXNG, then uses short-timeout keyless adapters. Direct page reads use HTTP + Mozilla Readability + Turndown; local/cloud Firecrawl is contacted only when `FIRECRAWL_ENABLED=1` and lightweight extraction fails.

Multiple web calls emitted by one model step start concurrently; each tool row reports its own status and source.

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
- Added a SearXNG URL field (defaults to the local `:8080` JSON API).
- Firecrawl URL/key fields are explicitly optional and paired with an off-by-default `Allow Firecrawl escalation` switch.
- Added explanatory copy that ordinary research is HTTP/Readability-first and browser-free.

---

## What an AI Coding Assistant Should Know

### ⚠️ Critical: Do NOT Change

1. **Firecrawl is opt-in** — `FIRECRAWL_ENABLED=0` is the safe default. Ordinary search/fetch must use SearXNG + HTTP/Readability and must not start a local browser stack.
2. **The app runs on the host, not in Docker** — do not suggest moving the Next.js app into Docker. Inside the app, `shell` is the agent's sandbox and `host_shell` (only when Settings → Access → Host terminal is on) is the real host terminal.
3. **General mode is not Search mode** — it has a separate history, no automatic web preflight, and visible tool calls; promotion to normal chat is explicit.
4. **`workspace/` is gitignored** — it is the agent's live working directory with conversations, uploads, notes, etc. Never commit it.
5. **`.env` is not committed** — credentials are only in the local `.env` file.

### Architecture Patterns

- **Settings are stored in Postgres** (not just `.env`). The `.env` sets defaults; DB overrides them. `getSettings()` merges both. After changing settings via the UI, they persist in DB across restarts.
- **Tool results include `meta.source`** — values such as `"searxng"`, `"keyless"`, `"http-readability"`, or `"firecrawl-cloud"` make the route visible to the UI and logs.
- **All API routes are `force-dynamic`** — no static caching. All data is always fresh from DB.
- **The agent loop** in `agent.ts` runs up to 16 tool-call steps per user message (40 when the dev tool pack is loaded) and recomputes the tool list every step.
- **Context window trimming** — `buildHistory()` drops oldest message pairs when the conversation exceeds `contextTokens`. Use `/compact` to summarise manually.

### Adding a New Tool

1. Add a `T(...)` entry to `toolDefs()` in `src/lib/tools/index.ts` (the `core` list, or `dev` for tools only needed while building/debugging)
2. Add a `case "tool_name":` handler in `execTool()` in the same file
3. Add a live/done verb for the chat UI in `TOOL_META` (`src/components/Message.tsx`)
4. Rebuild: `npm run build` and `systemctl --user restart minimalist-chat`

### Adding a New API Route

Create `src/app/api/<name>/route.ts` with `export const dynamic = "force-dynamic"`. DB is available via `import { db } from "@/db"`.

### Modifying the System Prompt

Edit `workspace-template/system/SYSTEM.md` (shipped default; unedited workspace copies are upgraded automatically) or `workspace/system/SYSTEM.md` (your copy; no rebuild needed, takes effect on the next message).

### Adding Skills to the Agent

Create `workspace/system/skills/<skill-name>/SKILL.md` with YAML frontmatter `name:` and `description:` (optional `tools: dev` to load the dev tool pack, `requires: host-terminal | host-files` to list it only when that access is on; extra files under `reference/` open with `skill_open(name, file)`). Or install from GitHub in Settings → Skills; `npx skills add` into `workspace/.agents/skills` also works.

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

# Local-first web research
SEARXNG_URL=http://localhost:8080
# Firecrawl is an explicit fallback only
FIRECRAWL_ENABLED=0
FIRECRAWL_URL=http://localhost:3002
# Cloud key for difficult pages / structured extraction
FIRECRAWL_API_KEY=fc-<your-cloud-key>
FIRECRAWL_CLOUD_URL=https://api.firecrawl.dev

WORKSPACE_DIR=./workspace
ACCESS_MODE=sandbox
```

---

## Re-installing the Desktop App & systemd Service

```bash
./setup.sh --local        # re-detects services, keeps existing .env keys, rebuilds, (re)installs service + launcher + desktop entry
minimalist-chat update    # later: git pull + setup
```

The files in `scripts/` are templates (`@APP@`, `@PORT@`…) that `setup.sh` fills in. The service now binds to `127.0.0.1` because the agent can have host-terminal access; the old unit bound to all interfaces. Your Zen browser is kept via `CHAT_BROWSER` in `.env`.
