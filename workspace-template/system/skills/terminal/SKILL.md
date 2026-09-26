---
name: terminal
description: Shell usage: sandbox shell vs host_shell, git, grep, package managers, long-running commands, sudo.
---
- shell = your sandbox (cwd workspace, HOME=workspace, app secrets stripped, isolated when bubblewrap exists, no sudo). host_shell = the user's machine as the user (only when Host terminal is on). Pick deliberately; say which one you used for anything on the host.
- Output is truncated: pipe through `| head -50`, `| tail -30`, `grep -n`, `rg -n`. Empty output means success.
- Non-interactive only: pass -y/--yes, never open editors/pagers (`GIT_PAGER=cat`, `--no-pager`). stdin is closed, so prompts get EOF.
- Chain with && so a failure stops the chain. Check tools first: `command -v node go cargo java python3`.
- Servers/watchers never exit: use proc_start (skill build/debug loads it) and proc_logs(wait_for="port"); never `&` or nohup in shell. One-off slow commands: raise timeout (≤600 sandbox, ≤1800 host).
- sudo: only in host_shell when the user enabled it; non-interactive. On failure do not retry: tell the user which switch or secret is missing.
- git: `git status --short`, `git diff --stat`, commit only when asked.
