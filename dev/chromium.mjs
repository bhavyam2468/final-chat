import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
/** Set CHROME to a local browser, or CHROMIUM_MODULE to a serverless Chromium module. */
export async function launch() {
  const puppeteer = require("puppeteer-core");
  let executablePath = process.env.CHROME, args = ["--no-sandbox", "--disable-dev-shm-usage"];
  if (!executablePath) {
    process.env.AWS_EXECUTION_ENV ||= "AWS_Lambda_nodejs22.x";
    let modulePath = process.env.CHROMIUM_MODULE;
    if (!modulePath) { try { modulePath = require.resolve("@sparticuz/chromium"); } catch { modulePath = path.resolve("node_modules/.blocks-review/@sparticuz/chromium/build/index.js"); } }
    const chromium = (await import(modulePath)).default;
    executablePath = await chromium.executablePath(); args = chromium.args;
  }
  return puppeteer.launch({ executablePath, args, headless: true, defaultViewport: { width: 1280, height: 900 } });
}
