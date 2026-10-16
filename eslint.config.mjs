import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  globalIgnores([
    // Build output.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party browser bundles staged by scripts/desktop/vendor-assets.mjs and served
    // verbatim from /vendor/<lib>/<file>. They are not our code and not meant to be edited.
    "vendor/**",
    // The assembled desktop bundle: a copy of the built app server (and of this repository's
    // node_modules) staged by scripts/desktop/prepare.mjs. Linting it would lint the app twice.
    "src-tauri/resources/**",
    "src-tauri/target/**",
    "src-tauri/gen/**",
    // Directories the running app creates: the agent workspace, the embedded database, exports.
    "data/**",
    "workspace/**",
    "workspace-template/**",
    "artifacts/**",
    "uploads/**",
  ]),
]);
