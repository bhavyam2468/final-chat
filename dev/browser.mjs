import puppeteer from 'puppeteer-core';
export async function launch() {
  let executablePath = process.env.CHROME;
  let args = [];
  if (!executablePath) {
    process.env.AWS_EXECUTION_ENV ||= "AWS_Lambda_nodejs22.x";
    const { default: chromium } = await import('@sparticuz/chromium');
    executablePath = await chromium.executablePath();
    args = chromium.args;
  }
  return puppeteer.launch({ executablePath, args, headless: true, defaultViewport: { width: 900, height: 700 } });
}
