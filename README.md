# Minimalist AI Chat Workspace

A quiet, minimal AI operating surface — chat, sandboxed workspace, tools, generative UI (Blocks), and floating canvases — running entirely on your local machine with your own AI providers and zero mandatory cloud dependency.

> **Live instance** runs as a systemd user service at `http://localhost:3000`. Open it from the **"Minimalist AI Workspace"** desktop launcher (Zen Browser).

---

## What This App Does

| Capability | Description |
|---|---|
| **General mode** | New Chat opens a separate General conversation for unrelated questions. It does not auto-search, keeps tool calls visible, and has its own history. "Open in chat" promotes it into normal chat without mixing histories. `/workflows`, `/project` and `/google` remain composer workflows (the one-liner research and brief commands became workflows) |
| **Modes** | `/mode` turns the composer into a picker that focuses the chat on one job (Search, Plan, Code, Learn, Write, Data). A mode is a real tool policy — the tools it refuses are absent from the request — plus a prompt block and an auto-loaded skill. Spec: [`docs/MODES.md`](docs/MODES.md) |
| **Workflows** | A named procedure the app performs: `workflows/<name>/workflow.md` declares steps the app runs itself (search, open the pages) and one thinking step, with real progress in a window and only the report in the chat. Ships deep research; the agent can save new ones (`workflow_save`) or run them (`start_workflow`). Spec: [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) |
| **AI Agent Tools** | The AI can read/write files, run bash commands, run Python, search the web, scrape pages, extract structured data |
| **Workspace** | Sandboxed file tree the agent operates in. Home folder, entire disk, host terminal and sudo are separate switches (Settings → Access), all off by default |
| **BlocksUI** | Generative UI language for `<ui>`: ~60 components (layout, paging decks, quizzes, timers, charts, Desmos-style graphs, LaTeX, SMILES/3D molecules, diagrams, native flowcharts/trees/outlines, maps…), reactive bindings, JS/Python logic and a relational layout language. Spec: [`docs/BLOCKS.md`](docs/BLOCKS.md) |
| **Canvas** | Floating windows or **docked** beside the chat (drag the left edge to resize). Anything chat can show can go in a canvas; native viewers for PDF, Word, Excel/CSV, PowerPoint, zip/tar (browse without extracting), images, audio/video, code |
| **Context status** | Live token meter in the workspace panel, per-section breakdown, and scoped compaction: fold tool output, fold web results, summarise history, or compact selected turns. Everything is restorable |
| **Streaming** | Rate-adaptive smoothing for text, markdown and every Blocks component: no jitter, no re-render flashes, stable skeletons while a component streams |
| **MCP Servers** | Curated integrations plus any stdio/HTTP server; remote ones sign in with one click (OAuth, no API key to copy) |
| **Skills** | Progressive-disclosure skill system (SKILL.md files teach the agent new capabilities on demand); the agent can write and install skills in chat |
| **Local-first web research** | SearXNG discovers URLs, parallel HTTP fetches use Mozilla Readability + Turndown, and Firecrawl remains an explicit opt-in fallback for difficult JavaScript/anti-bot pages |
| **FreeLLMAPI** | Local proxy to 200+ AI models; dynamic model picker in Settings |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)  
- **Language**: TypeScript 5 + React 19  
- **Database**: Drizzle ORM on PostgreSQL (`DATABASE_URL`) or embedded **PGlite** (default, zero setup)  
- **Styling**: Tailwind CSS v4  
- **Markdown**: Custom `streammark` streaming renderer (KaTeX math, highlight.js, footnotes, embeds)  
- **AI**: OpenAI-compatible API (configured to FreeLLMAPI)  
- **Web research**: SearXNG discovery + HTTP/Readability extraction; optional Firecrawl escalation

---

## File & Directory Reference

### Root

| File/Dir | Purpose |
|---|---|
| `package.json` | npm scripts and dependencies |
| `next.config.ts` | Next.js config |
| `tsconfig.json` | TypeScript config |
| `drizzle.config.json` | Drizzle ORM config pointing at `DATABASE_URL` |
| `docker-compose.yml` | Starts Postgres 16 and the lightweight SearXNG + Valkey discovery stack (Firecrawl is not included) |
| `.env` | **Local-only** environment variables (not committed) |
| `DESIGN.md` | Visual/UX design principles for the app |
| `workspace/` | Agent's working directory (gitignored). Contains `system/SYSTEM.md`, `system/AGENTS.md` (the user's own standing instructions), `system/skills/`, `system/mcp/servers.json`, `system/memory/` (profile + dated episodes), `workflows/` (the user's and shipped procedures), `.workflows/` (run records and the pages they fetched), `uploads/`, `artifacts/`, `notes/`, `chats/` |
| `workspace-template/` | Seed files copied into `workspace/` on first run |
| `public/blocks/` | Standalone Blocks runtime (extended HTML tags, Pyodide, relational style language, backend-neutral live streams) |
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
| `api/mcp/oauth` | GET/POST/DELETE — one-click OAuth sign-in for a remote MCP server (discovery + dynamic registration + PKCE), tokens stored in the workspace |
| `api/mcp/oauth/callback` | GET — OAuth redirect target; exchanges the code and returns to the app |
| `api/skills/route.ts` | GET/POST — list installed skills; install from GitHub URL |
| `api/workspace/route.ts` | GET/POST/DELETE/PUT — workspace file CRUD |
| `api/workspace/upload` | POST — upload files into workspace |
| `api/python/route.ts` | POST — run a one-shot Python snippet in workspace |
| `api/blocks/route.ts` | Streaming NDJSON bridge for sandbox Python, Bash/process output, and resource snapshots |
| `api/search/route.ts` | GET — search conversations |
| `api/workflows/route.ts` | GET — the workflow definitions and recent runs; POST — start one (inserts the card, returns at once) |
| `api/workflows/[id]/route.ts` | GET — a run's record; POST — stop it |
| `api/workflows/[id]/ui/route.ts` | GET — the workflow's own `ui.html`, if it ships one |
| `api/health/route.ts` | GET — liveness probe (checks DB connection) |
| `files/[...path]/route.ts` | GET — serve workspace files over HTTP |

### `src/components/` — React Components

| Component | Purpose |
|---|---|
| `App.tsx` | Root client component: layout, panels, chat state, keyboard shortcuts |
| `Composer.tsx` | Message input box: queue & steer while streaming, slash commands, `@`-mentions, attachments, the process strip |
| `palette.tsx` | The omnibox the input bar expands into: commands, chats, workspace browser, sources, settings, processes, skills |
| `Message.tsx` | Renders a single message (user or assistant) with tool calls, sources, branches |
| `Panels.tsx` | Left panel (Chats and separate General history), right panel (workspace file browser) |
| `Canvas.tsx` | Floating canvas overlay for expanded Blocks/generative-UI; hosts workflow windows |
| `Workflow.tsx` | The workflow card in the chat and the window body: steps, sources, log, the report, and a workflow's own `ui.html` when it has one |
| `Block.tsx` | Renders a `<canvas>` block (isolated iframe sandboxed to `/blocks/`) |
| `Settings.tsx` | Settings panel (in-layout, beside the chat, not a modal): Model, Tools, Access, MCP, Skills |
| `ctx.ts` | Shared React contexts (conversation, settings, theme) |

### `src/lib/` — Backend Logic

| Module | Purpose |
|---|---|
| `agent.ts` | Agent loop: system prompt, history, tool packs per step, image hand-off, todo recitation, quality guard |
| `tools/index.ts` | Tool schemas (core + dev pack) and the `execTool()` dispatcher |
| `tools/edit.ts` / `tools/syntax.ts` | Robust edits (exact → whitespace-tolerant → indentation-shifted matching, placeholder rejection) and the syntax guard |
| `web.ts` | Local-first web router: SearXNG → keyless fallback, HTTP/Readability fetch, optional Firecrawl escalation |
| `procs.ts` | Background processes for the agent (dev servers): start, logs, wait for port/pattern, restart, stop |
| `browser.ts` | Headless Chrome via puppeteer-core: screenshots, console errors, scripted steps |
| `harness/check.ts` / `harness/slop.ts` | `check` tool (types, lint, tests, build, design lint + screenshot) and the AI-styling linter |
| `skills.ts` / `market.ts` / `credentials.ts` | Skill discovery and GitHub install, curated MCP/skill catalog, credential resolution (secret → env → CLI login) |
| `settings.ts` | Settings type, defaults, `getSettings()`, `saveSettings()`, `mask()`, `PRESETS` |
| `mcp.ts` | MCP client: load servers.json, start stdio/HTTP servers, call tools |
| `mcp-auth.ts` | OAuth client provider for remote MCP servers: per-server tokens, dynamic client registration, PKCE |
| `workspace.ts` | Workspace path resolution, `tree()`, `resolvePath()`, `ensureWorkspace()` |
| `streammark/StreamMarkdown.tsx` | Streaming Markdown renderer (React, memoised blocks) |
| `streammark/remend.ts` | Core markdown-to-VDOM streaming engine |
| `blocks/catalog.ts` | `ui_search` catalog: index of available Blocks UI components by tags |
| `exec.ts` | Shell/Python/pip execution: bubblewrap sandbox when available, host terminal, sudo gate |
| `api/blocks` + `public/blocks/runtime.js` | Backend-neutral Blocks bridge: streamed sandbox Bash/Python/process output, tails of explicitly agent-started host processes, and live resource snapshots can feed the same tables/charts |
| `context.ts` | Scoped compaction (tools, web, messages, history), restore, context reports |
| `workflows.ts` / `workflow-format.ts` | Workflow engine (runners, the hidden thinking conversation, the card and its report, saves) and the pure format — parser, record, progress, brief |
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
| `LLM_WORKING_TOKENS` | 64000 | What one request may use even if the window is bigger; trimming, folding and auto-compaction work against it (Settings → Working context) |
| `SEARXNG_URL` | `http://localhost:8080` | Local SearXNG JSON endpoint for URL discovery |
| `FIRECRAWL_ENABLED` | `0` | Explicitly enable Firecrawl escalation; off keeps local browsers out of ordinary research |
| `FIRECRAWL_URL` / `FIRECRAWL_API_KEY` / `FIRECRAWL_CLOUD_URL` | local :3002 | Optional local/cloud fallback for difficult pages and structured extraction |
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

- `<canvas title="…">…</canvas>` in a reply (or the `canvas_open` tool) opens in the free sidebar; if it is occupied, the new canvas floats instead of replacing the current one. Add `dock` to request the sidebar explicitly, or `dock="false"` to keep a canvas floating. Reopening a canvas focuses/restores its existing window.
- Floating canvases resize from every edge and corner, can be dragged to a screen edge to park as a small tab, and minimize to a persistent left-edge shelf. Shelf items restore on click and have a separate close control.
- File viewers, each with its own bottom-bar actions:
  - **PDF**: smooth page navigation, zoom, selectable text with source-aware quotes, pen annotations, notes.
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
  - The full process suite: `proc_start` detaches at once, `proc_logs` reads or blocks (`wait_for` port/pattern/exit), `proc_wait` pauses until a condition with a timeout, `proc_write` answers prompts and feeds repls through stdin, `proc_signal` sends SIGHUP/SIGUSR-style signals, `proc_stop` kills the tree, `proc_restart` re-runs the same command. Every process the agent starts leaves a thin strip docked to the input bar's bottom edge; click it to see the list (running and exited) and open any of them in a terminal window.
- **Planning.** `todo` shows a checklist in the chat, and the current step is recited after each tool result. `ask_user` shows option buttons and ends the turn.
- **Presentation.** Blocks are the native medium, not decoration: `<ui>` first, prose for what a block cannot say. The loop checks each finished answer and gives one round to convert a markdown table (6+ rows), five or more number-carrying bullets, a spec sheet of lines, or a chart linked from `run_python` into blocks (`x-table`, `x-chart`, `x-graph`, `x-stat`, `x-kv`). The reference lives in `system/skills/blocks/SKILL.md`; the rule and examples live in `SYSTEM.md`.
- **Quality guard.** HTML/CSS/JSX the agent writes is linted for generic AI styling (novelty fonts, neon, purple gradients, glass, emoji headings, marketing copy, helper text). With `fix`, the agent gets one repair round.
- **Skills (12 shipped, one job each):** blocks (the UI language), canvas, documents (PDF/Office/CSV + sandbox Python), research (search craft, literature, critique), workflows (writing and running repeatable procedures), build (web, React, Electron, Go, Rust, Java, Android, iOS, Flutter), debug, design, memory (remember + context hygiene), extensions (MCP, credentials, skill authoring), terminal (sandbox vs host, home files, sudo), learn. Type `/name` in the composer to force one. The agent can author a skill (`skill_create`) or install one from GitHub (`skill_install`) in chat; Settings → Skills does the same by hand.
  A skill file the user edited is never overwritten; a shipped skill that no longer ships is moved to `.trash/template-updates` when the workspace syncs.

## Workflows

A workflow is a named procedure the app performs: `workspace/workflows/<name>/workflow.md` declares the steps in
order and the app does the mechanical ones itself — `search` (the same path as the `web_search` tool, so your
settings are honoured) and `read` (fetch + readability extraction, saved into the run's folder) — then the one
`agent` step thinks over what was gathered and writes the report. Progress is real because it comes from the work
rather than from the token stream: a step is done when its work is done.

Start one from `/workflows` in the composer (pick it, type the input), or let the agent start it (`start_workflow`
— useful in Search mode, where deep research is the only way to save or run anything). The run opens a window
with the steps, the sources it found and opened, the log and the report; the chat gets the card and then the
report, and nothing of the process, so what you carry into the next turn is the answer. A workflow can ship its
own `ui.html` (a Blocks document) to present the run however it likes; a deep-research one does.

The agent writes new workflows with `workflow_save`, which refuses anything the runner could not run (the format
is small on purpose: front matter, one line per thing). Community workflows are folders — copy one into
`workspace/workflows/` and it appears in `/workflows`. Full spec: [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md).

## Queue & Steer

The input bar works while the AI responds — nothing is ever locked:

- **`Enter` queues.** Your message sits above the input with a number; when the turn ends it sends automatically, in order. Queues survive reloads and chat switches.
- **`Enter` again steers.** Pressing `Enter` on the empty composer (or the ⚡ on a queued card, or `⌘/Ctrl+Enter` as you type) sends that message straight into the running turn. The server saves it, chains it into the conversation (user → steer → reply), and hands it to the agent with a wrapper: *keep the work done so far, fold this direction in, adjust course with minimal churn.* If the run ended a beat earlier, it simply sends normally.
- **`↑` edits.** Pulls the newest queued message back into the input; `Enter` puts it back in its place. Click any card to edit it, ✕ to drop it.
- **Stop parks the queue.** Nothing auto-sends after an explicit stop.

## Terminals

The `/processes` palette (or a process pill on the input bar) opens a terminal window in the canvas:

- **Sandbox terminal** (default): an interactive `bash` in the agent's sandbox — workspace `cwd`, app secrets stripped, bubblewrap namespace when installed.
- **Host terminal** (Settings → Access → Host terminal): your real `$SHELL` in your home directory, profile and toolchains included; `sudo` prompts work because the session is a genuine pseudo-tty.
- Rendered with **xterm.js**: full colors (256 + truecolor), a real caret, mouse selection, copy (`⌘/Ctrl+Shift+C`, or the footer button) and paste (`⌘/Ctrl+Shift+V`, the footer button, or middle-click), `⌘A` selects the scrollback. Windows resize the pty and running programs get `SIGWINCH` (needs the optional `node-pty` native build; without it a fixed-size `script` pty is used).
- Sessions stream over NDJSON and outlive the window; keystrokes, tab completion, shell history and password prompts behave exactly like a local terminal. A process's window shows its live output with Stop and Restart.

## Extensions

Settings → **MCP** lists installed servers with credential badges and a curated catalog. The catalog is picked for what a built-in tool cannot do, and remote servers that support OAuth 2.1 with dynamic client registration connect with **one click and no API key**: Notion, Linear, Jira & Confluence, Figma, Sentry. Keyless servers (DeepWiki, Context7) need nothing at all. Google's own Workspace servers are listed too, with an honest note that they need a Google ch away.
- One-click sign-in: the app discovers the authorization server, registers itself, opens the service, and comes back to `/api/mcp/oauth/callback` with a code. Tokens live in `workspace/system/mcp/auth.json` (mode 600) and refresh on their own. When the browser cannot reach the app, the same flow finishes with a pasted code.
- In chat, `mcp_search` finds a server and `mcp_add` adds it and hands the user a sign-in link.
- Credentials for token-based servers resolve in order: Settings secret → environment → your existing CLI login (`gh auth token`, Hugging Face token file). The CLI login is only used when you have granted home or host-terminal access, so a GitHub login you already have needs no setup.
- Servers that duplicate built-in tools (filesystem, fetch, puppeteer, the remember tool, git) are flagged.

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

### 2. Local-first web research (`src/lib/web.ts`)
- **`web_search`** queries the local SearXNG JSON API first, then uses short-timeout keyless adapters so a fresh install remains usable. Firecrawl search is only considered when the explicit fallback switch is on.
- **`web_fetch`** uses direct HTTP plus Mozilla Readability and Turndown to remove navigation, ads and boilerplate without a browser. Multiple fetch calls from one model step are started in parallel and each row reports its own progress.
- **`web_extract`** remains available for structured Firecrawl extraction when the operator enables Firecrawl and supplies a cloud key.
- Local Firecrawl/Chromium is never contacted for routine searches or pages. Enable it only for JavaScript-heavy, anti-bot, or otherwise unsupported pages.

### 3. Background Service & Desktop App
- `~/.config/systemd/user/minimalist-chat.service`: runs `npm start` persistently; auto-starts Postgres on boot
- `~/.local/share/applications/minimalist-chat.desktop`: shows in app launcher as "Minimalist AI Workspace"; opens in Zen Browser
- `~/.local/bin/minimalist-chat`: CLI control script (`open|summon|ask "…"|hotkey|start|stop|restart|status|logs`)
- The desktop layer: a global hotkey opens a small *Ask* window (`minimalist-chat summon`, a Chrome/Chromium app window — no tabs, no URL bar), `minimalist-chat ask "…"` streams an answer into a terminal, and the model can notify you with `os_notify`. Every piece calls the app's HTTP APIs — the desktop never drives the UI. See [docs/DESKTOP.md](docs/DESKTOP.md).

---

## Quick Start (Fresh Machine)

```bash
curl -fsSL https://raw.githubusercontent.com/bhavyam2468/final-chat/main/setup.sh | bash
# or, in a checkout:  ./setup.sh [--local|--online] [--yes] [--update] [--no-service] [--with-firecrawl] [--port N]
```

`setup.sh`:
- detects a desktop vs. a server and the OS package manager;
- checks Node (offers nvm), Python (creates `.venv`), Docker, Chrome, bubblewrap, uv, LibreOffice and a `gh` login;
- probes an existing FreeLLMAPI (:3001), Ollama (:11434), SearXNG (:8080), Firecrawl (:3002) and Postgres, and adds only missing `.env` keys (it asks for credentials when run interactively); if Docker is missing it offers to install Docker + Compose;
- starts the lightweight Postgres/SearXNG stack by default; Firecrawl is not part of the ordinary path and only starts with `--with-firecrawl`;
- installs, builds, and on a desktop installs the systemd user service / launchd agent, a `minimalist-chat` launcher and an app-menu entry;
- binds to 127.0.0.1 locally, because the host terminal must not be reachable from the network. On a server it binds to 0.0.0.0 with `HOST_ACCESS=off`.

`--with-firecrawl` clones and starts self-hosted Firecrawl in Docker. It also enables the explicit fallback in `.env`; ordinary research still uses SearXNG/HTTP first. Re-running is safe. After installation, `minimalist-chat update` (or `./setup.sh --update`) refuses a dirty source checkout, fast-forwards, rebuilds, and refreshes the service.

Manual install:

```bash
# 1. Clone
git clone https://github.com/bhavyam2468/final-chat.git && cd final-chat

# 2. Copy and fill in your env
cp .env.example .env
# Edit .env with your FreeLLMAPI key, Firecrawl keys, etc.

# 3. Start local Postgres + SearXNG (optional; PGlite and keyless search remain available)
docker compose up -d

# 4. Install (without DATABASE_URL the embedded PGlite DB is used)
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # Python tools + office previews
# optional: bubblewrap (sandbox isolation), libreoffice (page-accurate .doc/.ppt previews)

# 5. Build and run
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
| `/` | Expand the input bar into the command list |
| `/chats` `/workspace` `/settings` `/model` `/access` `/processes` `/sources` `/artifacts` `/skills` | The input bar becomes that surface (↑↓ navigate, `→` drill in, `←` back, `Esc` collapses) |
| In `/settings` | Rows toggle on `Enter`; value rows hand the input bar over for typing (`Enter` saves, `Esc` cancels) — the whole settings menu, keyboard only |
| `@` | Mention workspace files |
| `Enter` | Send message |
| `Shift+Enter` | Newline |
| `Enter` while responding | Queue the message |
| `Enter` again on empty / `⌘Enter` | Steer the running turn now |
| `↑` on empty while responding | Edit the newest queued message |
| `⌘K` / `Ctrl+K` | The omnibox (commands) |
| `⌘B` / `Ctrl+B` | Toggle chat panel |
| `⌘.` / `Ctrl+.` | Toggle workspace panel |
| `⌘⇧O` / `Ctrl+Shift+O` | New chat |
| `Esc` | Close modal/overlay |
