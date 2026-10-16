#!/usr/bin/env bash
# Install / upgrade Minimalist AI Workspace on Linux from a source checkout.
#
#   scripts/install-desktop.sh             build the bundle and install the launcher + menu entry
#   scripts/install-desktop.sh --no-build  install using what is already in src-tauri/resources
#   scripts/install-desktop.sh --system    also install the binary for all users (needs root)
#
# What it does, in order:
#   1. checks the tools the build needs (node, npm, a Linux desktop stack);
#   2. builds the app: `npm install`, `npm run build`, `desktop:prepare` (bundles the app server,
#      the Node runtime, SearXNG and its python),
#   3. builds the Rust shell if a Rust toolchain is present — otherwise it uses an existing
#      `src-tauri/target/release/minimalist-ai` binary;
#   4. installs `minimalist-ai-ctl` into ~/.local/bin and a desktop entry into
#      ~/.local/share/applications, pointing at the built binary.
#
# Packaging instead of installing from source: `npm run desktop:build` produces an AppImage, a
# .deb and an .rpm in src-tauri/target/release/bundle — those do all of the above by themselves.

set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
BUILD=1
SYSTEM=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --system) SYSTEM=1 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1; }

say "Checking the build dependencies"
need node || die "node is required (Arch: pacman -S nodejs npm)"
need npm  || die "npm is required (Arch: pacman -S npm)"
for lib in webkit2gtk-4.1 gtk+-3.0; do
  if ! pkg-config --exists "$lib" 2>/dev/null; then
    warn "missing $lib — the Rust shell will not link. Arch: pacman -S webkit2gtk-4.1 gtk3"
  fi
done
if ! need cargo; then
  warn "no Rust toolchain (rustup) — skipping the shell build and using an existing binary"
fi

if [ "$BUILD" = 1 ]; then
  cd "$ROOT"
  say "Installing npm dependencies"
  npm install --no-audit --no-fund

  say "Building the app and assembling the bundle (this takes a few minutes)"
  npm run build
  npm run desktop:prepare

  if need cargo; then
    say "Building the desktop shell (release)"
    ( cd src-tauri && cargo build --release )
  fi
fi

BIN="$ROOT/src-tauri/target/release/minimalist-ai"
[ -x "$BIN" ] || die "no shell binary at $BIN. Install rustup (https://rustup.rs) and re-run, or build a package with: npm run desktop:build"
[ -f "$ROOT/src-tauri/resources/appserver/server.js" ] || die "no bundle in src-tauri/resources. Run: npm run desktop:prepare"

say "Installing the launcher"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps"
install -m 0755 "$ROOT/scripts/minimalist-ai-ctl" "$HOME/.local/bin/minimalist-ai-ctl"
install -m 0644 "$ROOT/src-tauri/icons/128x128@2x.png" "$HOME/.local/share/icons/hicolor/256x256/apps/minimalist-ai.png"

cat > "$HOME/.local/share/applications/minimalist-ai.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=Minimalist AI Workspace
Comment=Local AI workspace: chat, agent tools, Blocks, canvas
Exec=$BIN
Icon=minimalist-ai
Terminal=false
Categories=Utility;Development;
StartupWMClass=minimalist-ai
DESKTOP
chmod 0644 "$HOME/.local/share/applications/minimalist-ai.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

if [ "$SYSTEM" = 1 ]; then
  say "Installing for all users (sudo)"
  sudo install -m 0755 "$BIN" /usr/local/bin/minimalist-ai
  sudo install -m 0644 "$HOME/.local/share/applications/minimalist-ai.desktop" /usr/share/applications/minimalist-ai.desktop
  command -v update-desktop-database >/dev/null 2>&1 && sudo update-desktop-database >/dev/null 2>&1 || true
fi

say "Installed"
cat <<DONE

  Run it:            minimalist-ai  (from your launcher)
  Status / logs:     minimalist-ai-ctl status
                     minimalist-ai-ctl logs
  Restart the server: minimalist-ai-ctl restart

  Data lives in ~/.local/share/dev.bhavyam.minimalist-ai (workspace/, data/pglite/, logs/).

  Uninstall:  rm ~/.local/bin/minimalist-ai-ctl \\
                 ~/.local/share/applications/minimalist-ai.desktop \\
                 ~/.local/share/icons/hicolor/256x256/apps/minimalist-ai.png
DONE
