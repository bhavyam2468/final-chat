# Electron desktop app (plain, no framework)
Needs Node ≥ 20. GUI can't be seen in headless environments: test the UI as a web page with browser(), run Electron only on the user's desktop (host_shell), package with electron-builder.

```bash
mkdir -p ~/projects/<name> && cd ~/projects/<name>
npm init -y
npm i -D electron electron-builder
```
package.json (edit with fs_edit): `"main": "main.js"`, scripts `"start": "electron ."`, `"dist": "electron-builder"`, and
```json
"build": { "appId": "com.example.<name>", "productName": "<Name>", "files": ["main.js", "preload.js", "renderer/**"],
  "linux": { "target": "AppImage" }, "mac": { "target": "dmg" }, "win": { "target": "nsis" } }
```
main.js:
```js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
function create() {
  const win = new BrowserWindow({ width: 1100, height: 720, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, "renderer/index.html"));
}
ipcMain.handle("ping", () => "pong");
app.whenReady().then(() => { create(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) create(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
```
preload.js (the only bridge; never expose ipcRenderer wholesale):
```js
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });
```
renderer/: index.html + style.css + app.js exactly like reference/web-static.md; call `await window.api.ping()`.
Add a CSP meta in index.html: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'">`.
Test UI: browser(target="~/projects/<name>/renderer/index.html") (window.api is undefined there; guard with `window.api?.`).
Run on the user's desktop: proc_start(host=true, command="npm start"). Linux headless: `xvfb-run -a npm start` if xvfb is installed.
Package: `npm run dist` → dist/*.AppImage | .dmg | .exe (build for the current OS; cross-building mac needs macOS).
File system/native features live in main.js and are exposed as narrow ipc handlers.
With React: build the renderer with Vite (reference/react-vite.md, `base: "./"` in vite.config.ts) and loadFile("dist/index.html").
