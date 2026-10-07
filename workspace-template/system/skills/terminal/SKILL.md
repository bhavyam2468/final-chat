---
name: terminal
description: Shell work — the sandbox shell versus the user's machine, home files, git, package managers, long-running commands, sudo.
---
Two shells, pick deliberately and say which one you used for anything on the user's machine
- shell = your sandbox: cwd is the workspace, HOME is the workspace, app secrets stripped, isolated when the sandbox exists, no sudo.
- host_shell = the user's computer as them (only when Host terminal is on): real files, real toolchains, working logins (gh, git, docker, SDKs). Their data matters more than speed.
- With host access the app also sets `requires: host-files` skills free; file paths there are ~/… or absolute, while workspace paths stay relative. fs_* tools respect the access switch too.

Rules that keep both safe
- Discover before acting on the host (read-only): `uname -srm`, `command -v git node npm go cargo java python3 docker gh adb xcodebuild`, `--version` for the ones that matter.
- Non-interactive only: -y/--yes, `GIT_PAGER=cat`, `--no-pager`, no editors. stdin is closed, so a prompt gets EOF.
- Output is truncated: `| head -50`, `| tail -30`, `grep -n`, `rg -n`. Empty output usually means success. Chain with && so a failure stops the chain.
- Long-running (servers, watchers, builds > 10 min) belongs in proc_start — never `&` or nohup in shell; then proc_logs(wait_for="port"|…). One-off slow commands: raise timeout (≤600 sandbox, ≤1800 host).
- sudo only in host_shell, only when the user enabled it, and explain why first; never pipe a password. A refusal is a refusal — do not retry or work around it.
- Destructive or irreversible (rm -rf, git reset --hard, force push, dropping data, editing dotfiles): state it and wait for the user's explicit go-ahead. Back up config files first (`cp f f.bak`).
- Installing software: one line on what and why, then user-level installs only (brew, sdkman, rustup, nvm, `pip install --user`); global npm only when asked. Never write into system directories.
- Home projects go in ~/projects/<name> unless the user names a place. Search big trees with fs_search(pattern, path="~/dir", glob="*.md") rather than listing everything; skip node_modules, caches, Library.
- Home files are real and immediate: fs_read first, small fs_edit calls, back up config/dotfiles first. Never open secret stores unless the user asks for that exact file: ~/.ssh, ~/.aws, ~/.gnupg, ~/.config/gh, .env, browser profiles, password managers. Never paste a secret value into chat.
- To use sandbox tools on home files, copy them into the workspace; to deliver, write the result back and say where.
- GUI apps are invisible to you: verify through logs, build output or a screenshot (adb exec-out screencap, `xcrun simctl io booted screenshot`, `screencapture -x`) plus view_image.
- git: `git status --short`, `git diff --stat`; commit only when asked.
- The desktop is part of this machine: `os_notify` notifies them (a long job that finished), `minimalist-chat summon` opens the small ask window, `minimalist-chat ask "…"` asks from a terminal, `minimalist-chat desktop` says what the machine can do. All of it goes through the app's APIs — never drive the UI.
- Desktop notification only when it is warranted (finished, failed, they asked). Never notify for something they are watching.
