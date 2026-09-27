# Minimalist AI Chat Workspace

A quiet, minimal AI operating surface — chat, sandboxed workspace, tools, generative UI (Blocks), and floating canvases — running entirely on your local machine with your own AI providers and zero mandatory cloud dependency.

> **Live instance** runs as a systemd user service at `http://localhost:3000`. Open it from the **"Minimalist AI Workspace"** desktop launcher (Zen Browser).

---

## What This App Does

| Capability | Description |
|---|---|
| **Chat** | Streaming multi-turn AI chat with branching, threading, and side-threads |
| **AI Agent Tools** | The AI can read/write files, run bash commands, run Python, search the web, scrape pages, extract structured data |
| **Workspace** | Sandboxed file tree the agent operates in. Home folder, entire disk, host terminal and sudo are separate switches (Settings → Access), all off by default |
| **BlocksUI** | Generative UI language for `<ui>`: ~60 components (layout, paging decks, quizzes, timers, charts, Desmos-style graphs, LaTeX, SMILES/3D molecules, diagrams, maps…), reactive bindings, JS/Python logic and a relational layout language. Spec: [`docs/BLOCKS.md`](docs/BLOCKS.md) |
| **Canvas** | Floating windows or **docked** beside the chat (drag the left edge to resize). Anything chat can show can go in a canvas; native viewers for PDF, Word, Excel/CSV, PowerPoint, zip/tar (browse without extracting), images, audio/video, code |
| **Context status** | Live token meter in the workspace panel, per-section breakdown, and scoped compaction: fold tool output, fold web results, summarise history, or compact selected turns. Everything is restorable |
| **Streaming** | Rate-adaptive smoothing for text, markdown and every Blocks component: no jitter, no re-render flashes, stable skeletons while a component streams |
| **MCP Servers** | Add any stdio or HTTP MCP server via Settings → MCP |
| **Skills** | Progressive-disclosure skill system (SKILL.md files teach the agent new capabilities on demand) |
| **Hybrid Firecrawl** | Smart routing: local Firecrawl for free scraping, cloud key only for anti-bot bypass / AI extraction |
| **FreeLLMAPI** | Local proxy to 200+ AI models; dynamic model picker in Settings |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)  
- **Language**: TypeScript 5 + React 19  
- **Database**: Drizzle ORM on PostgreSQL (`DATABASE_URL`) or embedded **PGlite** (default, zero setup)  
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
| `agent.ts` | Agent loop: system prompt, history, tool packs per step, image hand-off, todo recitation, quality guard |
| `tools/index.ts` | Tool schemas (core + dev pack) and the `execTool()` dispatcher |
| `tools/edit.ts` / `tools/syntax.ts` | Robust edits (exact → whitespace-tolerant → indentation-shifted matching, placeholder rejection) and the syntax guard |
| `web.ts` | Hybrid Firecrawl search/scrape/extract (local first, cloud fallback, plain fetch last) |
| `procs.ts` | Background processes for the agent (dev servers): start, logs, wait for port/pattern, restart, stop |
| `browser.ts` | Headless Chrome via puppeteer-core: screenshots, console errors, scripted steps |
| `harness/check.ts` / `harness/slop.ts` | `check` tool (types, lint, tests, build, design lint + screenshot) and the AI-styling linter |
| `skills.ts` / `market.ts` / `credentials.ts` | Skill discovery and GitHub install, curated MCP/skill catalog, credential resolution (secret → env → CLI login) |
| `settings.ts` | Settings type, defaults, `getSettings()`, `saveSettings()`, `mask()`, `PRESETS` |
| `mcp.ts` | MCP client: load servers.json, start stdio/HTTP servers, call tools |
| `workspace.ts` | Workspace path resolution, `tree()`, `resolvePath()`, `ensureWorkspace()` |
| `streammark/StreamMarkdown.tsx` | Streaming Markdown renderer (React, memoised blocks) |
| `streammark/remend.ts` | Core markdown-to-VDOM streaming engine |
| `blocks/catalog.ts` | `ui_search` catalog: index of available Blocks UI components by tags |
| `exec.ts` | Shell/Python/pip execution: bubblewrap sandbox when available, host terminal, sudo gate |
| `context.ts` | Scoped compaction (tools, web, messages, history), restore, context reports |
| `shared.ts` | Client/server helpers (canvas slugs, YouTube ids) |

### `src/db/` — Database

| File | Purpose |
|---|---|
| `index.ts` | `pg` pool when `DATABASE_URL` is set, otherwise embedded PGlite in `./data/pglite`; idempotent schema |
| `schema.ts` | Tables: `conversations`, `messages`, `settings` |

---

## Environment Variables (`.env`)

See [`.env.example`](.env.example). Everything except the workspace location can also be changed in Settings.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | unset → PGlite | Postgres connection string |
| `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | FreeLLMAPI | Any OpenAI-compatible endpoint (Gemini, OpenRouter, OpenAI, Ollama, FreeLLMAPI) |
| `LLM_CONTEXT_TOKENS` | model preset | Context window; prompts are budgeted to fit (16k works) |
| `FIRECRAWL_URL` / `FIRECRAWL_API_KEY` / `FIRECRAWL_CLOUD_URL` | local :3002 | Local-first search/scrape with cloud fallback |
| `WORKSPACE_DIR` | `./workspace` | Agent root |
| `ACCESS_MODE` | `sandbox` | Initial file access: `sandbox`, `home`, `full` |
| `TERMINAL_MODE` | `sandbox` | Initial terminal: `sandbox` or `host` |
| `ALLOW_SUDO` | `0` | Initial sudo switch (host terminal only) |
| `SUDO_PASSWORD` | unset | Only if sudo needs a password (or add it as a secret in Settings → Tools) |
| `HOST_ACCESS` | on | Set `off` on hosted/web deployments: pins everything to the sandbox, whatever the UI or API says |
| `LLM_VISION` | `1` | `0` for text-only models: images are referenced by path instead of attached |
| `QUALITY_GUARD` | `fix` | `fix` = lint UI files the agent writes and allow one repair round, `warn` = report only, `off` |
| `CHROME_PATH` | auto-detect | Chrome/Chromium used by the `browser` and `check` tools |
| `PYTHON_BIN` | `.venv` → `python3` | Interpreter for `run_python`, `pip_install` and office previews |
| `PORT` | `3000` | Used by `setup.sh`, the service and the launcher |
| `DEV_MODE` | `0` | `1` = developer mode (mock model, sample files); same as `window.__dev.enable()` |

---

## Host Access & Safety

Settings → **Access** has four switches. They're independent and off by default.

| Switch | Off | On |
|---|---|---|
| Home folder | Files confined to the workspace | Agent can read/write `~` (paths like `~/notes/x.md`) |
| Entire disk | Needs home access first | Absolute paths anywhere |
| Host terminal | Commands run in the workspace with app secrets stripped. With [bubblewrap](https://github.com/containers/bubblewrap) installed they are truly isolated (system read-only, home hidden, only the workspace writable) | Your real shell, as you |
| Allow sudo | `sudo`/`su`/`doas`/`pkexec` are refused | `sudo -n` (passwordless rules) or `sudo -A` using the `SUDO_PASSWORD` secret. Asks for confirmation when you enable it |

The server clamps these values on every read and write (sudo can never be on without the host terminal), and `HOST_ACCESS=off` locks all of them for web deployments.

---

## Canvas, Viewers & Context

- `<canvas title="…">…</canvas>` in a reply (or the `canvas_open` tool) opens a window; add `dock` to place it beside the chat. Only one window is docked at a time; opening another parks the previous one in the tray at the top.
- File viewers, each with its own bottom-bar actions:
  - **PDF**: pages, zoom, pen annotations, notes.
  - **Word**: rendered document, word count. Uses mammoth, or LibreOffice for `.doc`/`.odt`.
  - **Excel/CSV**: grid with sheet tabs, filter, copy as CSV.
  - **PowerPoint**: rendered slides, grid, speaker notes, present mode, outline. Uses python-pptx, or LibreOffice for page-accurate output.
  - **zip/tar**: browse and peek into entries, extract selected ones.
  - **Media**: playback speed, loop, picture-in-picture.
  - **Code/Markdown**: edit and save.
- Notes and ink save to `notes/<file>.md` and `notes/<file>.ink.json`, and the agent reads them when you mention them.
- **Context meter** (workspace panel):
  - Click it for the per-section breakdown and per-turn checkboxes.
  - The shrink button offers: fold tool output, fold web results, summarise history, or restore.
  - `/compact` and `/fold` do the same from the composer.
  - The agent can call `compact_context(scope)` itself.

---

## Agent Harness

Plain chat stays cheap: a short system prompt, core tools only, no plans or checks unless the task needs them. Machinery loads on demand.

- **Two terminals, two tools.** `shell` is the agent's sandbox. `host_shell` exists only while Settings → Access → Host terminal is on, and runs as you with your toolchains and logins.
- **Editing.**
  - `fs_read` shows 250 numbered lines. `fs_search` uses ripgrep.
  - `fs_edit` does exact find/replace, with a whitespace- and indentation-tolerant fallback, uniqueness checks and atomic multi-edits.
  - `fs_insert` adds lines at a line number without matching text.
  - Edits echo the changed region. They are rejected when they would break a file that parsed before, or when they contain "rest unchanged" placeholders.
  - `fs_write` refuses to overwrite a file the agent hasn't read.
- **Seeing.** `view_image` puts workspace images or URLs in front of the model. `browser` and `check` attach screenshots when vision is on.
- **Dev pack** (`proc_*`, `browser`, `check`):
  - Loads when a skill declaring `tools: dev` opens (build, debug, design, host), or always on large context windows (Settings → Tools).
  - Servers run as managed processes, so the agent waits for a port instead of sleeping, and restarts instead of re-spawning.
- **Planning.** `todo` shows a checklist in the chat, and the current step is recited after each tool result. `ask_user` shows option buttons and ends the turn.
- **Quality guard.** HTML/CSS/JSX the agent writes is linted for generic AI styling (novelty fonts, neon, purple gradients, glass, emoji headings, marketing copy, helper text). With `fix`, the agent gets one repair round.
- **Workflows as skills:**
  - research: sub-questions, primary sources, cross-checks, and a mandatory "coverage & gaps" section;
  - learn: diagnosis, small steps, quizzes, a known/shaky/not-covered tracker, and a gap audit;
  - build, with exact references for web, React+TS, Electron, Go, Rust, Java, Python, Android, iOS and Flutter;
  - debug and design.
  Type `/name` in the composer to force one.

## Extensions

Settings → **MCP** lists installed servers with credential badges, a curated catalog (GitHub, Context7, Hugging Face, Postgres, Supabase, paper search, Chroma) and a registry search.
- Credentials resolve in order: Settings secret → environment → your existing CLI login (`gh auth token`, Hugging Face token file). The CLI login is only used when you have granted home or host-terminal access, so a GitHub login you already have needs no setup.
- Servers that duplicate built-in tools (filesystem, fetch, puppeteer, memory, git) are flagged.

Settings → **Skills** installs from GitHub (`owner/repo`, a path, or a URL) with a picker for multi-skill repos, and shows skills added with `npx skills add` (`.agents/skills`). Built-in skills are never overwritten.

## Developer Mode

Example content is kept out of the normal app. From the browser console:

```js
__dev.enable()   // adds the offline "mock" provider (Settings → Model), enables the calls below
__dev.mock()     // switch to the scripted mock model: try "jee mock test", "graph", "aspirin", "make a plan", "ask", "open <file>"
__dev.samples()  // writes one example file per viewer type to uploads/samples (docx, xlsx, pptx, pdf, csv, zip, png, md, json)
__dev.disable()
```

`DEV_MODE=1` does the same from `.env`. The mock also runs standalone: `node dev/mock-llm.mjs 3099` and `LLM_BASE_URL=http://127.0.0.1:3099/v1`. It streams deliberately irregular chunks to exercise the renderer. Unit tests: `node --experimental-strip-types dev/tests/edit.test.ts`.

---

## Key Customisations Made

### 1. FreeLLMAPI Integration with Dynamic Model Fetching
- Default provider set to `freellmapi` pointing at `http://localhost:3001/v1`
- Added `/api/models` endpoint that queries the provider's `/v1/models` and returns sorted, normalised model list
- Settings UI has a **"Fetch models"** button that populates a searchable dropdown; selecting a model auto-fills its context window size

### 2. Hybrid Firecrawl Routing (`src/lib/web.ts`)
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
curl -fsSL https://raw.githubusercontent.com/bhavyam2468/final-chat/main/setup.sh | bash
# or, in a checkout:  ./setup.sh [--local|--online] [--yes] [--no-service] [--with-firecrawl] [--port N]
```

`setup.sh`:
- detects a desktop vs. a server and the OS package manager;
- checks Node (offers nvm), Python (creates `.venv`), Docker, Chrome, bubblewrap, uv, LibreOffice and a `gh` login;
- probes FreeLLMAPI (:3001), Ollama (:11434), Firecrawl (:3002) and a Postgres container, and adds only the missing `.env` keys (it asks for API keys when run interactively);
- installs, builds, and on a desktop installs the systemd user service / launchd agent, a `minimalist-chat` launcher and an app-menu entry;
- binds to 127.0.0.1 locally, because the host terminal must not be reachable from the network. On a server it binds to 0.0.0.0 with `HOST_ACCESS=off`.

`--with-firecrawl` clones and starts self-hosted Firecrawl in Docker. Re-running is safe.

Manual install:

```bash
# 1. Clone
git clone https://github.com/bhavyam2468/final-chat.git && cd final-chat

# 2. Copy and fill in your env
cp .env.example .env
# Edit .env with your FreeLLMAPI key, Firecrawl keys, etc.

# 3. Install (Postgres optional: without DATABASE_URL an embedded PGlite DB is used)
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # Python tools + office previews
# optional: bubblewrap (sandbox isolation), libreoffice (page-accurate .doc/.ppt previews)

# 4. Build and run
npm run build
npm start

# App is at http://localhost:3000
```

> `setup.sh` installs the service and launcher; `SETUP.md` has the owner's machine notes.

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

## Recovery and regression work

For the September 2026 stress-test recovery, start with
[`docs/RECOVERY.md`](docs/RECOVERY.md), then the
[requirements/evidence tracker](docs/STRESS-TEST-TRACKER.md) and
[independent first-pass research](docs/HARNESS-RESEARCH.md).
These documents distinguish inspected code from reproduced defects and completed fixes.

With Node 22.6+ (type stripping support) and dependencies installed:

```bash
npm test          # existing editing and harness helper tests
npm run check     # tests, TypeScript, ESLint
npm run build     # production build, separately
```

The current helper tests do not cover browser interactions or live model behavior.
Keep private stress-test exports and screenshots out of Git; commit redacted regression
fixtures only after reviewing their contents.
