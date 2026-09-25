# Design philosophy — "Quiet Paper"

The interface is a desk, not a dashboard. The only loud thing on screen is the content.

1. **One radius.** `--r: 12px` everywhere: bubbles, inputs, panels, canvases, code, buttons, Blocks. Nothing is a pill, nothing is sharp.
2. **Two surfaces.** Page (`--bg`) and a single raised tone (`--surface` / `--bubble`). No third level, no drop shadows beyond one ultra-diffuse float shadow for floating things (panels, canvases).
3. **Warm monochrome.** Light: warm paper `#f2eee6` + film grain. Dark: charcoal `#1f1e1c` (never #000) + fainter grain. One muted accent (terracotta), used for focus, highlights, live state only.
4. **Distinction by space, not chrome.** User = right-aligned bubble. Assistant = plain text on the page. No avatars, names, labels, or hints.
5. **Nothing until needed.** Actions appear on hover/focus. Empty states are empty. No placeholders, no helper text, no keyboard hints.
6. **Typography carries hierarchy.** Geist 15.5/1.7 body, measure ≤ 68ch, headings by weight and size (not color), tabular numbers, Geist Mono for code.
7. **Motion explains state.** Streaming content fades up; finished blocks never re-render; highlights sweep in after they close; charts draw in; windows scale in. 120–450ms, ease-out, no bounce.
8. **Keyboard first.** Typing anywhere writes into the composer. Backspace on empty releases focus. `/` commands, `@` files, `Esc` closes.

Spacing scale: 4 · 8 · 12 · 16 · 24 · 32 · 48. Type scale: 12 · 13 · 15.5 · 18 · 22 · 28.
