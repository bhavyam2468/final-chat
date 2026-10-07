#!/usr/bin/env bash
# One-line setup:  curl -fsSL https://raw.githubusercontent.com/bhavyam2468/final-chat/main/setup.sh | bash
#            or:  ./setup.sh [--local|--online] [--yes] [--update] [--no-service] [--with-firecrawl] [--port N]
# The interactive path asks before installing Docker; Firecrawl is never started unless explicitly requested.
# Detects the environment and local services, writes missing .env keys (never overwrites), installs
# dependencies, builds, and on a desktop installs a user service + launcher. Safe to re-run.
set -euo pipefail

REPO="https://github.com/bhavyam2468/final-chat.git"
ORIG_ARGS=("$@")
MODE=""; YES=0; UPDATE=0; SERVICE=1; FIRECRAWL=0; PORT="${PORT:-3000}"
while [ $# -gt 0 ]; do
  case "$1" in
    --local) MODE=local ;; --online) MODE=online ;; --yes|-y) YES=1 ;; --update) UPDATE=1 ;; --no-service) SERVICE=0 ;;
    --with-firecrawl) FIRECRAWL=1 ;; --port) PORT="$2"; shift ;;
    -h|--help) sed -n 2,5p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac; shift
done

b() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no() { printf '  \033[2m·\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }
tty_ok() { [ $YES -eq 0 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; }
ask() { # ask "question" default → echo answer
  local a=""; if tty_ok; then printf '%s ' "$1" >/dev/tty; read -r a </dev/tty || true; fi; echo "${a:-$2}"; }
secret() { local a=""; if tty_ok; then printf '%s ' "$1" >/dev/tty; stty -echo </dev/tty 2>/dev/null || true; read -r a </dev/tty || true; stty echo </dev/tty 2>/dev/null || true; printf '\n' >/dev/tty; fi; echo "$a"; }
http_ok() { curl -fsS -m 3 -o /dev/null "$@" 2>/dev/null; }

# ── 0. get the code (when piped from curl) ────────────────────────────────
SRC="${BASH_SOURCE[0]:-}"
if [ -z "$SRC" ] || [ ! -f "$(dirname "$SRC")/package.json" ]; then
  DIR="${CHAT_DIR:-$HOME/minimalist-chat}"
  has git || die "git is required"
  if [ -d "$DIR/.git" ]; then b "Updating $DIR"; git -C "$DIR" pull --ff-only; else b "Cloning into $DIR"; git clone --depth 1 "$REPO" "$DIR"; fi
  exec bash "$DIR/setup.sh" "${ORIG_ARGS[@]}"
fi
cd "$(dirname "$SRC")"; APP="$(pwd)"
if [ "$UPDATE" -eq 1 ]; then
  if [ -n "$(git status --porcelain --untracked-files=all)" ]; then die "update needs a clean checkout; commit or stash source changes first (your .env/workspace are ignored)"; fi
  b "Updating source"; git pull --ff-only; ok "source is current"
fi

# ── 1. environment ────────────────────────────────────────────────────────
OS="$(uname -s)"; ARCH="$(uname -m)"
PM=""; for p in pacman apt-get dnf zypper apk brew; do has $p && { PM=$p; break; }; done
SUDO=""; CAN_INSTALL=1
if [ "$(id -u)" -ne 0 ]; then
  if has sudo; then SUDO="sudo"; else CAN_INSTALL=0; warn "no sudo available; package installation will be skipped"; fi
fi
if [ -z "$MODE" ]; then
  if [ "$OS" = Darwin ] || [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then MODE=local
  elif [ -f /.dockerenv ] || [ -n "${CODESPACES:-}${GITPOD_WORKSPACE_ID:-}${E2B_SANDBOX:-}${CI:-}${RENDER:-}${FLY_APP_NAME:-}" ] || [ -n "${SSH_CONNECTION:-}" ]; then MODE=online
  else MODE=local; fi
fi
b "Environment"
ok "$OS $ARCH${PM:+ · $PM} · mode: $MODE$([ "$MODE" = online ] && echo " (host access locked off; use --local to override)")"

# ── 2. toolchain ──────────────────────────────────────────────────────────
b "Toolchain"
NODE_OK=0
if has node; then NV="$(node -p 'process.versions.node')"; [ "${NV%%.*}" -ge 20 ] && NODE_OK=1; fi
if [ $NODE_OK -eq 1 ]; then ok "node $NV"; else
  warn "Node.js ≥ 20 not found${NV:+ (have $NV)}"
  if [ "$(ask 'Install Node LTS with nvm (user-level)? [Y/n]' y)" != n ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    # shellcheck disable=SC1091
    set +u; . "$NVM_DIR/nvm.sh"; nvm install --lts >/dev/null; set -u; ok "node $(node -v)"
  else die "install Node.js ≥ 20 and re-run"; fi
fi
PY=""; for p in python3 python; do has $p && { PY=$p; break; }; done
[ -n "$PY" ] && ok "$($PY --version 2>&1)" || warn "python3 not found: run_python and office previews disabled"
DOCKER=0
if has docker && docker info >/dev/null 2>&1; then
  DOCKER=1; ok "docker"
elif has docker; then
  warn "docker installed but not reachable (daemon off or needs group membership)"
  if [ "$OS" = Linux ] && [ "$CAN_INSTALL" -eq 1 ] && tty_ok && [ "$(ask 'Try to start the Docker service now? [Y/n]' y)" != n ]; then
    $SUDO systemctl enable --now docker 2>/dev/null || true
    docker info >/dev/null 2>&1 && DOCKER=1 && ok "docker daemon started" || warn "Docker still unavailable; continuing without containers"
  fi
else
  no "docker (needed for local Postgres + SearXNG; Firecrawl remains optional)"
  if [ "$CAN_INSTALL" -eq 1 ] && tty_ok && [ "$(ask 'Install Docker and the Compose plugin now? [Y/n]' y)" != n ]; then
    case "$PM" in
      apt-get) $SUDO apt-get update && $SUDO apt-get install -y docker.io docker-compose-plugin ;;
      pacman) $SUDO pacman -Sy --needed --noconfirm docker docker-compose ;;
      dnf) $SUDO dnf install -y docker docker-compose-plugin ;;
      zypper) $SUDO zypper --non-interactive install docker docker-compose ;;
      apk) $SUDO apk add docker docker-cli-compose ;;
      brew) brew install --cask docker ;;
      *) warn "No supported package manager found. Install Docker Desktop/Engine and re-run." ;;
    esac
    if has docker; then
      [ "$OS" = Linux ] && $SUDO systemctl enable --now docker 2>/dev/null || true
      docker info >/dev/null 2>&1 && DOCKER=1 && ok "docker installed" || warn "Docker installed but its daemon is not ready; continuing without containers"
    fi
  fi
fi
COMPOSE=0
if [ "$DOCKER" -eq 1 ] && docker compose version >/dev/null 2>&1; then COMPOSE=1; elif [ "$DOCKER" -eq 1 ] && has docker-compose; then COMPOSE=2; fi
compose_up() { if [ "$COMPOSE" -eq 1 ]; then docker compose "$@"; else docker-compose "$@"; fi; }
CHROME=""
for c in "${CHROME_PATH:-}" google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  [ -z "$c" ] && continue; if [ -x "$c" ]; then CHROME="$c"; break; elif has "$c"; then CHROME="$(command -v "$c")"; break; fi
done
[ -n "$CHROME" ] && ok "browser for screenshots: $CHROME" || warn "no Chrome/Chromium: the agent's browser/check screenshots are off (install chromium)"
if [ "$OS" = Linux ]; then has bwrap && ok "bubblewrap (isolated sandbox shell)" || warn "bubblewrap missing: sandbox commands are not isolated (${PM:-pkg} install bubblewrap)"; fi
has uvx && ok "uv (Python MCP servers)" || no "uv (optional, for Python MCP servers: curl -LsSf https://astral.sh/uv/install.sh | sh)"
has soffice && ok "LibreOffice (page-accurate office previews)" || no "LibreOffice (optional)"
has rg && ok "ripgrep" || no "ripgrep (optional, faster fs_search)"
if has gh && gh auth status >/dev/null 2>&1; then ok "gh logged in: reused for GitHub MCP once host access is on"; else no "gh login (optional)"; fi

# ── 3. services ───────────────────────────────────────────────────────────
b "Local services"
FREE=0; http_ok http://localhost:3001/v1/models -H "Authorization: Bearer x" || http_ok http://localhost:3001/ && FREE=1
[ $FREE -eq 0 ] && [ $DOCKER -eq 1 ] && docker ps --format '{{.Names}}' | grep -qi freellmapi && FREE=1
[ $FREE -eq 1 ] && ok "FreeLLMAPI on :3001" || no "FreeLLMAPI (:3001)"
OLLAMA=""; if http_ok http://localhost:11434/api/tags; then OLLAMA="$(curl -fsS -m 3 http://localhost:11434/api/tags | sed -n 's/.*"name":"\([^"]*\)".*/\1/p' | head -1)"; ok "Ollama${OLLAMA:+ ($OLLAMA)}"; else no "Ollama (:11434)"; fi
SX=0; http_ok "http://localhost:8080/search?q=setup&format=json" && SX=1
[ $SX -eq 1 ] && ok "SearXNG JSON API on :8080" || no "SearXNG (:8080): keyless search fallback stays available"
FC=0; http_ok http://localhost:3002/ && FC=1
[ $FC -eq 1 ] && ok "Firecrawl on :3002 (optional; disabled by default)" || no "Firecrawl (:3002): only needed for explicit difficult-page escalation"
if [ $COMPOSE -ne 0 ] && [ $SX -eq 0 ]; then
  b "Starting local discovery stack"
  compose_up up -d db searxng-cache searxng >/dev/null && sleep 1 || warn "Could not start Postgres/SearXNG; continuing with embedded DB and keyless search"
  http_ok "http://localhost:8080/search?q=setup&format=json" && SX=1 && ok "SearXNG JSON API on :8080" || true
fi
PG=""; if http_ok http://localhost:3000/api/health; then warn "something already serves :3000 (a running copy?)"; fi
if [ $DOCKER -eq 1 ] && docker ps --format '{{.Names}}' | grep -q -- '-db-1$'; then PG="compose"; ok "Postgres container running"; fi

if [ $FIRECRAWL -eq 1 ]; then
  [ $DOCKER -eq 1 ] || die "--with-firecrawl needs docker"
  FCD="${FIRECRAWL_DIR:-$HOME/.local/share/firecrawl}"
  [ -d "$FCD/.git" ] || git clone --depth 1 https://github.com/firecrawl/firecrawl.git "$FCD"
  [ -f "$FCD/.env" ] || printf 'PORT=3002\nHOST=0.0.0.0\nUSE_DB_AUTHENTICATION=false\nBULL_AUTH_KEY=%s\n' "$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$FCD/.env"
  [ "$COMPOSE" -ne 0 ] || die "Docker Compose plugin/command is required for --with-firecrawl"
  b "Starting Firecrawl (first build takes several minutes)"; (cd "$FCD" && compose_up up -d --build) && FC=1 && ok "Firecrawl on :3002"
fi

# ── 4. .env (only missing keys are added) ─────────────────────────────────
b "Configuration"
touch .env; chmod 600 .env
setk() { grep -q "^$1=" .env || { printf '%s=%s\n' "$1" "$2" >> .env; ok "$1${3:+ ($3)}"; }; }
if ! grep -q '^LLM_BASE_URL=' .env; then
  if [ $FREE -eq 1 ]; then
    setk LLM_PROVIDER freellmapi; setk LLM_BASE_URL http://localhost:3001/v1; setk LLM_MODEL gemini-2.5-flash
    setk LLM_API_KEY "$(secret 'FreeLLMAPI key (freellmapi-…, Enter to skip):')" "FreeLLMAPI"
  elif [ -n "$OLLAMA" ]; then
    setk LLM_PROVIDER ollama; setk LLM_BASE_URL http://localhost:11434/v1; setk LLM_MODEL "$OLLAMA"; setk LLM_CONTEXT_TOKENS 16000 "small-context prompts"
  else
    setk LLM_PROVIDER gemini; setk LLM_BASE_URL https://generativelanguage.googleapis.com/v1beta/openai; setk LLM_MODEL gemini-3.5-flash-lite
    setk LLM_API_KEY "$(secret 'Gemini API key (aistudio.google.com/apikey, Enter to set later in Settings):')" "Gemini"
  fi
else ok "LLM already configured"; fi
setk SEARXNG_URL http://localhost:8080 "local-first search"
setk FIRECRAWL_URL http://localhost:3002
if [ $FIRECRAWL -eq 1 ]; then
  if grep -q '^FIRECRAWL_ENABLED=' .env; then sed -i.bak 's/^FIRECRAWL_ENABLED=.*/FIRECRAWL_ENABLED=1/' .env && rm -f .env.bak; else setk FIRECRAWL_ENABLED 1 "explicit Firecrawl fallback"; fi
else
  setk FIRECRAWL_ENABLED 0 "Firecrawl off by default"
fi
grep -q '^FIRECRAWL_API_KEY=' .env || setk FIRECRAWL_API_KEY "$(secret 'Firecrawl cloud key (optional, Enter to skip):')"
setk WORKSPACE_DIR ./workspace
if [ "$PG" = compose ]; then setk DATABASE_URL postgresql://postgres:postgres@127.0.0.1:5432/app_db "docker Postgres"; fi
grep -q '^DATABASE_URL=' .env || no "database: embedded PGlite in ./data (set DATABASE_URL for Postgres)"
[ -n "$CHROME" ] && setk CHROME_PATH "$CHROME"
[ "$MODE" = online ] && setk HOST_ACCESS off "server: host files/terminal can't be enabled"
setk PORT "$PORT"
# owner convenience: preferred browser for the launcher
for z in "${CHAT_BROWSER:-}" "$HOME/Downloads/zen.linux-x86_64/zen/zen" zen-browser zen; do
  [ -z "$z" ] && continue; if [ -x "$z" ] || has "$z"; then setk CHAT_BROWSER "$z" "launcher browser"; break; fi
done

# ── 5. install & build ────────────────────────────────────────────────────
b "Installing"
npm ci --no-audit --no-fund --loglevel=error && ok "node modules"
if [ -n "$PY" ]; then
  if [ ! -x .venv/bin/python ]; then $PY -m venv .venv 2>/dev/null || warn "python venv unavailable (install python3-venv); using system python"; fi
  if [ -x .venv/bin/python ]; then .venv/bin/python -m pip install -q --upgrade pip >/dev/null 2>&1 || true; .venv/bin/python -m pip install -q -r requirements.txt && ok "python packages (.venv)"; fi
fi
b "Building"; npm run build --silent >/tmp/minimalist-chat-build.log 2>&1 && ok "build" || { tail -30 /tmp/minimalist-chat-build.log; die "build failed (full log: /tmp/minimalist-chat-build.log)"; }

# ── 6. service + launcher (desktop) ───────────────────────────────────────
HOSTBIND=127.0.0.1; [ "$MODE" = online ] && HOSTBIND=0.0.0.0
NPM="$(command -v npm)"; NODEDIR="$(dirname "$(command -v node)")"
if [ "$MODE" = local ] && [ $SERVICE -eq 1 ]; then
  b "Service"
  mkdir -p "$HOME/.local/bin"
  sed -e "s|@APP@|$APP|g" -e "s|@PORT@|$PORT|g" scripts/minimalist-chat > "$HOME/.local/bin/minimalist-chat"; chmod +x "$HOME/.local/bin/minimalist-chat"
  ln -sf "$APP/scripts/chatsync.mjs" "$HOME/.local/bin/chatsync"
  ln -sf "$APP/scripts/chatsync.mjs" "$HOME/.local/bin/chat-sync"
  ok "launcher: minimalist-chat [open|summon|ask \"…\"|hotkey|start|stop|restart|status|logs|sync|rollback]"
  ok "sync & rollback tool: chatsync (or chat-sync)"
  if [ "$OS" = Linux ] && has systemctl && systemctl --user show-environment >/dev/null 2>&1; then
    PRE=""
    if [ "$COMPOSE" -eq 1 ]; then PRE="ExecStartPre=$(command -v docker) compose -f \"$APP/docker-compose.yml\" up -d db searxng-cache searxng"; elif [ "$COMPOSE" -eq 2 ]; then PRE="ExecStartPre=$(command -v docker-compose) -f \"$APP/docker-compose.yml\" up -d db searxng-cache searxng"; fi
    mkdir -p "$HOME/.config/systemd/user"
    sed -e "s|@APP@|$APP|g" -e "s|@PORT@|$PORT|g" -e "s|@HOST@|$HOSTBIND|g" -e "s|@NPM@|$NPM|g" -e "s|@PATH@|$NODEDIR:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin|g" -e "s|@PRE@|$PRE|g" \
      scripts/minimalist-chat.service > "$HOME/.config/systemd/user/minimalist-chat.service"
    systemctl --user daemon-reload && systemctl --user enable --now minimalist-chat >/dev/null 2>&1 && ok "systemd user service (starts at login)"
    mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons"
    cp scripts/minimalist-chat.svg "$HOME/.local/share/icons/minimalist-chat.svg"
    sed -e "s|@BIN@|$HOME/.local/bin/minimalist-chat|g" -e "s|@ICON@|$HOME/.local/share/icons/minimalist-chat.svg|g" scripts/minimalist-chat.desktop > "$HOME/.local/share/applications/minimalist-chat.desktop"
    ok "app launcher entry"
    # the summon window is what makes this a desktop app rather than a tab: bind it once
    if [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
      HK="$("$HOME/.local/bin/minimalist-chat" hotkey 2>/dev/null | head -4 | tail -1)"
      [ -n "$HK" ] && ok "hotkey: bind \`minimalist-chat summon\` — run \"minimalist-chat hotkey --write\" to do it now"
    fi
  elif [ "$OS" = Darwin ]; then
    PL="$HOME/Library/LaunchAgents/com.minimalist-chat.plist"; mkdir -p "$(dirname "$PL")"
    cat > "$PL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.minimalist-chat</string>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>ProgramArguments</key><array><string>$NPM</string><string>start</string><string>--</string><string>-H</string><string>$HOSTBIND</string><string>-p</string><string>$PORT</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODEDIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string><key>NODE_ENV</key><string>production</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/minimalist-chat.log</string><key>StandardErrorPath</key><string>$HOME/Library/Logs/minimalist-chat.log</string>
</dict></plist>
EOF
    launchctl unload "$PL" 2>/dev/null || true; launchctl load "$PL" && ok "launchd agent (starts at login)"
  else warn "no user service manager found: start with  npm start -- -H $HOSTBIND -p $PORT"; fi
fi

# ── 7. done ───────────────────────────────────────────────────────────────
b "Ready"
echo "  App:      http://localhost:$PORT"
echo "  Run:      npm start -- -H $HOSTBIND -p $PORT$([ "$MODE" = local ] && [ $SERVICE -eq 1 ] && echo '   (or: minimalist-chat open)')"
echo "  Search:   SearXNG at http://localhost:8080 when Docker is available; HTTP extraction stays browser-free."
echo "  Firecrawl: $(grep -q '^FIRECRAWL_ENABLED=1' .env && echo 'enabled as an explicit fallback' || echo 'off by default')"
echo "  Access:   files and terminal start sandboxed; enable home folder / host terminal / sudo in Settings → Access."
[ "$MODE" = online ] && echo "  Server:   bound to 0.0.0.0 with HOST_ACCESS=off. Put it behind auth (reverse proxy) before exposing it."
exit 0
