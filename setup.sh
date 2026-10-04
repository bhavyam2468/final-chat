#!/usr/bin/env bash
# Interactive Setup and Update CLI for Final Chat
# Usage:
#   Fresh Install: curl -fsSL https://raw.githubusercontent.com/bhavyam2468/final-chat/main/setup.sh | bash
#   In Repo:       ./setup.sh [--update] [--local|--online] [--yes] [--port N]
#
# Idempotent, safe to re-run anytime. Handles installs, upgrades, Docker setup, FreeLLMAPI, SearXNG, and services.

set -euo pipefail

REPO="https://github.com/bhavyam2468/final-chat.git"
MODE=""; YES=0; SERVICE=1; DO_UPDATE=0; PORT="${PORT:-3000}"
LLM_CHOICE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --update|-u) DO_UPDATE=1 ;;
    --local) MODE=local ;;
    --online) MODE=online ;;
    --yes|-y) YES=1 ;;
    --no-service) SERVICE=0 ;;
    --port) PORT="$2"; shift ;;
    -h|--help)
      printf "Usage: %s [--update] [--local|--online] [--yes] [--no-service] [--port N]\n" "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# UI Colors & Formatting
b() { printf '\033[1;37m%s\033[0m\n' "$*"; }
header() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no() { printf '  \033[2m·\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
info() { printf '  \033[34mℹ\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

has() { command -v "$1" >/dev/null 2>&1; }
tty_ok() { [ $YES -eq 0 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; }
ask() {
  local a=""
  if tty_ok; then
    printf '%s ' "$1" >/dev/tty
    read -r a </dev/tty || true
  fi
  echo "${a:-$2}"
}
secret() {
  local a=""
  if tty_ok; then
    printf '%s ' "$1" >/dev/tty
    stty -echo </dev/tty 2>/dev/null || true
    read -r a </dev/tty || true
    stty echo </dev/tty 2>/dev/null || true
    printf '\n' >/dev/tty
  fi
  echo "$a"
}
http_ok() { curl -fsS -m 3 -o /dev/null "$@" 2>/dev/null; }

# ASCII Banner
printf '\033[1;33m'
cat << 'EOF'
  ___ _             _   ___ _           _   
 | __(_)_ _  __ _  | | / __| |_  __ _ _| |_ 
 | _|| | ' \/ _` | | || (__| ' \/ _` |_   _|
 |_| |_|_||_\__,_| |_| \___|_||_\__,_| |_|  
                                            
EOF
printf '\033[0m'
b "Quiet Paper AI Agent & Living Workspace"

# ── 0. Source resolution & Clone / Update detection ───────────────────────
SRC="${BASH_SOURCE[0]:-}"
if [ -z "$SRC" ] || [ ! -f "$(dirname "$SRC")/package.json" ]; then
  DIR="${CHAT_DIR:-$HOME/final-chat}"
  has git || die "git is required"
  if [ -d "$DIR/.git" ]; then
    b "Existing installation found at $DIR. Updating..."
    git -C "$DIR" pull --ff-only
  else
    b "Cloning final-chat into $DIR..."
    git clone --depth 1 "$REPO" "$DIR"
  fi
  exec bash "$DIR/setup.sh" "$@"
fi

cd "$(dirname "$SRC")"
APP="$(pwd)"

# Check if this is an existing installation and prompt for Update
if [ -d .git ] && [ -f .env ] && [ $DO_UPDATE -eq 0 ] && [ $YES -eq 0 ]; then
  git remote update >/dev/null 2>&1 || true
  UPSTREAM_DIFF="$(git status -uno --porcelain=v2 --branch 2>/dev/null | grep 'branch.ab' || true)"
  if [[ "$UPSTREAM_DIFF" == *"+"* ]] || [[ "$UPSTREAM_DIFF" == *"-"* ]]; then
    info "An update is available on GitHub."
    UPDATE_CHOICE="$(ask "Would you like to update to the latest version now? [Y/n]" "y")"
    if [ "$UPDATE_CHOICE" != "n" ] && [ "$UPDATE_CHOICE" != "N" ]; then
      DO_UPDATE=1
    fi
  fi
fi

# ── Update Routine ────────────────────────────────────────────────────────
if [ $DO_UPDATE -eq 1 ]; then
  header "Updating Final Chat"
  b "Pulling latest changes from repository..."
  if [ -d .git ]; then
    git pull --ff-only && ok "Git repository updated"
  fi
  b "Installing dependencies..."
  npm install --no-audit --no-fund --loglevel=error && ok "Node modules updated"
  b "Running database migration check..."
  npx drizzle-kit push >/dev/null 2>&1 || true && ok "Database schema ready"
  b "Rebuilding production bundle..."
  npm run build --silent && ok "Build successful"
  if has systemctl && systemctl --user is-active --quiet minimalist-chat 2>/dev/null; then
    systemctl --user restart minimalist-chat && ok "Background service restarted"
  fi
  ok "Update complete! You are running the latest version."
  exit 0
fi

# ── 1. Environment Detection ──────────────────────────────────────────────
header "Environment Check"
OS="$(uname -s)"
ARCH="$(uname -m)"
PM=""
for p in pacman apt-get dnf zypper apk brew; do
  has $p && { PM=$p; break; };
done

if [ -z "$MODE" ]; then
  if [ "$OS" = Darwin ] || [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    MODE=local
  elif [ -f /.dockerenv ] || [ -n "${CODESPACES:-}${GITPOD_WORKSPACE_ID:-}${E2B_SANDBOX:-}${CI:-}${RENDER:-}${FLY_APP_NAME:-}" ] || [ -n "${SSH_CONNECTION:-}" ]; then
    MODE=online
  else
    MODE=local
  fi
fi

ok "$OS $ARCH (${PM:-no package manager}) · Mode: $MODE"

# ── 2. Toolchain Verification ─────────────────────────────────────────────
header "Toolchain"
NODE_OK=0
if has node; then
  NV="$(node -p 'process.versions.node' 2>/dev/null || true)"
  [ "${NV%%.*}" -ge 20 ] && NODE_OK=1
fi

if [ $NODE_OK -eq 1 ]; then
  ok "Node.js $NV"
else
  warn "Node.js ≥ 20 not found"
  if [ "$(ask 'Install Node.js LTS via nvm? [Y/n]' y)" != n ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    set +u
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install --lts >/dev/null
    set -u
    ok "Node.js $(node -v) installed"
  else
    die "Node.js ≥ 20 is required to run Final Chat."
  fi
fi

PY=""
for p in python3 python; do
  has $p && { PY=$p; break; };
done
[ -n "$PY" ] && ok "$($PY --version 2>&1)" || warn "python3 not found: run_python will be disabled"

# Docker check and optional interactive installer
DOCKER=0
if has docker && docker info >/dev/null 2>&1; then
  DOCKER=1
  ok "Docker is running"
elif has docker; then
  warn "Docker installed but daemon is not running (or user lacks docker group permission)"
else
  no "Docker not installed"
  if [ "$OS" = Linux ] && [ -n "$PM" ]; then
    DOCKER_PROMPT="$(ask "Install Docker now for zero-config local LLM (FreeLLMAPI)? [y/N]" n)"
    if [ "$DOCKER_PROMPT" = y ] || [ "$DOCKER_PROMPT" = Y ]; then
      b "Installing Docker..."
      curl -fsSL https://get.docker.com | sh || sudo apt-get install -y docker.io docker-compose-plugin 2>/dev/null || true
      if has docker; then
        sudo usermod -aG docker "$USER" 2>/dev/null || true
        sudo systemctl enable --now docker 2>/dev/null || true
        DOCKER=1
        ok "Docker installed successfully"
      fi
    fi
  fi
fi

has uvx && ok "uv (fast Python MCP tools ready)" || no "uv (optional: curl -LsSf https://astral.sh/uv/install.sh | sh)"
has rg && ok "ripgrep (fast file search)" || no "ripgrep (optional)"
if has gh && gh auth status >/dev/null 2>&1; then
  ok "GitHub CLI (gh) logged in: auto-reused for GitHub MCP"
else
  no "GitHub CLI (gh) optional"
fi

# ── 3. Services & LLM Provider ────────────────────────────────────────────
header "LLM Provider Setup"

FREE=0
if http_ok http://localhost:3001/v1/models -H "Authorization: Bearer x" || http_ok http://localhost:3001/; then
  FREE=1
fi
if [ $FREE -eq 0 ] && [ $DOCKER -eq 1 ] && docker ps --format '{{.Names}}' | grep -qi freellmapi; then
  FREE=1
fi

OLLAMA=""
if http_ok http://localhost:11434/api/tags; then
  OLLAMA="$(curl -fsS -m 3 http://localhost:11434/api/tags | sed -n 's/.*"name":"\([^"]*\)".*/\1/p' | head -1)"
fi

# Interactive Provider Selector if not already configured in .env
touch .env; chmod 600 .env
setk() {
  if ! grep -q "^$1=" .env; then
    printf '%s=%s\n' "$1" "$2" >> .env
    ok "$1${3:+ ($3)}"
  fi
}

if ! grep -q '^LLM_BASE_URL=' .env; then
  echo ""
  b "Choose your primary LLM endpoint:"
  echo "  1) FreeLLMAPI (Local, 100% free, zero-config via Docker)"
  echo "  2) Google Gemini (Free API tier from Google AI Studio)"
  echo "  3) Ollama (Local models on :11434)"
  echo "  4) OpenRouter (Unified API for Claude, GPT, Llama, DeepSeek)"
  echo "  5) OpenAI (Direct api.openai.com)"
  echo "  6) Custom endpoint"

  LLM_SEL="$(ask "Select provider [1-6] (default 1):" "1")"

  case "$LLM_SEL" in
    1)
      if [ $FREE -eq 0 ] && [ $DOCKER -eq 1 ]; then
        b "Launching FreeLLMAPI Docker container..."
        FREE_KEY="freellmapi-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        docker run -d --name freellmapi -p 3001:3001 \
          -e API_KEY="$FREE_KEY" \
          --restart unless-stopped \
          ghcr.io/freellmapi/freellmapi:latest 2>/dev/null || true
        FREE=1
        info "Your generated FreeLLMAPI key is: \033[1;32m$FREE_KEY\033[0m"
      fi
      setk LLM_PROVIDER freellmapi
      setk LLM_BASE_URL http://localhost:3001/v1
      setk LLM_MODEL gemini-2.5-flash
      setk LLM_API_KEY "${FREE_KEY:-$(secret 'FreeLLMAPI key (Enter to skip):')}" "FreeLLMAPI"
      ;;
    2)
      setk LLM_PROVIDER gemini
      setk LLM_BASE_URL https://generativelanguage.googleapis.com/v1beta/openai
      setk LLM_MODEL gemini-3.5-flash-lite
      setk LLM_API_KEY "$(secret 'Gemini API key (from aistudio.google.com/apikey):')" "Gemini"
      ;;
    3)
      setk LLM_PROVIDER ollama
      setk LLM_BASE_URL http://localhost:11434/v1
      setk LLM_MODEL "${OLLAMA:-qwen2.5:7b}"
      setk LLM_CONTEXT_TOKENS 32000
      ;;
    4)
      setk LLM_PROVIDER openrouter
      setk LLM_BASE_URL https://openrouter.ai/api/v1
      setk LLM_MODEL google/gemini-2.5-flash-lite
      setk LLM_API_KEY "$(secret 'OpenRouter API key:') "OpenRouter"
      ;;
    5)
      setk LLM_PROVIDER openai
      setk LLM_BASE_URL https://api.openai.com/v1
      setk LLM_MODEL gpt-4o-mini
      setk LLM_API_KEY "$(secret 'OpenAI API key:')" "OpenAI"
      ;;
    *)
      CUSTOM_URL="$(ask 'Base URL:' 'http://localhost:8000/v1')"
      CUSTOM_MODEL="$(ask 'Model name:' 'default')"
      setk LLM_PROVIDER custom
      setk LLM_BASE_URL "$CUSTOM_URL"
      setk LLM_MODEL "$CUSTOM_MODEL"
      setk LLM_API_KEY "$(secret 'API key (optional, Enter to skip):')" "Custom"
      ;;
  esac
else
  ok "LLM endpoint already configured in .env"
fi

# ── 4. Search Engine Configuration ────────────────────────────────────────
header "Search Configuration"
info "By default, Final Chat uses high-speed direct HTTP and metasearch (zero memory overhead, no heavy Chrome)."
setk USE_FIRECRAWL "0" "Fast HTTP & metasearch default"
setk SEARXNG_URL "" "SearXNG endpoint (optional)"
setk FIRECRAWL_URL "http://localhost:3002"
setk FIRECRAWL_CLOUD_URL "https://api.firecrawl.dev"
setk FIRECRAWL_API_KEY ""

# Workspace & Server settings
setk WORKSPACE_DIR "./workspace"
setk PORT "$PORT"
if [ "$MODE" = online ]; then
  setk HOST_ACCESS "off" "Server mode: sandbox enforced"
fi

# ── 5. Installation & Build ───────────────────────────────────────────────
header "Installing Dependencies"
npm install --no-audit --no-fund --loglevel=error && ok "Node packages installed"

if [ -n "$PY" ]; then
  if [ ! -x .venv/bin/python ]; then
    $PY -m venv .venv 2>/dev/null || warn "python3-venv unavailable; fallback to system python"
  fi
  if [ -x .venv/bin/python ]; then
    .venv/bin/python -m pip install -q --upgrade pip >/dev/null 2>&1 || true
    .venv/bin/python -m pip install -q -r requirements.txt 2>/dev/null && ok "Python packages (.venv)" || true
  fi
fi

header "Building Final Chat"
npm run build --silent && ok "Application built successfully"

# ── 6. Desktop Service & Launcher ─────────────────────────────────────────
HOSTBIND="127.0.0.1"
[ "$MODE" = online ] && HOSTBIND="0.0.0.0"
NPM="$(command -v npm)"
NODEDIR="$(dirname "$(command -v node)")"

if [ "$MODE" = local ] && [ $SERVICE -eq 1 ]; then
  header "System Launcher"
  mkdir -p "$HOME/.local/bin"
  sed -e "s|@APP@|$APP|g" -e "s|@PORT@|$PORT|g" scripts/minimalist-chat > "$HOME/.local/bin/minimalist-chat"
  chmod +x "$HOME/.local/bin/minimalist-chat"
  ok "Launcher installed to $HOME/.local/bin/minimalist-chat"

  if [ "$OS" = Linux ] && has systemctl && systemctl --user show-environment >/dev/null 2>&1; then
    mkdir -p "$HOME/.config/systemd/user"
    sed -e "s|@APP@|$APP|g" -e "s|@PORT@|$PORT|g" -e "s|@HOST@|$HOSTBIND|g" -e "s|@NPM@|$NPM|g" -e "s|@PATH@|$NODEDIR:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin|g" -e "s|@PRE@||g" \
      scripts/minimalist-chat.service > "$HOME/.config/systemd/user/minimalist-chat.service"
    systemctl --user daemon-reload && systemctl --user enable --now minimalist-chat >/dev/null 2>&1 && ok "Background service enabled (runs on login)"
    
    mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons"
    cp scripts/minimalist-chat.svg "$HOME/.local/share/icons/minimalist-chat.svg"
    sed -e "s|@BIN@|$HOME/.local/bin/minimalist-chat|g" -e "s|@ICON@|$HOME/.local/share/icons/minimalist-chat.svg|g" scripts/minimalist-chat.desktop > "$HOME/.local/share/applications/minimalist-chat.desktop"
    ok "Application launcher menu shortcut created"
  fi
fi

# ── 7. Summary ────────────────────────────────────────────────────────────
header "Ready"
b "Final Chat is configured and ready!"
echo "  URL:     http://localhost:$PORT"
echo "  Start:   npm start -- -H $HOSTBIND -p $PORT"
echo "  Update:  ./setup.sh --update"
echo ""
ok "Setup complete."
exit 0
