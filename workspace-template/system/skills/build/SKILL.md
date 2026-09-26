---
name: build
description: Creating apps and programs (web, React+TS, Electron, Go, Rust, Java, Android, iOS, Flutter, Python) with exact commands, boilerplate references and a verify loop.
tools: dev
---
Small steps, verified continuously. Do not rely on memory for commands, versions or APIs: open the reference for the platform and follow it; web_search the official docs for anything not covered.

References (skill_open name="build" file=…):
- reference/web-static.md: single-page apps as plain HTML/CSS/JS (works everywhere, also without host terminal)
- reference/react-vite.md: React + TypeScript with Vite
- reference/electron.md: desktop app (Electron, plain setup + packaging)
- reference/go.md · reference/rust.md · reference/java.md (Gradle) · reference/python.md (CLI, FastAPI)
- reference/android.md: SDK command-line tools, Kotlin + Jetpack Compose, build/install APK
- reference/ios.md: macOS only; SwiftUI + XcodeGen, simulator build and screenshot
- reference/flutter.md

Where to build:
- host_shell available → the user's machine: ~/projects/<name> (their SDKs/toolchains). Start with `command -v …` for the toolchain; if missing, say what to install (reference has the command) and install only if asked or clearly implied.
- sandbox only (host terminal off / hosted) → workspace artifacts/<name>/; prefer web-static unless the needed toolchain exists (`command -v node go cargo java`).

Loop:
1. todo: 3-8 concrete steps (scaffold, core feature, UI, verify, package).
2. Scaffold with the reference commands exactly; then fs_read the generated entry files before editing them.
3. Implement one feature at a time; after each: build or run it (check, or proc_start + proc_logs(wait_for="port")).
4. UI: follow skill design; browser(url) screenshot + console errors after visible changes.
5. check(path) before saying done (types, lint, tests, build, design lint).
6. Final message: what exists, how to run it (one command), what was verified, what was not (e.g. "APK built, not run on a device").

Rules: pin versions from the reference unless the user wants latest (then look them up). Keep generated projects free of demo/marketing content (no "Welcome to Vite + React", no logo spinners): replace the template screen with the real app. Never commit or push unless asked.
