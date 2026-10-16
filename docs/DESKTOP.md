# Desktop Architecture

Minimalist AI Workspace is a desktop application. There is no service to install, no Docker, no
port to remember and nothing listening on the network: a small Rust shell starts everything the app
needs on loopback ports and puts the interface in a native window.

This document is the map: what starts what, where data lives, how to build and package it, and what
to do when something does not come up. The reasoning behind individual decisions lives in the code,
in comments next to the thing they explain.

---

## 1. What runs

```
minimalist-ai  (Rust, Tauri 2)
│
├── splash window          shown immediately: "Starting search… / Starting the app server…"
├── main window            webkit2gtk webview pointed at http://127.0.0.1:<port>, opened when
│                          the app server reports healthy (GET /api/health → {"ok":true,…})
│
├── SearXNG                resources/searxng/src via resources/searxng/venv/bin/python
│   └── granian            `python -m granian --interface wsgi searx.webapp:app` on a free port
│
├── app server             resources/runtime/bin/node resources/appserver/server.js
│   ├── Next.js 16         the whole application: UI, routes, agent, tools
│   ├── PGlite             the database, inside the data directory
│   └── child processes    terminals, dev servers, python — one process group, stopped as a tree
│
└── tray icon              Open window · Restart app server · Open data folder · Open logs ·
                           Start at login · Quit
```

The window talks to the app server over plain HTTP on `127.0.0.1`, exactly as a browser would. The
app has **no Tauri IPC surface**: `capabilities/default.json` grants only `core:default`, to the
splash window, and the real UI cannot call into Rust. That keeps the desktop build honest — the
same code runs unchanged in a browser during development (`npm run dev`).

**Startup order** (all of it in `src-tauri/src/shell.rs`):

1. `Layout::resolve()` — work out the writable data directory, create `workspace/`, `data/pglite/`,
   `searxng/`, `logs/`, and seed `config.env`.
2. Single instance check — a loopback port is held for the process's lifetime. A second launch finds
   the running instance through `runtime.json` and opens it in the browser instead of starting a
   second copy.
3. SearXNG on a free port, waiting for a JSON answer. **Not fatal**: if it fails, the app starts
   anyway and `web_search` falls back to its keyless adapters.
4. The app server on another free port, with the search port passed in as `SEARXNG_URL`, waiting for
   `/api/health` to answer `{"ok":true}`.
5. `runtime.json` is written (port, pid) and the main window opens on that URL; the splash closes.
6. In the background: a watchdog thread checks both services every two seconds. A dead app server is
   restarted on the same port when it is still free (the window reloads onto it); a dead SearXNG is
   restarted with backoff. Restarts are logged, never silent.
   An app server that exits *on purpose* says so first, in `runtime.json`: `restart: true` means
   "replace me, don't count this as a crash" and `quit: true` means "end the app" — that is what
   `POST /api/desktop {action:"restart"}` and the `stop` used on shutdown write, and the shell
   clears each flag as it acts on it. Without them a deliberate exit would look like a crash and
   the watchdog would start the server straight back up.
7. After the window is up, `python -m venv` + `pip install -r python-requirements.txt` runs in the
   background to provision `<data>/venv` for `run_python` and office previews. It never delays the
   window, and quitting during the install takes pip down with it.

**Shutdown** is ordered and bounded, from any of: the tray's Quit, `minimalist-ai-ctl stop`,
`POST /api/desktop {action:"stop"}` (which the shell turns into a quit via the `quit: true` note),
closing the last window when no tray exists, or a signal. The shell asks the server to stop (which
closes child processes and PGlite first), waits, then escalates within the same process group.

---

## 2. Data & configuration

Everything the app writes lives in one directory:

| Platform | Location |
|---|---|
| Linux | `~/.local/share/dev.bhavyam.minimalist-ai` (`$XDG_DATA_HOME` respected) |
| macOS | `~/Library/Application Support/dev.bhavyam.minimalist-ai` |
| Windows | `%APPDATA%\dev.bhavyam.minimalist-ai` |

```
workspace/        the agent's working directory — yours to open, edit and back up
data/pglite/      the conversation database (embedded Postgres)
logs/desktop.log  the shell log: startup steps, child process output, restarts, tray actions
searxng/          SearXNG's settings.yml (generated) and its cache
venv/             python environment for run_python, pip and office previews
config.env        your configuration (see below)
runtime.json      the live port and pid — how scripts find the running app
```

`config.env` is seeded on first run with a commented template and **never overwritten**. It is
`KEY=value`, read by the shell at startup and handed to the app server; real environment variables
and the app's own paths (ports, data directories) take precedence over it. Use it for a fixed
model, a real PostgreSQL, your own SearXNG, `PYTHON_BIN`, access defaults, or `DEV_MODE=1`. The file
is the same one Settings writes to where a setting can be expressed that way (`APP_DATA_DIR`,
`WORKSPACE_DIR`, …).

`APP_MODE=desktop` is what tells the app it is inside the shell: on the Node side, `src/lib/paths.ts`
is the only module that reads those variables, and it deliberately uses no `fs` — the shell parses
`config.env` and the app receives plain paths. The contract is enforced by
`dev/tests/desktop.test.ts`, which fails if the Rust side stops setting a variable the Node side
reads (or vice versa).

---

## 3. Building

```bash
npm install                     # app dependencies
npm run desktop:prepare         # Next build + bundle assembly into src-tauri/resources
cd src-tauri && cargo build --release
```

`desktop:prepare` is the half of the build that has nothing to do with Rust:

- builds the Next.js app (`next build`) and copies its standalone server into
  `resources/appserver/`, dropping the traced extras that would otherwise double the size;
- stages a Node runtime in `resources/runtime/` (pinned in `scripts/desktop/versions.json`;
  downloads it from the `actions/node-versions` mirror, falling back to the system `node` and
  stripping it);
- provisions `resources/searxng/` with a pinned SearXNG checkout and its own python environment
  (`scripts/desktop/provision-searxng.mjs`, `--force` to rebuild, `--check` to verify);
- copies the workspace template and `requirements.txt`, and writes `BUILD-INFO.json` (version, git
  commit, pins, build time) which the shell reports in `/api/health` and the About surface.

Useful flags: `--skip-build` (reuse `.next`), `--only=appserver|runtime|searxng`, `--no-searxng`.

Packaging:

```bash
npm run desktop:build            # AppImage + .deb + .rpm into src-tauri/target/release/bundle
npm run desktop:appimage         # just the AppImage
```

Packages declare their Linux dependencies (webkit2gtk-4.1, gtk3, libayatana-appindicator for the
tray). The AppImage is self-contained; on Arch the `libayatana-appindicator` package is optional and
only removes the tray icon.

**Windows and macOS** are not built yet, and nothing in the design prevents them: bundle targets,
icon formats (`.ico`, `.icns`) and platform paths are already handled, and the two platform-specific
pieces are the process-group signalling in `src-tauri/src/child.rs` (Windows falls back to
`taskkill /T`) and the autostart entry in `src-tauri/src/autostart.rs` (a `.desktop` file today).

---

## 4. Verifying

```bash
npm run desktop:smoke     # starts the assembled bundle exactly as the shell does
```

The smoke test needs no window: it starts `resources/runtime/bin/node resources/appserver/server.js`
with the environment the shell builds, in a temporary data directory, and checks the things a user
would notice — the UI document, the Blocks runtime, the `/vendor` library route with its traversal
guard, settings round-tripping through PGlite, one complete agent turn against the bundled mock
model, a terminal session, the bundled SearXNG answering the JSON API, and the graceful stop
(including that the process exits on its own and the database is still readable afterwards). It is
the same code path the packaged app takes, so a green run means the bundle is sound.

`npm run desktop:check` runs that plus the unit suites, typecheck, lint and the Next build.

---

## 5. When something does not start

**The window is blank or the splash says "Could not start".** Read the log: `minimalist-ai-ctl logs`
or `<data>/logs/desktop.log`. It always says which step failed and why (a missing bundle, a port
that could not be bound, a health check that timed out with the reason).

**"the app server is not part of this build"** — you built the shell without assembling the bundle:
run `npm run desktop:prepare`, then rebuild.

**SearXNG does not come up.** Search is not fatal by design; the log names the reason. The common
ones: no `python3` on the machine (the bundled venv is used first, so this is rare), or the venv was
copied to a machine without a compatible libc (rebuild with `npm run desktop:searxng -- --force`). If
you prefer your own SearXNG, set `SEARXNG_URL` in `config.env`.

**No tray icon.** The tray needs libayatana-appindicator. Without it the app logs a warning and
closing the window quits instead of hiding — never an invisible process.

**The port changes between launches.** That is by design: ports are chosen at launch to avoid
conflicts. Scripts should read `runtime.json`, as `minimalist-ai-ctl` and `chatsync.mjs` do.

**python tools are unavailable.** Look for "python environment" lines in the log. `python3-venv` may
be missing, or the download failed on a machine without network access to PyPI. Set `PYTHON_BIN` in
`config.env` to an interpreter that already has the packages from `requirements.txt`.
