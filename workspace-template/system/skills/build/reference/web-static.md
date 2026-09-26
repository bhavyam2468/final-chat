# Web app as static files
Works offline, opens by double-click, no build step. Default when there is no toolchain.

Layout: artifacts/<name>/index.html, style.css, app.js (ES modules via `<script type="module" src="app.js">`).

index.html skeleton:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Budget</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main id="app"></main>
  <script type="module" src="app.js"></script>
</body>
</html>
```
style.css base:
```css
:root { --bg:#fafaf9; --fg:#1f1f1e; --muted:#6b6b68; --line:rgba(0,0,0,.08); --accent:#2f5d8a; --r:8px;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
@media (prefers-color-scheme: dark) { :root { --bg:#1c1c1b; --fg:#e7e5e2; --muted:#9a9894; --line:rgba(255,255,255,.09); --accent:#8fb3d9; } }
* { box-sizing: border-box; } body { margin: 0; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
button, input, select, textarea { font: inherit; color: inherit; border: 1px solid var(--line); border-radius: var(--r); padding: 7px 10px; background: transparent; }
button { cursor: pointer; } button.primary { background: var(--fg); color: var(--bg); border-color: transparent; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); }
```
State: keep one `state` object, `render()` rebuilds the view, persist with
`localStorage.setItem("app:<name>", JSON.stringify(state))`; load with a try/catch default.
Escape user text before inserting HTML (textContent, or a small esc()).
Libraries: only if needed and the user is online (CDN); otherwise vendor the file into the folder.
Verify: check(path="artifacts/<name>") then browser(target="artifacts/<name>", steps=[{type:"#name",text:"x"},{click:"button.primary"}]).
