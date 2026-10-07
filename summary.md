# SYSTEM ARCHITECTURE & CODEBASE REFERENCE

## 1. ARCHITECTURE OVERVIEW

### 1.1 Stack & Invariants
- Host OS: Linux.
- Service Manager: systemd (`minimalist-chat.service`).
- Execution Environment: Node.js (v20+), npm.
- Application Framework: Next.js 16.2.6 (App Router), React 19, TypeScript 5.
- Persistence Layer: PostgreSQL 16 (port 5432, container `minimalist-ai-chat-workspace-db-1`) via Drizzle ORM. Fallback persistence: `@electric-sql/pglite` (directory: `.pglite/`).
- Styling: Tailwind CSS v4, CSS Custom Properties (`--bg`, `--fg`, `--muted`, `--surface`, `--line`, `--accent`, `--float`, `--r`).
- Client Target: Zen Browser (`http://localhost:3000`).
- Model Provider: OpenAI protocol (`http://localhost:3001/v1/chat/completions`). Model: `gemini-2.5-flash`.
- Ingestion Engine: Firecrawl service (`http://localhost:3002/v1/scrape`), fallback: Cloud Firecrawl API (`https://api.firecrawl.dev`).
- Search Engine: SearXNG / DuckDuckGo endpoint, fallback: Cloud Firecrawl Search API.
- Process Boundary: `workspace/` directory. Boundary overrides: `~`, `/`, `host_shell`, `sudo`. Linux namespace isolation: `bwrap` (Bubblewrap).

```
   ┌─────────────────────────────────────────────────────────────┐
   │                    Client: Zen Browser                      │
   │      ChatView  │  Panels (Tree, Convs)  │      Canvas       │
   └──────────────────────────────▲──────────────────────────────┘
                                  │ SSE Stream / JSON APIs
   ┌──────────────────────────────▼──────────────────────────────┐
   │                  Next.js App Server (:3000)                 │
   │  /api/chat  │  /api/conversations  │  /api/preview  │ etc.  │
   └───────────────▲──────────────────────────────▲──────────────┘
                   │                              │
     ┌─────────────▼──────────────┐  ┌────────────▼──────────────┐
     │  Agent Loop & Harness      │  │  File Viewers & Blocks    │
     │  - Shell Loop Preflight    │  │  - Mammoth, unpdf, tikz   │
     │  - Anti-Slop & Stuck Check │  │  - Elements Runtime       │
     │  - Tool Execution Router   │  │  - Pyodide WebAssembly    │
     └─────────────▲──────────────┘  └───────────────────────────┘
                   │
    ┌──────────────┴───────────────────────────┐
    │ Services & Host OS                       │
    │  ├─ FreeLLMAPI (:3001)                   │
    │  ├─ PostgreSQL (:5432)                   │
    │  ├─ Firecrawl (:3002) / Cloud            │
    │  └─ Host OS (Bash, Python3, bwrap sandbox│
    └──────────────────────────────────────────┘
```

---

### 1.2 Execution Lifecycles

#### Message Turn & Tool Execution Loop
1. User input enters `src/components/Composer.tsx`.
2. Client transmits HTTP POST request to `/api/chat` with body: `{ content: string, attachments?: Attachment[], quote?: Quote, parentId?: string, threadOf?: string }`.
3. `/api/chat/route.ts` records row in database table `messages`.
4. Endpoint initializes SSE `TransformStream` and invokes `runAgent()` from `src/lib/agent.ts`.
5. `runAgent()` compiles prompt payload from:
   - Base directives: `workspace/system/SYSTEM.md`.
   - User profile: `workspace/system/memory/profile.md`.
   - Interaction history: `workspace/system/memory/episodes.jsonl`.
   - Directory tree: `src/lib/workspace.ts`.
   - Skill manifests: `workspace/system/skills/*/SKILL.md` via `src/lib/skills.ts`.
6. `runAgent()` transmits payload to LLM HTTP endpoint (`/v1/chat/completions`).
7. Stream processor (`src/lib/harness/stream.ts`) evaluates SSE chunks:
   - Emits thinking tokens inside `<thought>` or `reasoning_content` as SSE event `reasoning`.
   - Emits text tokens as SSE event `chunk`.
   - Buffers tool call JSON tokens into tool call objects.
8. On tool call detection:
   - Harness invokes `guard.ts`: validates tool name and JSON arguments against schemas.
   - Shell commands invoke `shell-preflight.ts`: checks command strings against regex patterns blocking infinite loops and process forks.
   - Loop tracker `stuck.ts` checks history of tool calls for repetition cycles.
   - Approval gate: If tool requires authorization, stream emits `tool_start` with approval flag; execution halts until client transmits POST to `/api/conversations/[id]/approve`.
   - Dispatcher executes `execTool()` in `src/lib/tools/index.ts`.
   - Filesystem boundary enforced via `resolvePath()` in `src/lib/workspace.ts`.
   - Execution returns `{ result: string, ok: boolean, meta?: Record<string, unknown> }`.
   - Character thresholds truncate output exceeding limits.
   - Result appends to LLM message history.
   - Loop increments counter (limit: 10 iterations).
9. Completion:
   - Stream emits SSE event `done`.
   - Server updates row in table `messages` with column `parts` (JSON array of text, reasoning, and tool calls).

#### Generative UI (Blocks) Lifecycle
1. LLM output emits tags `<ui>...</ui>` or `<canvas>...</canvas>`.
2. `StreamMarkdown.tsx` matches tag tokens.
3. Component mounts `Block.tsx`, loading `iframe` with source `public/blocks/runtime.html`.
4. Client sends `postMessage` containing HTML, CSS, JavaScript, and Python code to `iframe`.
5. `runtime.js` initializes state store and loads Pyodide WebAssembly.
6. Tag definitions (`<x-button>`, `<x-chart>`, `<x-map>`, `<x-smiles>`, `<x-3dmol>`, `<x-deck>`, etc.) execute via `elements.js`.
7. User controls permit promotion to floating window or docked column in `Canvas.tsx`.

#### Window Management & Edge Docking Lifecycle
1. Preview requests or Canvas promotions add `Win` objects to `AppCtx.windows`.
2. `Canvas.tsx` positions windows as floating containers or docked columns adjacent to chat.
3. Dragging window past screen edge sets `isPeek: true`.
4. Hovering edge expands peek bar; mouse dwell past time threshold or click event restores window coordinates.

#### Modes & Tool Restrictions
1. `src/lib/modes.ts` is the registry: `{ id, label, hint, skill, fallback, deny }` for chat, search, plan, debug, build, learn, write.
2. `buildSystem()` (`agent.ts`) injects the active mode's skill body (`system/skills/mode-<id>/SKILL.md`, front matter `mode: true`) as its own context section; `skillsIndex()` hides those skills and `skill_open` refuses them.
3. `allTools()` filters the deny list out of the tool definitions the model receives, so a restricted mode never sees the schema.
4. `execTool()` (`tools/index.ts`) refuses a denied name a second time with a mode-specific message — the gate that catches queued/steered messages and mid-run mode switches.
5. The UI mirror: `/mode` opens the palette's `modes` panel, the composer shows one chip, `App.applyMode()` maps `state.mode` ({"general"} = the quiet surface, a mode id = a posture) to (surface, mode), and `chooseMode()` PATCHes the conversation. Docs: `docs/MODES.md`; proof: `dev/modes-e2e.mjs`.

#### Workflows (a window, not a block)
1. `src/lib/workflows/types.ts` is the contract: `WorkflowDef` (id, name, hint, icon, input, budget, steps, panes, deliver, prompts), `StepSpec{id,title,note,kind}`, `Budget`, `PaneDef`, `RunState`, `RunEvent`, `Source`.
2. `deep-research.ts` is the built-in: eight `StepSpec`s over the engine's kinds (plan, search, select, read, gaps, write, check, deliver) plus seven prompts as data. `index.ts` is the registry (`listWorkflows`/`workflowOf`/`loadWorkflow`) and merges a tolerant `workspace/workflows/<id>.json` override field by field.
3. `runner.ts` executes a run in `globalThis.__wfRuns`: every model call is isolated (`complete()` with its own system prompt and no history), pages are read at `mapLimit 3`, `run.json` is written coalesced at 300 ms with `report.md` beside it (newest 20 runs kept), `attachRun()` serves replay-then-live NDJSON, and `deliver()` appends exactly one assistant message — parts `[run, text]` — to the newest main-line leaf.
4. API: `GET /api/workflows` (definitions + `active` + `recent(150s)`), `POST` start/stop, `GET /api/workflows/run?id=&stream=1`. The chat page polls every 4 s while visible and pulls the conversation when a new `recent[].messageId` appears.
5. UI: `Workflow.tsx` is a *chrome* canvas window (`{ratio:1.62, pw:1040}`) rendering itself from the run snapshot — head with status/elapsed/stats, a step rail, and panes (native: steps/plan/sources/report/log; BlocksUI: evidence). `Message.tsx` draws the `run` part as a chip that reopens the window; `Composer.tsx` turns `/workflows` (or `/research`) into a `.cwork` chip so the next send is the run's input; `palette.tsx` lists definitions.
6. The model's side: `workflow_list` + `workflow_start(workflow, question)` (`tools/index.ts`) and `system/skills/workflow/SKILL.md` — start a run, do not poll, the report posts itself. `plan` mode denies `workflow_start`. Docs: `docs/WORKFLOWS.md`; proof: `dev/workflows-e2e.mjs`.

#### Canvas Editor & Sandbox Runner
1. Canvas files (`text`/`md`/`html`/`ui`) read through `readFile` into `Viewer` state and render in `<Editor>` (highlight.js layer behind a textarea, gutter, Ln/Col, auto-pairs, Tab indent, comment toggle, Ctrl+S save, Ctrl+Enter run).
2. Save PUTs `/api/workspace`; Run POSTs `/api/run` (`start|chunk|done` NDJSON) via `Runner.startRun`, drawn in the `RunDrawer`; `auto` re-runs on save for compiled languages.
3. `lib/file-run.ts` is shared with the model: `file_run(path)` executes the same command table (`run-langs.ts`) and records into the 40-entry run store that `file_runs(path)` reads back.
4. Save/Run are gated on the file body having loaded, so a slow fetch plus a fast Ctrl+S cannot overwrite a file with an empty buffer.

---

## 2. DATABASE SCHEMA (`src/db/schema.ts`)

### Table `conversations`
- `id`: `text`, `PRIMARY KEY` (format: `c_<timestamp>_<random>`).
- `title`: `text`.
- `summary`: `text`.
- `summaryUpTo`: `text` (message ID reference).
- `context`: `text[]` (array of pinned file paths).
- `state`: `jsonb` (schema: `{ toolPacks?: string[], todo?: { text: string, done: boolean }[], approvals?: Record<string, boolean> }`).
- `createdAt`: `timestamp`.
- `updatedAt`: `timestamp`.

### Table `messages`
- `id`: `text`, `PRIMARY KEY` (format: `m_<timestamp>_<random>`).
- `conversationId`: `text`, foreign key referencing `conversations.id`, indexed.
- `parentId`: `text` (null for root messages).
- `threadOf`: `text` (side thread parent message ID reference).
- `role`: `text` (`user` | `assistant` | `system`).
- `content`: `text`.
- `parts`: `jsonb` (array of `{ type: "text" | "reasoning" | "tool_call" | "tool_result", ... }`).
- `attachments`: `jsonb` (array of `{ name: string, path: string, mime: string, size: number }`).
- `quote`: `jsonb` (`{ text: string, source?: string }`).
- `compact`: `boolean` (compaction status indicator).
- `createdAt`: `timestamp`.

### Table `settings`
- `key`: `text`, `PRIMARY KEY` (value: `"app"`).
- `value`: `jsonb` (application settings schema).
- `updatedAt`: `timestamp`.

---

## 3. FILE IMPLEMENTATION REFERENCE

### 3.1 Next.js App Router & Server Endpoints (`src/app/`)

#### `src/app/layout.tsx`
- Type: React Server Component.
- Responsibility: Root HTML layout.
- Implementation: Configures fonts (Geist Sans, Geist Mono), viewport parameters, and theme metadata. Injects inline script reading `localStorage.getItem("theme")` to set class `dark` before render, preventing flicker.

#### `src/app/page.tsx`
- Type: React Server Component.
- Responsibility: Entry point for single page application.
- Implementation: Imports `src/components/App.tsx` with SSR disabled (`ssr: false`) to ensure browser API availability.

#### `src/app/globals.css`
- Type: Stylesheet.
- Responsibility: CSS tokens and component styles.
- Implementation: Configures Tailwind CSS v4. Defines CSS custom properties (`--bg`, `--fg`, `--muted`, `--surface`, `--line`, `--accent`, `--float`, `--r`). Implements classes for layout (`.shell`, `.scroll`, `.column`), idle interface dimming (`.chrome.is-idle`), table scroll (`.sm-table`), window frames (`.win`, `.win.docked`, `.win.peek`), and source citation badges.

#### `src/app/api/chat/route.ts`
- Type: HTTP POST Endpoint.
- Responsibility: Message ingestion and agent turn streaming.
- Implementation: Extracts `{ content, attachments, quote, parentId, threadOf }` from JSON request. Inserts row into `messages`. Instantiates SSE `TransformStream`. Calls `runAgent()` from `src/lib/agent.ts`. Transmits SSE events: `chunk`, `reasoning`, `tool_start`, `tool_end`, `error`, `done`.

#### `src/app/api/conversations/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: Conversation index retrieval.
- Implementation: Queries table `conversations` via Drizzle ORM. Orders records by `updatedAt` descending. Returns array of conversation metadata records with message counts and tree leaf IDs.

#### `src/app/api/conversations/[id]/route.ts`
- Type: HTTP Route Handler (GET, PATCH, DELETE).
- Responsibility: Lifecycle operations on conversation by ID.
- Implementation:
  - GET: Retrieves conversation record and queries table `messages` where `conversationId = id`. Returns conversation object and message array for tree assembly.
  - PATCH: Updates `title` or `summary` columns.
  - DELETE: Deletes conversation row and cascades deletion of related message rows.

#### `src/app/api/conversations/[id]/approve/route.ts`
- Type: HTTP POST Endpoint.
- Responsibility: Tool call authorization gate.
- Implementation: Receives approval token from client. Updates authorization state in conversation record, signaling pending agent loop step to proceed with execution.

#### `src/app/api/conversations/[id]/compact/route.ts`
- Type: HTTP POST Endpoint.
- Responsibility: Message history compaction.
- Implementation: Receives compaction mode (`tools`, `web`, `messages`, `history`). Invokes `src/lib/context.ts` to replace turns or outputs with summary notes generated by LLM, reducing token consumption while preserving originals in database.

#### `src/app/api/conversations/[id]/context/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: Token accounting and context breakdown.
- Implementation: Computes token counts for system prompt, message history, workspace tree, and pinned context files using character-to-token ratio estimators from `src/lib/llm.ts`. Returns JSON breakdown.

#### `src/app/api/conversations/[id]/export/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: Conversation data serialization.
- Implementation: Exports conversation metadata, message tree, parts, and attachment references as JSON file download.

#### `src/app/api/models/route.ts`
- Type: HTTP Route Handler (GET, POST).
- Responsibility: LLM provider model discovery.
- Implementation: Requests `/v1/models` from configured provider base URL using stored credentials. Maps returned model list into standard schema `{ id: string, name: string }`.

#### `src/app/api/settings/route.ts`
- Type: HTTP Route Handler (GET, PUT).
- Responsibility: Application configuration management.
- Implementation:
  - GET: Reads settings from table `settings`, merges with environment variable defaults, and masks secrets (`apiKey`, `cloudFirecrawlKey`) with `••••`.
  - PUT: Validates JSON payload against `Settings` schema from `src/lib/settings.ts` and writes record to table `settings`.

#### `src/app/api/preview/route.ts`
- Type: HTTP POST Endpoint.
- Responsibility: Document format conversion for Canvas inspection.
- Implementation: Accepts file path. Routes file to parser:
  - PDF: Uses `unpdf` to extract page count, text positions, and render dimensions.
  - DOCX: Uses `mammoth` to convert Word documents into HTML.
  - XLSX / CSV: Parses worksheet rows into 2D JSON arrays for table rendering.
  - PPTX: Extracts slide hierarchy, notes, and shapes.
  - ZIP / TAR: Reads archive catalog and returns file hierarchy.

#### `src/app/api/memory/route.ts`
- Type: HTTP Route Handler (GET, POST).
- Responsibility: Agent memory persistence.
- Implementation: Reads and writes `workspace/system/memory/profile.md` for profile notes; appends JSON lines to `workspace/system/memory/episodes.jsonl` for interaction logs.

#### `src/app/api/projects/route.ts`
- Type: HTTP Route Handler (GET, POST, PATCH).
- Responsibility: Goal and milestone project tracking.
- Implementation: Manages tasks (`todo`, `doing`, `done`) and associates project execution logs in `workspace/system/projects/`.

#### `src/app/api/tikz/route.ts`
- Type: HTTP POST Endpoint.
- Responsibility: LaTeX TikZ diagram compilation.
- Implementation: Receives LaTeX TikZ code snippet. Invokes `node-tikzjax` to compile code into SVG format. Returns SVG string.

#### `src/app/api/search/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: Full-text indexing and retrieval.
- Implementation: Queries message database and workspace markdown files using indexed lookup in `src/lib/search-fast.ts`. Returns ranked text snippets with source file paths and line offsets.

#### `src/app/api/workspace/route.ts`
- Type: HTTP Route Handler (GET, POST, DELETE).
- Responsibility: Filesystem CRUD interface.
- Implementation: Confines path resolution to `WS` directory. Lists directory trees, reads file buffers, writes file contents, and deletes targets.

#### `src/app/api/workspace/upload/route.ts`
- Type: HTTP POST Endpoint.
- Responsibility: File upload handler.
- Implementation: Parses multipart form data. Writes uploaded file streams to `workspace/uploads/`. Returns file path, size, and MIME type.

#### `src/app/api/mcp/route.ts` & `src/app/api/mcp/registry/route.ts`
- Type: HTTP Route Handlers.
- Responsibility: Model Context Protocol (MCP) server lifecycle and registry queries.
- Implementation: Reads and updates server definitions in `workspace/system/mcp/servers.json`. Queries extension catalog in `src/lib/market.ts`.

#### `src/app/api/skills/route.ts`
- Type: HTTP Route Handler (GET, POST).
- Responsibility: Skill management.
- Implementation: Reads directory `workspace/system/skills/`. Parses `SKILL.md` frontmatter. Downloads and installs skill folders from GitHub repositories.

#### `src/app/api/python/route.ts`
- Type: HTTP POST Endpoint.
- Responsibility: Server Python process execution.
- Implementation: Spawns Python subprocess in workspace path with execution timeout limit. Returns stdout, stderr, and exit code.

#### `src/app/api/health/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: System liveness verification.
- Implementation: Checks database connection pool responsiveness. Returns HTTP 200 with JSON `{ "ok": true }`.

#### `src/app/api/dev/route.ts`
- Type: HTTP Route Handler.
- Responsibility: Process inspection for development servers.
- Implementation: Communicates with process manager in `src/lib/procs.ts` to list running servers, inspect stdout logs, and terminate processes.

#### `src/app/api/market/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: Extension catalog provider.
- Implementation: Returns list of curated MCP servers and skill repositories from `src/lib/market.ts`.

#### `src/app/files/[...path]/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: Workspace file streaming.
- Implementation: Resolves path within `workspace/`. Checks existence. Streams binary data with MIME headers matching file extension.

#### `src/app/vendor/[...path]/route.ts`
- Type: HTTP GET Endpoint.
- Responsibility: Vendor asset distribution.
- Implementation: Serves assets for KaTeX, Mermaid, Leaflet, 3dmol, Lucide, and Highlight.js directly from `node_modules`.

---

### 3.2 Frontend UI Components (`src/components/`)

#### `src/components/App.tsx`
- Type: React Client Component.
- Responsibility: Client state coordinator.
- Implementation:
  - Manages active conversation ID, message tree branching, and streaming lifecycle.
  - Maintains window collection for Canvas (`AppCtx.windows`).
  - Controls visibility state of side panels (Chats, Workspace, Artifacts, Sources).
  - Coordinates interface dimming timer: triggers class `.is-idle` on top navigation buttons after 2.5 seconds without mouse events.
  - Binds keyboard shortcuts (`Ctrl/Cmd+K`, `Ctrl/Cmd+B`, `Ctrl/Cmd+.`, `Escape`).

#### `src/components/ChatView.tsx`
- Type: React Client Component.
- Responsibility: Conversation feed rendering and scroll management.
- Implementation: Renders message turn sequence from message tree. Controls scroll anchoring to bottom during token streaming. Renders branch selection controls when tree forks exist. Embeds `Composer` at base of column.

#### `src/components/Message.tsx`
- Type: React Client Component.
- Responsibility: Message turn presentation.
- Implementation:
  - User messages: Displays prompt text, quoted snippets, and attachment cards.
  - Assistant messages: Mounts `StreamMarkdown`. Displays reasoning blocks, tool call indicator pills, approval prompt cards, and source attribution rails.

#### `src/components/Composer.tsx`
- Type: React Client Component.
- Responsibility: Input interface and submission controller.
- Implementation: Textarea with height expansion on input. Intercepts keystrokes for slash command triggers (`/compact`, `/fold`, `/clear`) and `@` file reference triggers linked to workspace file tree. Manages file drop zone and file input button. Dispatches send and stop events.

#### `src/components/Canvas.tsx`
- Type: React Client Component.
- Responsibility: Window manager for documents, previews, and UI blocks.
- Implementation:
  - Positions windows in floating mode or docked mode beside chat.
  - Computes window dimensions from target document aspect ratio.
  - Implements edge-peeking logic: dragging past screen boundaries minimizes window to margin bar; hovering reveals preview; dwelling or clicking restores window dimensions.
  - Implements region snip tool for copying image/PDF crops into Composer.

#### `src/components/viewers.tsx`
- Type: React Client Component.
- Responsibility: Document preview renderers.
- Implementation:
  - PDF Viewer: Renders pages via canvas/text layers, handles zoom, page pagination, and text highlight selection with quote export.
  - Spreadsheet Viewer: Renders CSV and XLSX data in grid with sorting and sheet tab switching.
  - Presentation Viewer: Slide deck carousel with presenter notes display.
  - Archive Viewer: Folder tree for inspecting ZIP and TAR archives.

#### `src/components/Block.tsx`
- Type: React Client Component.
- Responsibility: UI iframe container.
- Implementation: Embeds `iframe` with `public/blocks/runtime.html`. Sends widget source and data via `postMessage`. Controls expansion to full screen and promotion to Canvas window.

#### `src/components/Panels.tsx`
- Type: React Client Component.
- Responsibility: Drawer panels.
- Implementation:
  - ChatsPanel: Conversation history list with search filter, branch tags, and deletion buttons.
  - WorkspacePanel: Directory tree, file preview triggers, and token breakdown meter.
  - ArtifactsPanel: List of generated UI blocks and document artifacts.
  - SourcesPanel: Numbered list of web links and files cited in turn.

#### `src/components/Settings.tsx`
- Type: React Client Component.
- Responsibility: User configuration dialog.
- Implementation: Interface with tabs:
  - Model: Base URL, API key, model dropdown with fetch button, context limit sliders.
  - Access: Checkboxes for host shell, home directory, root filesystem, and sudo permissions.
  - Tools: Firecrawl URL, Cloud Firecrawl API key, and search provider settings.
  - MCP & Skills: Controls to enable/disable servers and browse market extensions.

#### `src/components/Extensions.tsx`
- Type: React Client Component.
- Responsibility: Extension marketplace interface.
- Implementation: Fetches catalog from `/api/market`. Displays cards for MCP servers and skills. Handles install button actions by posting configurations to `/api/mcp` and `/api/skills`.

#### `src/components/ctx.ts`
- Type: TypeScript Module.
- Responsibility: Context definitions and shared UI types.
- Implementation: Exports `AppCtx` React context. Defines interfaces: `Conv`, `Msg`, `Part`, `Attachment`, `Quote`, `Win`, `TreeNode`.

---

### 3.3 Engine, Harness & Backend Libraries (`src/lib/`)

#### `src/lib/agent.ts`
- Type: TypeScript Module.
- Responsibility: Agent execution engine and loop controller.
- Implementation: Assembles system prompt from markdown files, memory state, skills, and file trees. Manages tool call cycles (limit: 10 turns). Handles streaming HTTP chunks from LLM API. Parses reasoning tokens and tool arguments. Enforces token context limits.

#### `src/lib/tools/index.ts`
- Type: TypeScript Module.
- Responsibility: Tool registry and execution router.
- Implementation: Declares schemas for `CORE_TOOLS` (file CRUD, bash, python, web search, web fetch, web extract, ui_search), `DEV_TOOLS` (process supervision, test runner, browser automation), and `HOST_TOOLS` (host shell execution). Function `execTool(name, args)` evaluates tool name via switch statement and invokes corresponding library function.

#### `src/lib/tools/edit.ts`
- Type: TypeScript Module.
- Responsibility: Filesystem string replacement engine (`fs_edit`).
- Implementation: Matches exact target string within file contents. Normalizes line endings (`
` vs `
`) and whitespace variations to prevent match failures. Checks uniqueness of target substring to avoid edit collisions.

#### `src/lib/tools/syntax.ts`
- Type: TypeScript Module.
- Responsibility: Pre-write syntax validation guard.
- Implementation: Parses file content using parsers by file extension (Babel/TypeScript parser for JS/TS, JSON.parse for JSON, Python compiler check for Python) prior to disk write. Rejects syntax-invalid edits with line-numbered error reports.

#### `src/lib/exec.ts`
- Type: TypeScript Module.
- Responsibility: Process spawning and containment.
- Implementation: Spawns processes via Node.js `child_process.spawn`. Enforces execution timeouts and output buffer size limits. Wraps commands in Bubblewrap (`bwrap`) command strings when Linux sandboxing is enabled.

#### `src/lib/web.ts`
- Type: TypeScript Module.
- Responsibility: Web retrieval router.
- Implementation:
  - `firecrawlScrape()`: Sends scrape request to Firecrawl instance (`http://localhost:3002/v1/scrape`). Checks response for bot challenge signatures (`isAntiBotProtected()`). Falls back to Cloud Firecrawl API on failure or bot detection.
  - `firecrawlSearch()`: Executes search query against SearXNG instance with 3000ms timeout. Falls back to Cloud Firecrawl Search on empty response or timeout.
  - `firecrawlExtract()`: Calls Cloud Firecrawl AI extraction endpoint for schema generation.

#### `src/lib/browser.ts`
- Type: TypeScript Module.
- Responsibility: Browser automation via Puppeteer.
- Implementation: Controls Chromium instance via Puppeteer. Navigates to target URLs, awaits network idle state, captures full-page PNG screenshots, executes DOM clicks, and extracts rendered HTML text.

#### `src/lib/harness/guard.ts`
- Type: TypeScript Module.
- Responsibility: Tool call schema verification.
- Implementation: Validates incoming tool call names against registered tool definitions. Validates JSON argument structures against expected schemas. Intercepts and parses raw text tool call syntax generated by models lacking function calling API support.

#### `src/lib/harness/shell-preflight.ts`
- Type: TypeScript Module.
- Responsibility: Shell command security analysis.
- Implementation: Runs regex scans across command strings to detect infinite loops (`while true; do`, `for ((;;))` ), process forks (`:(){ :|:& };:`), terminal freeze vectors, and file deletion operations lacking user confirmation.

#### `src/lib/harness/stuck.ts`
- Type: TypeScript Module.
- Responsibility: Execution loop and repetition detection.
- Implementation: Maintains sliding window of recent tool names, arguments, and error outputs. Computes hashes of tool call signatures. Aborts agent execution loop when repeated error states exceed threshold count.

#### `src/lib/harness/slop.ts`
- Type: TypeScript Module.
- Responsibility: Output code quality verification.
- Implementation: Scans modified file buffers for placeholder patterns (`// TODO: implement`, `/* ... */`, `pass  # finish later`). Emits warnings to agent when incomplete code segments are detected.

#### `src/lib/harness/integrity.ts`
- Type: TypeScript Module.
- Responsibility: Citation and path reference validation.
- Implementation: Validates markdown links in agent responses. Verifies that workspace file links point to existing files on disk and web URLs match retrieved search citations.

#### `src/lib/harness/stream.ts`
- Type: TypeScript Module.
- Responsibility: Streaming buffer and SSE parsing.
- Implementation: Reads raw byte stream from LLM endpoint. Splits stream into Server-Sent Events lines. Employs JSON repair techniques to recover malformed or split JSON chunks.

#### `src/lib/harness/check.ts`
- Type: TypeScript Module.
- Responsibility: Test execution runner.
- Implementation: Spawns test suite runners (`npm test`, `pytest`, `cargo test`) within workspace. Captures standard output and formats test failures into diagnostic reports for agent correction loops.

#### `src/lib/memory.ts`
- Type: TypeScript Module.
- Responsibility: Episodic memory storage.
- Implementation: Reads and updates user profile facts in `workspace/system/memory/profile.md`. Appends interaction summaries and outcomes as JSON lines in `workspace/system/memory/episodes.jsonl`.

#### `src/lib/projects.ts` & `src/lib/runs.ts`
- Type: TypeScript Module.
- Responsibility: Multi-turn goal and project management.
- Implementation: Manages project task lists (`todo`, `doing`, `done`) and stores milestone run logs in `workspace/system/projects/`.

#### `src/lib/search-fast.ts`
- Type: TypeScript Module.
- Responsibility: Indexed full-text search engine.
- Implementation: Builds in-memory index of message text and workspace markdown documents. Executes keyword searches with sub-millisecond query latency.

#### `src/lib/settings.ts`
- Type: TypeScript Module.
- Responsibility: Settings definition and secret redaction.
- Implementation: Declares TypeScript interface `Settings`. Sets default values. Merges database settings with `.env` overrides. Replaces secret keys with masked tokens before sending data to client components.

#### `src/lib/skills.ts`
- Type: TypeScript Module.
- Responsibility: Skill loader with tiered instruction files.
- Implementation: Scans directories under `workspace/system/skills/`. Parses YAML frontmatter in `SKILL.md` files. Exposes skill index in system prompt. Supplies full skill instruction content when agent executes `skill_open`.

#### `src/lib/mcp.ts`
- Type: TypeScript Module.
- Responsibility: Model Context Protocol client implementation.
- Implementation: Spawns stdio MCP server processes or connects to SSE endpoints. Negotiates protocol initialization, discovers tool definitions, and registers tools into `src/lib/tools/index.ts`.

#### `src/lib/tikz.ts`
- Type: TypeScript Module.
- Responsibility: TikZ LaTeX renderer wrapper.
- Implementation: Passes LaTeX TikZ diagram code to `node-tikzjax` library and outputs compiled SVG XML strings.

#### `src/lib/workspace.ts`
- Type: TypeScript Module.
- Responsibility: Filesystem path isolation and tree builder.
- Implementation: Defines base path `WS = path.resolve(process.cwd(), "workspace")`. Implements `resolvePath(targetPath)` which throws security exceptions on path traversal attempts outside allowed boundaries. Builds directory JSON trees for UI.

#### `src/lib/streammark/StreamMarkdown.tsx`
- Type: React Client Component.
- Responsibility: Streaming markdown renderer.
- Implementation: Renders Markdown tokens during stream. Uses `remend.ts` to repair unclosed tokens mid-stream. Replaces `<ui>` and `<canvas>` code blocks with mounted `Block.tsx` instances. Wraps tables in containers with x-axis scroll.

#### `src/lib/streammark/remend.ts`
- Type: TypeScript Module.
- Responsibility: Streaming Markdown token repair.
- Implementation: Scans incomplete markdown strings for open syntax delimiters (unclosed backticks, asterisks, brackets, HTML tags) and appends matching closing tokens to preserve valid document structure during streaming.

#### `src/lib/streammark/useSmoothText.ts`
- Type: React Hook.
- Responsibility: Stream text interpolation.
- Implementation: Buffers streaming text chunks and interpolates character display using `requestAnimationFrame`, eliminating stepping during variable-rate LLM streaming.

#### `src/lib/context.ts`
- Type: TypeScript Module.
- Responsibility: Token accounting and context compaction engine.
- Implementation: Assembles message parent chains from leaf nodes. Implements compaction strategies: replaces verbose tool outputs with single-line summaries, condenses web search results to key facts, and summarizes conversation segments via LLM calls.

#### `src/lib/credentials.ts`
- Type: TypeScript Module.
- Responsibility: Credential resolution for MCP and skills.
- Implementation: Resolves API credentials with precedence: Settings database -> Process environment -> Host CLI authentication tokens (`gh auth token`, `glab auth status`, `~/.cache/huggingface/token`). Only accesses host tokens when host access is authorized.

#### `src/lib/market.ts`
- Type: TypeScript Module.
- Responsibility: Extension catalog.
- Implementation: Exports catalog of MCP servers (GitHub, Context7, Hugging Face, Postgres, Puppeteer) and skill repositories with configuration schemas and required environment variables.

#### `src/lib/procs.ts`
- Type: TypeScript Module.
- Responsibility: Background process supervision.
- Implementation: Tracks background child processes (development servers, file watchers). Captures ring buffer of standard output (up to 200,000 characters). Scans output for listening port numbers. Manages process tree termination via SIGTERM/SIGKILL.

#### `src/lib/llm.ts`
- Type: TypeScript Module.
- Responsibility: LLM communication and token calculation utilities.
- Implementation: Computes token estimates (~3.6 characters per token). Formats HTTP headers and authorization headers. Implements non-streaming `complete()` function for compaction summaries. Normalizes message arrays by merging same-role messages in sequence.

#### `src/lib/phone.ts`
- Type: TypeScript Module.
- Responsibility: Android Debug Bridge (ADB) device automation.
- Implementation: Verifies phone testing toggle state in settings. Spawns `adb` commands to capture device screenshots (`adb exec-out screencap -p`), dispatch tap coordinates, input text, and inspect UI hierarchies.

#### `src/lib/shared.ts`
- Type: TypeScript Module.
- Responsibility: Shared utility functions.
- Implementation: Provides `canvasSlug()` for string sanitization, `canvasPath()` for artifact path resolution (`.ui` for blocks, `.md` for documents), and YouTube video ID regex extraction.

#### `src/lib/ui-check.ts`
- Type: TypeScript Module.
- Responsibility: UI markup validation engine.
- Implementation: Scans `<ui>` markup against component catalog in `src/lib/blocks/catalog.ts`. Reports unknown tags, unclosed containers, and malformed attributes before widget render.

#### `src/lib/blocks/catalog.ts`
- Type: TypeScript Module.
- Responsibility: Component catalog for UI generation.
- Implementation: Declares metadata and syntax examples for ~60 custom elements: layout containers (`<x-stack>`, `<x-card>`, `<x-grid>`), visualization tags (`<x-chart>`, `<x-graph>`, `<x-map>`), domain tags (`<x-smiles>`, `<x-3dmol>`), and input components.

---

### 3.4 Database Layer (`src/db/`)

#### `src/db/index.ts`
- Type: TypeScript Module.
- Responsibility: Database connection pool and client initialization.
- Implementation: Checks `DATABASE_URL` environment variable. If present, initializes PostgreSQL connection pool using `pg.Pool` and wraps with Drizzle ORM. If absent, imports `@electric-sql/pglite` and initializes file-backed database in directory `.pglite/`.

#### `src/db/schema.ts`
- Type: TypeScript Module.
- Responsibility: Database schema definitions.
- Implementation: Declares Drizzle ORM tables `conversations`, `messages`, and `settings` with column data types, indices, and foreign key relations.

---

### 3.5 Generative UI Blocks Runtime (`public/blocks/`)

#### `public/blocks/runtime.js`
- Type: JavaScript Client Script.
- Responsibility: In-iframe widget execution environment.
- Implementation: Implements state store with subscriptions. Binds DOM inputs (`value={{var}}`, `@input="var = $value"`). Instantiates Pyodide WebAssembly engine. Bridges variables between Python scripts and JavaScript runtime. Exchanges state updates with parent window via `postMessage`.

#### `public/blocks/elements.js`
- Type: JavaScript Client Script.
- Responsibility: Custom Element class definitions (~60 components).
- Implementation: Registers HTML custom elements with browser `customElements.define()`. Encapsulates Chart.js for `<x-chart>`, Leaflet for `<x-map>`, SmilesDrawer for `<x-smiles>`, 3Dmol.js for `<x-3dmol>`, KaTeX for `<x-math>`, and Panzoom for `<x-graph>`.

#### `public/blocks/runtime.css`
- Type: Stylesheet.
- Responsibility: Widget styling inside iframe.
- Implementation: Resets CSS margins and paddings. Establishes typography system. Synchronizes background, foreground, border, and accent colors with parent application theme variables.

---

### 3.6 Automation Scripts & System Services (`scripts/`, `setup.sh`)

#### `scripts/minimalist-chat`
- Type: Bash Shell Script.
- Location: Installed to `~/.local/bin/minimalist-chat`.
- Responsibility: CLI control script.
- Implementation: Implements subcommands:
  - `open`: Checks service health at `http://localhost:3000/api/health`, waits for HTTP 200, launches Zen Browser pointing to URL.
  - `start`: Runs `systemctl --user start minimalist-chat`.
  - `stop`: Runs `systemctl --user stop minimalist-chat`.
  - `restart`: Runs `systemctl --user restart minimalist-chat`.
  - `status`: Runs `systemctl --user status minimalist-chat`.
  - `logs`: Runs `journalctl --user -u minimalist-chat -f`.

#### `scripts/minimalist-chat.service`
- Type: Systemd User Unit File.
- Location: Installed to `~/.config/systemd/user/minimalist-chat.service`.
- Responsibility: Service supervision.
- Implementation: Configures `ExecStartPre` running Docker Compose to bring PostgreSQL container online. Configures `ExecStart` running `npm start` with `PORT=3000` and `NODE_ENV=production`. Configures `Restart=always`.

#### `scripts/minimalist-chat.desktop`
- Type: FreeDesktop Desktop Entry File.
- Location: Installed to `~/.local/share/applications/minimalist-chat.desktop`.
- Responsibility: Desktop environment application integration.
- Implementation: Registers application in desktop application launcher. Associates icon `scripts/minimalist-chat.svg`. Configures desktop actions for Open, Start, Stop, and Restart.

#### `scripts/minimalist-chat.svg`
- Type: SVG Vector Graphic.
- Responsibility: Application icon.
- Implementation: Vector path drawing icon for desktop launcher and window manager docks.

#### `setup.sh`
- Type: Bash Shell Script.
- Responsibility: Installation and provisioning automation.
- Implementation: Verifies presence of Node.js, npm, Docker, Python 3, and Zen Browser. Configures Python venv. Copies `.env.example` to `.env` if missing. Runs `docker compose up -d db`. Runs `npx drizzle-kit push`. Builds Next.js application bundle. Symlinks CLI script and installs systemd user service.

---

### 3.7 Configuration Files

#### `package.json`
- Type: Node.js Package Manifest.
- Responsibility: Dependency declarations and project scripts.
- Implementation: Declares dependencies: Next.js 16, React 19, Tailwind CSS v4, Drizzle ORM, `pg`, `@electric-sql/pglite`, `lucide-react`, `katex`, `leaflet`, `3dmol`, `mammoth`, `unpdf`, `puppeteer`. Defines npm scripts: `dev`, `build`, `start`, `typecheck`.

#### `next.config.ts`
- Type: Next.js Configuration.
- Responsibility: Framework runtime configuration.
- Implementation: Configures Turbopack settings, allowed asset directories, and package resolution.

#### `tsconfig.json`
- Type: TypeScript Configuration.
- Responsibility: Compiler options and path aliases.
- Implementation: Enables `strict: true` typechecking, `moduleResolution: "bundler"`, and path alias `"@/*": ["./src/*"]`.

#### `drizzle.config.json`
- Type: Drizzle ORM Configuration.
- Responsibility: Database migration options.
- Implementation: Points `schema` to `src/db/schema.ts`, sets `dialect: "postgresql"`, and reads `DATABASE_URL`.

#### `docker-compose.yml`
- Type: Docker Compose Specification.
- Responsibility: Database container definition.
- Implementation: Configures service `db` using image `postgres:16-alpine`. Maps container port 5432 to host port 5432. Binds volume `pgdata` to `/var/lib/postgresql/data`.

#### `.env.example`
- Type: Environment Template.
- Responsibility: Configuration parameter documentation.
- Implementation: Lists environment variables: `DATABASE_URL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MODEL`, `FIRECRAWL_URL`, `FIRECRAWL_KEY`, `PORT`.

#### `DESIGN.md`
- Type: Design Documentation.
- Responsibility: UI design and interaction rules.
- Implementation: Details color token contrast ratios, typography rules, layout constraints, and animation curve parameters.

---

### 3.8 Workspace Templates & Prompts (`workspace-template/`)

#### `workspace-template/system/SYSTEM.md`
- Type: Markdown Prompt Document.
- Responsibility: System instructions for agent.
- Implementation: Defines guidelines for tool usage, reasoning separation, filesystem boundaries, code formatting, and generative UI `<ui>` tag production.

#### `workspace-template/system/memory/`
- `profile.md`: Markdown file storing user facts and preferences.
- `episodes.jsonl`: JSON Lines file storing timeline summaries of past turns and goals.

#### `workspace-template/system/skills/`
- Directory of skill folders containing `SKILL.md` instruction files:
  - `build/`: Compiling and packaging software projects across targets.
  - `design/`: Layout rules, color selection, and typography standards.
  - `debug/`: Step-by-step diagnostic workflows.
  - `blocks/`: Instructions and examples for authoring Blocks v2 widgets.
  - `canvas/`: Document and presentation artifact authoring guidelines.
  - `memory/`: Directives on updating profile and episode records.
  - `android/`: Directives for driving Android devices via ADB.
  - `mcp/`: Directives for interacting with Model Context Protocol servers.

#### `workspace-template/system/mcp/servers.json`
- Type: JSON Configuration File.
- Responsibility: Registered MCP server definitions.
- Implementation: Array of objects declaring MCP server commands, arguments, URLs, and environment variable requirements.

---

## 4. DEVELOPER MODIFICATION RUNBOOK

### Adding a Tool
1. Register tool schema in `src/lib/tools/index.ts` within `CORE_TOOLS`, `DEV_TOOLS`, or `HOST_TOOLS` via `T(name, description, props, required)`.
2. Implement execution branch in `switch (name)` inside `execTool()` in `src/lib/tools/index.ts`.
3. If tool edits files, route writes through `src/lib/tools/edit.ts` and validate syntax via `src/lib/tools/syntax.ts`.
4. Run validation: `npm run typecheck && npm run build`.
5. Restart service: `systemctl --user restart minimalist-chat`.

### Adding an API Route
1. Create directory `src/app/api/<route_name>/` and file `route.ts`.
2. Add export: `export const dynamic = "force-dynamic";`.
3. Implement HTTP verb functions: `export async function GET(req: Request) { ... }`, `export async function POST(req: Request) { ... }`.
4. Query database via `import { db } from "@/db"`.
5. Return responses using `Response.json(payload)` or `new Response(stream)`.

### Modifying the Database Schema
1. Edit table definitions in `src/db/schema.ts`.
2. Push schema changes to database: `npx drizzle-kit push`.
3. Update corresponding TypeScript interfaces in `src/components/ctx.ts`.

### Modifying UI Layout & Styles
1. Column widths and screen breakpoints: edit `.column` rules in `src/app/globals.css`.
2. Window management and peek docking: edit event handlers in `src/components/Canvas.tsx`.
3. Interface dimming: adjust timer in `src/components/App.tsx` and `.chrome.is-idle` in `src/app/globals.css`.

### Verification Commands
```bash
npm run typecheck                        # Validate TypeScript types
npm run build                            # Compile Next.js production build
systemctl --user restart minimalist-chat # Restart background daemon
curl -s http://localhost:3000/api/health # Verify service status
```
