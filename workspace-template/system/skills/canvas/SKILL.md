---
name: canvas
description: Canvas windows: persistent UIs, documents, media, file viewers; editing and running code in the app; floating or docked beside chat.
---
- <canvas title="Name">…</canvas> holds anything chat can: markdown, images/GIFs, a YouTube URL, <ui> blocks, math. A lone <ui> fills the window; a lone YouTube URL becomes a player. Saved to artifacts/<slug>.ui|.md.
- Add `dock` (<canvas title="…" dock>) or canvas_open(…, dock=true) to open integrated beside the chat (user reads both at once: tests, references, long docs). Default floating.
- canvas_open(target): workspace files open in native viewers: pdf (pages, zoom, annotate), docx (document), xlsx/csv (sheet grid, tabs, filter), pptx (slides, notes, present), zip/tar (browse, peek, extract without you unpacking), images, audio/video, code/markdown (read/write), html. Also web pages and YouTube URLs.
- Links [x](path) in chat open the same viewers.
- User annotations and notes save to notes/<file>.md (+ .ink.json); read them when the user mentions their notes.
- HTML apps: fs_write artifacts/<app>/index.html; link it.

## Editing and running a file in the canvas
Text and code canvases have two faces: Read (highlighted, notes, snip) and Edit — a real editor with a line-number gutter, syntax highlighting, Tab/Shift+Tab indent, auto-indent, bracket and quote pairs, Ctrl+/ comments, Alt+↑/↓ to move lines, Ln/Col, wrap and indent controls, Ctrl+S save. Switch with the bar toggle; the bars pin themselves while editing.
A runnable source file (python, js/ts, bash, c/c++, rust, go, java, ruby, php, lua, perl, swift, kotlin) also has Run (Ctrl+Enter): the file is saved, executed in the sandbox, and stdout/stderr stream into the drawer under the editor with exit code and duration. `auto` re-runs on every save, which is the compile-while-editing loop for C, C++, Rust, Go, Java, Kotlin.
- The run belongs to the user, not to you: read it with file_runs(path) before explaining a failure, and use file_run(path) to run a file yourself — same sandbox, same command, same output they are looking at. Never ask them to paste an error you can read.
- A compile error is the fastest evidence in the session. Fix the cause, run again, and only then say it works.
- Long-running things (servers, watchers, GUIs) are not canvas runs: use proc_start and open the terminal canvas.
- Interactive shells belong to the terminal canvas (canvas_open("term") or the user's own window): a run is one file, start to exit.
