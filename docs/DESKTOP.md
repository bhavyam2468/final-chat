# Desktop

The workspace is a local server. The desktop layer is everything that makes it feel *installed*
rather than browsed: a summon window, a global hotkey, notifications, and a CLI that asks the same
questions the UI asks.

One rule shapes all of it: **the desktop never drives the app's UI.** There is no screen scraping
and no synthetic clicking — every piece here calls the app's own HTTP endpoints (`/api/chat`,
`/api/os`). That is why the same code works from a terminal, from a hotkey, from a phone's home
screen, and over ssh; and why changing the interface never breaks the desktop.

## The pieces

| piece | what it is | lives in |
| --- | --- | --- |
| `minimalist-chat` | launcher: `open`, `summon`, `ask`, `hotkey`, `desktop`, plus service control | `scripts/minimalist-chat` → `~/.local/bin` |
| `desktop.mjs` | the desktop verbs. Talks to the API and prints; no app internals | `scripts/desktop.mjs` |
| `/summon` | the page the window shows: one question, one streamed answer, Esc | `src/app/summon/` |
| `/api/os` | `notify` · `open` · `clipboard` · `summon`, plus what this machine can do | `src/app/api/os/route.ts` |
| `os_notify` | the model's own way to put a notification in front of you | tool in `src/lib/tools/index.ts` |
| app-menu entry | "Minimalist AI Workspace", with an *Ask the assistant* action | `scripts/minimalist-chat.desktop` |

The bridge is argv-only (never a shell string) and runs outside the sandbox on purpose: it exists
to talk to your session. `HOST_ACCESS=off` — the operator switch used for hosted/container
installs — turns all of it off, because a container has no one to notify.

## Linux

`./setup.sh` installs the service, the launcher and the app-menu entry. Then:

```bash
minimalist-chat desktop          # what this machine can do (session, notify, browser, hotkey)
minimalist-chat summon           # focus the summon window, or open one
minimalist-chat ask "…"          # one question from a terminal; --notify, --open
minimalist-chat hotkey           # the snippet for this desktop
minimalist-chat hotkey --write   # write it (niri / Hyprland / sway; the file is backed up first)
```

**The hotkey.** Nothing binds a global hotkey behind your desktop's back; the desktop environment
does it, and `hotkey` tells you exactly what to add. On Niri that is one line in
`~/.config/niri/config.kdl`:

```kdl
binds {
    Mod+Shift+Space { spawn "minimalist-chat" "summon"; }
}
```

`hotkey --write` inserts that into the existing `binds` block (backup: `config.kdl.bak-…`) and
refuses when the file already mentions the launcher. Hyprland and sway get their own line; GNOME
gets the four `gsettings` commands; KDE and everything else get the two-line manual recipe.

**The window.** `summon` first tries to *focus* a window that is already open — via `niri msg`,
`hyprctl`, `wmctrl` or `xdotool`, whichever this session has. Otherwise it opens a Chrome/Chromium
`--app` window (`--class=minimalist-chat`, 620×320): a real window with no tabs and no URL bar,
titled *Ask · Workspace*. Brave, Edge and Vivaldi are accepted too; with no Chromium browser at all
it falls back to a tab in your default browser. The window's title is what focus matching looks for,
so if you rename it in your compositor rules, summon stops finding it.

**Notifications** need `notify-send` (`libnotify-bin` on Debian/Ubuntu, `libnotify` on Arch). The
clipboard uses `wl-copy` under Wayland and `xclip`/`xsel` under X11; opening files uses `xdg-open`.

**Inside the session.** The quiet way in is `⌘/Ctrl-K` → `summon`. Everything the window asks is an
ordinary conversation (born in the quiet `general` mode, titled after your question), so a summon
that turns into real work is already in the Chats panel — the window links to it with
`/?chat=<id>`, which the app understands.

## Windows (next)

The layer is already platform-aware: `notifyArgv` builds a PowerShell toast, the clipboard uses
`clip`, opening uses `cmd /c start`, and `scripts/desktop.mjs` is plain Node. What is missing is
packaging rather than code — a Start-menu shortcut that runs `minimalist-chat summon`, a service
entry (`nssm` or a scheduled task at logon), and a global-hotkey helper (AutoHotkey, or the packaged
shell that replaces the Chrome app window). The intended shape is one installer that reuses this
same launcher and asks the same `/api/os` what to do; nothing in the app assumes Linux.

## Android (after Windows)

`/summon` is a web page, so the phone path needs no app: open `http://<machine>:3000/summon` in the
phone's browser and *Add to home screen* — you get an invokable assistant that talks to the backend
API, never to the screen. For that, the server has to listen on the network: `./setup.sh --online`
binds `0.0.0.0` with `HOST_ACCESS=off` (host files, the host terminal and this bridge stay off,
deliberately — a network-reachable host terminal is not a feature). Asking works; the desktop verbs
correctly refuse. (The separate *phone testing* switch in Settings → Access is the other direction:
driving a USB-connected Android device with adb.)

## The API, if you are writing the shell yourself

```bash
GET  /api/os                                   # capabilities + the plan the CLI follows
POST /api/os {action:"notify", title, body, urgency:"low|normal|critical"}
POST /api/os {action:"open", path}             # path or URL, opened in its real app
POST /api/os {action:"clipboard", text}
POST /api/os {action:"summon"}                 # → {ok, how:"focused"|"launched"|"opened"}
```

An unsupported action answers `200 {ok:false, error}` — a caller prints the reason instead of
guessing. `GET /api/os` is what `scripts/desktop.mjs` follows, so the CLI never hard-codes a machine.

## Troubleshooting

- **No notifications** — install `notify-send`; `minimalist-chat desktop` shows what was found. In a
  container the bridge is off by design.
- **`summon` opens a tab** — no Chrome/Chromium-family browser on PATH. Any of Chrome, Chromium,
  Brave, Edge or Vivaldi gives the real window.
- **The hotkey does nothing** — `minimalist-chat hotkey` prints the exact snippet; on Niri check
  `niri validate`, on Hyprland `hyprctl configerrors`.
- **`summon` does not focus the open window** — the compositor tools (`niri`, `hyprctl`, `wmctrl`,
  `xdotool`) are what focus it; without one, a second window opens instead.
- **`ask` says the workspace is not answering** — `minimalist-chat start`, and `minimalist-chat logs`.
