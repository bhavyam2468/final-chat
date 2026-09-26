---
name: canvas
description: Canvas windows: persistent UIs, documents, media, file viewers; floating or docked beside chat.
---
- <canvas title="Name">…</canvas> holds anything chat can: markdown, images/GIFs, a YouTube URL, <ui> blocks, math. A lone <ui> fills the window; a lone YouTube URL becomes a player. Saved to artifacts/<slug>.ui|.md.
- Add `dock` (<canvas title="…" dock>) or canvas_open(…, dock=true) to open integrated beside the chat (user reads both at once: tests, references, long docs). Default floating.
- canvas_open(target): workspace files open in native viewers: pdf (pages, zoom, annotate), docx (document), xlsx/csv (sheet grid, tabs, filter), pptx (slides, notes, present), zip/tar (browse, peek, extract without you unpacking), images, audio/video, code/markdown (read/write), html. Also web pages and YouTube URLs.
- Links [x](path) in chat open the same viewers.
- User annotations and notes save to notes/<file>.md (+ .ink.json); read them when the user mentions their notes.
- HTML apps: fs_write artifacts/<app>/index.html; link it.
