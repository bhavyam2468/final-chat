import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { APP_ROOT } from "@/lib/paths";

/**
 * Developer-mode helpers live in `dev/` so they are never part of the app's own code.
 *
 * They still have to work in the desktop bundle, where the project tree is not shipped: the two
 * files that are *features* (the mock model `dev/mock-llm.mjs` and the sample-file generator
 * `dev/samples.py`) are copied into the bundle next to the server by
 * scripts/desktop/prepare.mjs, and this resolves them in both layouts.
 */
export function devFile(name: string): string | null {
  const candidates = [path.join(APP_ROOT, "dev", name), path.join(process.cwd(), "dev", name)];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

/** `file://` URL for a bundled dev module (dev/mock-llm.mjs), or null when it is not shipped. */
export function devFileUrl(name: string): string | null {
  const file = devFile(name);
  if (!file) return null;
  // A file URL on purpose: import() of a path string is not portable, and this module is a
  // developer-mode sidecar rather than part of the server bundle.
  return pathToFileURL(file).href;
}
