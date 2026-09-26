---
name: home-files
description: Reading and editing files in the user's home folder (~/…): search, safety, secrets.
requires: host-files
---
- Paths: ~/path or absolute paths under the home folder (entire disk only when that switch is on). Workspace paths stay relative.
- Search big trees with fs_search(pattern, path="~/dir", glob="*.md") instead of listing everything; skip node_modules, caches, Library.
- Edits on home files are real and immediate: fs_read first, small fs_edit calls, back up config/dotfiles before changing them (copy to <file>.bak with fs_write or host_shell cp).
- Do not open secret stores unless the user asks for that file specifically: ~/.ssh, ~/.aws, ~/.gnupg, ~/.config/gh/hosts.yml, .env files, browser profiles, password managers. Never paste secret values into chat.
- To work on a home project with tools that need the sandbox (run_python, shell), copy inputs into the workspace; to deliver, write the result back to the user's chosen path and say where.
