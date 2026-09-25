---
name: terminal
description: Shell usage: git, grep, find, package managers, long commands, full-access mode.
---
- shell(command): bash -lc, cwd=workspace, 120s timeout, output truncated to 8k. Use `| head`, `grep -n`, `rg` if present.
- Chain with && . No interactive commands (use -y flags). No servers that never exit; use `timeout 20 cmd` or `nohup cmd &`.
- git available: status, log --oneline -10, diff --stat.
- In full-access mode commands affect the user's real machine: be explicit and conservative.
