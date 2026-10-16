# Setup & Developer Context

This document explains how the app is set up on the owner's machine and gives critical context for
any AI coding assistant making future changes. The app is a **desktop application** (Tauri shell +
bundled app server + bundled SearXNG); the architecture is in [`docs/DESKTOP.md`](docs/DESKTOP.md).

---

## System Environment

| Item | Value |
|---|---|
| **OS** | Arch Linux |
| **Desktop** | Niri (Wayland compositor) |
| **Browser** | Zen Browser (`~/Downloads/zen.linux-x86_64/zen/zen`) |
| **Node** | `/usr/bin/node` (v26+) |
| **npm** | `/usr/bin/npm` |
| **Rust** | `rustup` toolchain (builds the desktop shell) |
| **Python** | `python3` on PATH (used for the bundled SearXNG environment) |

---

## What Runs, and Where

The app is one program. Launching it starts everything it needs, on loopback ports chosen at launch:

| Piece | How it runs | Notes |
|---|---|---|
| **Shell** | `minimalist-ai` (the Tauri app) | Owns the window, the tray, the ports and the process tree; logs to `~/.local/share/dev.bhavyam.minimalist-ai/logs/desktop.log` |
| **App server** | `resources/runtime/bin/node resources/appserver/server.js` | The Next.js application, started by the shell on a free port and supervised (restarted if it dies) |
| **Database** | PGlite inside the data directory | `DATABASE_URL` in `config.env` switches to a real Postgres |
| **SearXNG** | `resources/searxng/venv/bin/python -m granian … searx.webapp:app` | Bundled, started on its own free port; `SEARXNG_URL` overrides it. No Docker anywhere |
| **FreeLLMAPI / Ollama / other model endpoints** | outside the app | Any OpenAI-compatible endpoint, configured in Settings → Model or `config.env` |
| **Firecrawl** | outside the app, opt-in | `FIRECRAWL_ENABLED=0` by default; nothing routine depends on it |

There is no systemd unit, no `docker compose`, no service to restart and no fixed port. The terminal
equivalents a GUI does not cover are in `scripts/minimalist-ai-ctl`:

```bash
minimalist-ai-ctl status      # running? on which port?
minimalist-ai-ctl logs        # follow the shell log
minimalist-ai-ctl restart     # replace the app server in place (the window reloads)
minimalist-ai-ctl stop
minimalist-ai-ctl data
```

---

## Configuration

Two files, one shape:

- **A checkout / dev server**: `.env` at the project root (not committed), read by `npm run dev`.
- **The desktop app**: `<data>/config.env` — seeded once with a commented template, read by the shell
  at every start, never overwritten. `minimalist-ai-ctl data` prints the directory.

Real environment variables win over both, and the shell always sets the paths and ports it owns
(`APP_MODE=desktop`, `APP_ROOT`, `APP_DATA_DIR`, `WORKSPACE_DIR`, `PGLITE_DIR`, `VENV_DIR`,
`ENV_FILE`, `SEARXNG_URL`, `PORT`), so a stale file cannot point the app at the wrong database.

```env
# Model — any OpenAI-compatible endpoint (Settings → Model writes these too)
LLM_PROVIDER=freellmapi
LLM_BASE_URL=http://127.0.0.1:3001/v1
LLM_API_KEY=freellmapi-<key>
LLM_MODEL=gemini-2.5-flash

# Search: leave SEARXNG_URL unset to use the bundled SearXNG
# SEARXNG_URL=http://127.0.0.1:8080

# Firecrawl stays off unless you explicitly want the escalation
FIRECRAWL_ENABLED=0
FIRECRAWL_URL=http://127.0.0.1:3002
FIRECRAWL_API_KEY=fc-<cloud-key>
FIRECRAWL_CLOUD_URL=https://api.firecrawl.dev

# Where the agent works, and how much access it has
WORKSPACE_DIR=<data>/workspace
ACCESS_MODE=sandbox
TERMINAL_MODE=sandbox
ALLOW_SUDO=0

# A real Postgres instead of the embedded database (advanced)
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# Developer mode: offline mock model, sample files, __dev in the console
# DEV_MODE=1
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
2. **The app runs as a native desktop application, not in Docker** — the shell starts the app server and SearXNG itself. Do not reintroduce Docker, a systemd unit or a fixed-port localhost workflow: the desktop app is the only supported path. Inside the app, `shell` is the agent's sandbox and `host_shell` (only when Settings → Access → Host terminal is on) is the real host terminal.
3. **General mode is not Search mode** — it has a separate history, no automatic web preflight, and visible tool calls; promotion to normal chat is explicit.
4. **`workspace/` is gitignored** — it is the agent's live working directory with conversations, uploads, notes, etc. Never commit it.
5. **`.env` / `config.env` are not committed** — credentials live only in the local files (`config.env` in the desktop app's data directory).
6. **The Node/desktop contract is tested** — `dev/tests/desktop.test.ts` fails if the shell stops setting a variable `src/lib/paths.ts` reads, if the bundle layout and `tauri.conf.json` disagree, or if an icon/module disappears. Keep it green when touching either side.

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
4. Rebuild: `npm run build` (and `npm run desktop:prepare` for the desktop bundle)

### Adding a New API Route

Create `src/app/api/<name>/route.ts` with `export const dynamic = "force-dynamic"`. DB is available via `import { db } from "@/db"`.

### Modifying the System Prompt

Edit `workspace-template/system/SYSTEM.md` (shipped default; unedited workspace copies are upgraded automatically) or `workspace/system/SYSTEM.md` (your copy; no rebuild needed, takes effect on the next message).

### Adding Skills to the Agent

Create `workspace/system/skills/<skill-name>/SKILL.md` with YAML frontmatter `name:` and `description:` (optional `tools: dev` to load the dev tool pack, `requires: host-terminal | host-files` to list it only when that access is on; extra files under `reference/` open with `skill_open(name, file)`). Or install from GitHub in Settings → Skills; `npx skills add` into `workspace/.agents/skills` also works.

### After Any Source Code Change

```bash
npm run typecheck        # quick TS check without build
npm run test:unit        # the suites in dev/tests (includes the desktop contract)
npm run build            # full production build
npm run desktop:prepare  # re-assemble the bundle the app actually runs
npm run desktop:smoke    # start that bundle the way the shell does and check it end to end
```

For the Rust shell (`src-tauri/`), rebuild it and restart the app:

```bash
cd src-tauri && cargo build --release
minimalist-ai-ctl restart   # or just quit and relaunch the app
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

## Rebuilding the Configuration From Scratch

The desktop app seeds `config.env` by itself on first run; delete it and restart the app to get a
fresh template, or copy `config.env.example`-style keys from the block above.

---

## Installing / Re-installing the App

```bash
scripts/install-desktop.sh          # build the bundle + shell, install launcher and menu entry
scripts/install-desktop.sh --no-build   # reuse what is already built
npm run desktop:build               # or produce an AppImage / .deb / .rpm instead
```

Data survives all of it: it lives in `~/.local/share/dev.bhavyam.minimalist-ai`, not in the app, and
`config.env` there is never overwritten.
