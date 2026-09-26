# React + TypeScript (Vite)
Needs Node ≥ 20 (`node -v`). Install: nvm (`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`, then `nvm install --lts`) or the OS package manager.

Scaffold (non-interactive; stdin is closed so prompts take defaults):
```bash
npm create vite@latest <name> -- --template react-ts
cd <name> && npm install
```
Run: proc_start(name="<name>", command="npm run dev -- --host 0.0.0.0 --port 5173", cwd="<dir>") → proc_logs(name, wait_for="port") → browser("http://localhost:5173").
Build: `npm run build` (runs tsc -b then vite build → dist/). Preview build: `npx vite preview --port 4173`.
Checks: check(path) runs tsc + eslint (template ships eslint.config.js).

First edits (remove template demo):
- src/App.tsx: replace the whole component with the real app.
- delete src/assets/react.svg, public/vite.svg usage, and the counter demo CSS in src/App.css / src/index.css (replace with the design base: system font, neutral colours).
- index.html <title>.

Structure as it grows: src/components/*.tsx, src/lib/*.ts (pure logic, testable), src/hooks/*.ts.
State: useState/useReducer; persistent state via a small useLocalStorage hook. Data fetching: fetch + useEffect with AbortController, or TanStack Query when many endpoints.
Routing (only if needed): `npm i react-router` (v7: `import { BrowserRouter, Routes, Route } from "react-router"`).
Tests: `npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom`; add `"test": "vitest run"`; in vite.config.ts `test: { environment: "jsdom" }` with `/// <reference types="vitest/config" />` at the top.
Tailwind (only if asked): `npm i -D tailwindcss @tailwindcss/vite`, add `tailwindcss()` to plugins, `@import "tailwindcss";` in src/index.css.
Common errors: "Cannot find module" → check import path/case; type errors in JSX → props interface; blank page → browser() console errors.
