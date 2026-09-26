---
name: design
description: Building web pages and app UIs that look calm and professional, not AI-generated: typography, colour, layout, copy, states; verify with screenshots.
tools: dev
---
Default look: a quiet, well-made tool. Content first. Every element must earn its place.

Hard bans (the automatic check flags these):
- Fonts: novelty/sci-fi faces (Orbitron, Audiowide, Exo, Rajdhani, Oxanium, Press Start, Bebas-style display for body). Web fonts from CDNs in offline apps.
- Colour/effects: neon (#0ff, #f0f, #39ff14…), coloured glows, purple/indigo/pink gradients, gradient text, glassmorphism, animated backgrounds, endless pulsing.
- Copy: "Welcome to…", "Get started", "Unleash/Elevate/Seamless/Supercharge/Next-gen/Stunning/Effortless/Powerful", taglines, hero sections, testimonials, feature grids, "Powered by", "Made with ❤️", exclamation marks, emoji in headings/buttons, lorem ipsum, helper sentences explaining obvious UI ("Enter your name below").

Do instead:
- Type: `font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; mono `ui-monospace, SFMono-Regular, Menlo, monospace`. Sizes 13/15/18/24, weights 400/500/600, line-height 1.5 body. Sentence case everywhere.
- Colour: neutral background (#fafaf9 light / #1c1c1b dark), text #1f1f1e / #e7e5e2, muted #6b6b68, hairline borders rgba(0,0,0,.08). One accent used sparingly (primary button, focus, selection). Status colours muted (green #4d7c55, red #b54a3f, amber #b8862f). Contrast ≥ 4.5:1.
- Shape: one corner radius for everything (6-12px), 1px borders, shadows only for floating layers (menus, dialogs).
- Space: 4px grid (4/8/12/16/24/32). Align to a single left edge; max text width ~70ch; tools use full width with a clear primary region.
- Layout of an app: the working surface on first paint (table, editor, board, form). Navigation minimal. Empty states: one line + the primary action. No splash, no landing page inside an app.
- Components: real controls (button, input, select, table) styled plainly; icons from an SVG set (inline Lucide paths), never emoji. Every interactive element has hover, focus-visible, disabled; async work shows loading and error states.
- Motion: 120-200ms ease-out on state changes only.
- Dark mode via `@media (prefers-color-scheme: dark)` with the same structure.
- Copy: labels are nouns, buttons are verbs ("Add task", "Export CSV"), numbers formatted, dates relative when recent. No sentences where a label will do.

Workflow for a web artifact:
1. artifacts/<name>/index.html (+ style.css, app.js). No external CDNs unless the user is online and asked for a library; persist with localStorage when state matters.
2. check(path="artifacts/<name>") → design lint + screenshot. Look at the screenshot: alignment, spacing, overflow, contrast, empty states. Fix, re-check (max 3 rounds).
3. browser(target, steps=[…]) to exercise the main interaction (click/type) and confirm no console errors; width=390 for mobile.
4. Link the result: [name](artifacts/<name>/index.html) alone on a line.
Frameworks (React, Electron…) → skill build.
