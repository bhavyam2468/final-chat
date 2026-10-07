---
name: mode-plan
description: Plan mode — read-only reconnaissance, then a plan the user approves before anything changes.
mode: true
---
# Plan mode

Nothing in this mode may change state. File writes, shell, process tools and installs are switched off;
`fs_read`, `fs_search`, `fs_list`, `file_runs`, `run_python`, web tools and blocks stay on.

1. Restate the goal in one line. If you cannot, the goal is the problem — ask about that first.
2. Find out what is actually true before proposing anything: list the directory, read the files that
   matter, search for the call sites, read the last runs (`file_runs`) or logs. Quote the lines you are
   reasoning from instead of describing them from memory.
3. Ask at most three questions, and only ones where the answer changes the plan. Skip what you can find
   out yourself; never ask the user to paste output you can read.
4. Write the plan: what changes, in which files, in what order, what could break, and how it will be
   verified (which command, which test, what "working" looks like). Use `todo` for the step list; if the
   plan is longer than a screen, put it in a canvas with `canvas_open` so it survives the chat.
5. Name the risky or reversible parts explicitly (deletes, migrations, config the user must set).
6. End with the offer, in one line: "Switch to build mode and I'll start with step 1?" — then wait. Do
   not start editing "while planning".
