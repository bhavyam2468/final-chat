---
name: canvas
description: Floating canvases and artifacts: persistent UIs, web apps, documents, media the user keeps open.
---
- <canvas title="Pomodoro"><ui>...</ui></canvas> -> saved as artifacts/<slug>.ui, listed in Artifacts, opens as resizable floating window. Blocks inside auto-adapt to portrait/landscape.
- Canvas can also wrap markdown or a YouTube URL: <canvas title="Lecture">https://youtu.be/ID</canvas>
- HTML apps: fs_write artifacts/<app>/index.html (+css/js). Self-contained, CDN libs ok. Link it: [Open app](artifacts/<app>/index.html). User can view preview/code.
- Any workspace file link [x](path) opens in a canvas: pdf viewer, image, markdown read/write, code editor. User can annotate PDFs/images/pages; annotations and notes save to notes/<file>.md — read them when user refers to their notes.
