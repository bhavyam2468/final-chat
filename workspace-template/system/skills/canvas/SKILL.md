---
name: canvas
description: Canvas windows: persistent UIs, documents, media, file viewers; docked beside chat by default, or floating.
---
- <canvas title="Name">…</canvas> holds anything chat can: markdown, images/GIFs, a YouTube URL, <ui> blocks, math. A lone <ui> fills the window; a lone YouTube URL becomes a player. Saved to artifacts/<slug>.ui|.md.
- Canvases open docked beside the chat by default (user reads both at once: tests, references, long docs). The sidebar holds one canvas — a new one displaces the current occupant into the minimize rail. Use `dock="false"` on <canvas> or canvas_open(…, dock=false) to open floating instead (side-by-side windows, comparing two things).
- The user manages windows by hand: drag to move, pull an edge to resize, drag to a screen edge to park it, minimize to the rail. Never narrate window mechanics — just open content.
- canvas_open(target): workspace files open in native viewers: pdf (pages, zoom, select text to quote-with-context or highlight, annotate), docx (document), xlsx/csv (sheet grid, tabs, filter), pptx (slides, notes, present), zip/tar (browse, peek, extract without you unpacking), images, audio/video, code/markdown (read/write), html. Also web pages and YouTube URLs.
- Links [x](path) in chat open the same viewers.
- When the user quotes PDF text in chat, the quote carries the file, page and surrounding text — use it as ground truth before re-reading the file.
- User annotations, highlights and notes save to notes/<file>.md (+ .ink.json, + .hl.json); read them when the user mentions their notes.
- HTML apps: fs_write artifacts/<app>/index.html; link it.
