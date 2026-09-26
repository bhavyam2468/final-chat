---
name: terminal
description: Shell usage: git, grep, find, package managers, long commands, host vs sandbox terminal, sudo.
---
- shell(command, timeout≤600): bash -lc; output truncated. Use `| head`, `grep -n`, `rg`.
- Sandbox terminal: cwd workspace, secrets stripped, isolated when bubblewrap exists; no sudo.
- Host terminal: runs as the user, cwd ~ when home access is on. Be explicit and conservative; prefer read-only commands first.
- sudo works only when the user enabled it (non-interactive; fails fast if a password is needed and none is stored). Never loop on sudo failures: tell the user which switch or secret is missing.
- Chain with &&. No interactive commands (-y flags). Never start servers that don't exit; use `timeout 20 cmd` or `nohup cmd > log 2>&1 &`.
