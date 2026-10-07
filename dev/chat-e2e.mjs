// e2e for the chat shell: independent chats (switch/reload mid-stream), Stop keeps partial, per-chat drafts,
// paste-anywhere, live tool output. Needs the app running with DEV_MODE=1 (mock model is enabled here).
// Usage: node dev/chat-e2e.mjs [baseUrl]   (screenshots go to /tmp/chat-*.png)

async function launch() {
  const req = (await import("node:module")).createRequire(import.meta.url);
  let puppeteer; try { puppeteer = req("puppeteer-core"); } catch { puppeteer = req("/tmp/shot/node_modules/puppeteer-core"); }
  let exe = process.env.CHROME, args = [];
  if (!exe) {
    process.env.AWS_EXECUTION_ENV ||= "AWS_Lambda_nodejs22.x";
    // @sparticuz/chromium has moved its entry point between majors: try each known one, and both export shapes
    const m = await import("/tmp/shot/node_modules/@sparticuz/chromium/build/index.js")
      .catch(() => import("/tmp/shot/node_modules/@sparticuz/chromium/build/esm/index.js"));
    const c = (m.default && m.default.default) || m.default || m;
    exe = await c.executablePath(); args = c.args;
  }
  return puppeteer.launch({ executablePath: exe, args, headless: true, defaultViewport: { width: 900, height: 700 } });
}
const B = process.argv[2] || 'http://127.0.0.1:3000';
await fetch(B + '/api/dev', { method: 'POST', body: JSON.stringify({ enable: true }) }); await fetch(B + '/api/dev', { method: 'POST', body: JSON.stringify({ mock: true }) });
const b = await launch(); const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 800 });
const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A distinctive first message: several chats in a used workspace share a plain title, and a test that finds
// its chat by the word "longtext" will find someone else's. The mock keys off "longtext" either way.
const mark = 'longtext ' + Date.now().toString(36).slice(-4);
const ok = []; const bad = [];
const check = (name, cond, extra = '') => { (cond ? ok : bad).push(name + (extra ? ' :: ' + extra : '')); };
const ta = '.dock textarea';
const type = async (t) => { await pg.click(ta); await pg.type(ta, t); };
const stopBtn = () => pg.$('.dock button[aria-label="Stop"]');
// the chat that is streaming is the one with the live dot (its title only arrives when the turn ends)
const clickStreaming = () => pg.evaluate(() => {
  const rows = [...document.querySelectorAll('.lstack .li')];
  const row = rows.find((e) => e.querySelector('.live-dot')) || rows.find((e) => /longtext/.test(e.innerText)) || rows[0];
  row?.click();
});
const clickNewest = () => pg.evaluate(() => document.querySelector('.lstack .li')?.click());
const clickRowWith = (text) => pg.evaluate((t) => [...document.querySelectorAll('.lstack .li')].find((e) => e.innerText.includes(t))?.click(), text);
/** A named chat can be in either tab (General is where "New chat" puts things); find it, then open it. */
async function openRowByText(text) {
  for (const tab of ['Chats', 'General']) {
    await tabTo(tab); await sleep(350);
    if (await pg.evaluate((t) => [...document.querySelectorAll('.lstack .li')].some((e) => e.innerText.includes(t)), text)) break;
  }
  await clickRowWith(text);
}
/** Wait for something to become true, up to `ms` — the panel refreshes on its own schedule. */
async function until(ms, f) { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(250); } return false; }
const colText = () => pg.$eval('main.column', (e) => e.innerText).catch(() => '');

await pg.goto(B, { waitUntil: 'networkidle2' });
// A: long answer streaming. Start from a fresh chat (the app restores the last view, and a test that types
// into whatever was open cannot tell which chat it is looking at).
await pg.click('button[aria-label="New chat"]'); await sleep(400);
await type(mark); await pg.keyboard.press('Enter');
await sleep(1500);
check('A streaming shows Stop', !!(await stopBtn()));
// new chat mid-stream
await pg.click('button[aria-label="New chat"]'); await sleep(300);
check('new chat: composer not stuck on Stop', !(await stopBtn()));
check('new chat: empty column', (await colText()).trim() === '', (await colText()).slice(0, 80));
// draft in the new chat, then send B
await type('draft for new chat'); await sleep(200);
// switch back to A via Chats panel
await pg.click('button[aria-label="Chats"]'); await sleep(600);
// the panel opens on the tab of the current chat; a chat started from "New chat" is a General chat, so the
// streaming one can be in either tab — look in both, then click it
const tabTo = (name) => pg.evaluate((n) => { const b = [...document.querySelectorAll('.panel-head [role="tab"]')].find((x) => x.innerText.trim() === n); b?.click(); }, name);
async function openStreamingRow() {
  let dotted = await until(2500, async () => (await pg.$('.lstack .live-dot')) !== null);
  for (const tab of ['General', 'Chats']) {
    if (dotted) break;
    await tabTo(tab);
    dotted = await until(6000, async () => (await pg.$('.lstack .live-dot')) !== null);
  }
  await clickStreaming();
  return dotted;
}
const dotted = await openStreamingRow();
const items = await pg.$$eval('.lstack .li', (els) => els.map((e) => e.innerText));
check('chats list has A with live dot', dotted, items.slice(0, 6).join('|'));
await clickStreaming();
await sleep(900);
const t1 = await colText();
check('back to A: shows partial (not empty)', t1.includes('Streaming check'), t1.slice(0, 80));
check('back to A: Stop visible', !!(await stopBtn()));
check('A composer empty (draft belongs to new chat)', (await pg.$eval(ta, (e) => e.value)) === '');
let t2 = t1; for (let i = 0; i < 20 && t2.length <= t1.length; i++) { await sleep(500); t2 = await colText(); } // the mock pauses randomly
check('A keeps growing live', t2.length > t1.length, `${t1.length} -> ${t2.length}`);
// a fresh long answer, so the reload lands in the middle of one (the first may have finished by now)
await type(mark); await pg.keyboard.press('Enter');
await until(5000, async () => !!(await stopBtn()));
// reload mid-stream and re-open A
await pg.reload({ waitUntil: 'networkidle2' });
await pg.click('button[aria-label="Chats"]').catch(() => {}); await sleep(600);
if (!(await pg.$('.lstack .li'))) { await pg.click('button[aria-label="Chats"]'); await sleep(500); }
await openStreamingRow();
await sleep(1000);
const t3 = await colText();
check('after reload: re-attached (partial visible)', t3.includes('Streaming check'), t3.slice(0, 60));
check('after reload: Stop visible', !!(await stopBtn()));
// stop keeps partial
const before = (await colText()).length;
const sb = await stopBtn(); if (sb) await sb.click();
await sleep(1800);
const after = await colText();
check('stop keeps partial', after.includes('Streaming check') && after.length >= before * 0.8, `${before} -> ${after.length}`);
check('stop: composer back to send', !(await stopBtn()));
await pg.screenshot({ path: '/tmp/chat-stop.png' });
// the draft of the unsent new chat survives reload? (new-chat drafts are keyed per page view; saved chats persist)
await type('draft A'); await sleep(200);
await pg.click('button[aria-label="New chat"]'); await sleep(300);
await openRowByText(mark);   // A has its title by now
await sleep(700);
check('draft restored after switch', (await pg.$eval(ta, (e) => e.value)) === 'draft A', await pg.$eval(ta, (e) => e.value));
await pg.reload({ waitUntil: 'networkidle2' });
if (!(await pg.$('.lstack .li'))) { await pg.click('button[aria-label="Chats"]'); await sleep(500); }
await openRowByText(mark);
await sleep(700);
const back = await pg.$eval(ta, (e) => e.value);
check('draft restored after reload', back === 'draft A', `${JSON.stringify(back)} :: rows=${(await pg.$$eval('.lstack .li', (els) => els.slice(0, 3).map((e) => e.innerText.replace(/\n/g, ' ').slice(0, 24)))).join('|')}`);
await pg.$eval(ta, (e) => e.blur());
// paste anywhere
await pg.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', ' pasted!'); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
await sleep(200);
check('paste anywhere goes to composer', (await pg.$eval(ta, (e) => e.value)).includes('pasted!') && (await pg.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA', await pg.$eval(ta, (e) => e.value));
await pg.$eval(ta, (e) => { e.value = ''; });
// live python output
await pg.click('button[aria-label="New chat"]'); await sleep(300);
await type('slowpy'); await pg.keyboard.press('Enter');
await sleep(3200);
const live = await pg.$eval('.tool-body pre.live-out', (e) => e.innerText).catch(() => null);
check('python: live output visible while running', !!live && live.includes('step'), String(live));
await pg.screenshot({ path: '/tmp/chat-live.png' });
await sleep(6000);
check('python: folded after done', !(await pg.$('.tool-body pre.live-out')));
console.log('PASS', ok.length); ok.forEach((x) => console.log('  ok  ', x));
console.log('FAIL', bad.length); bad.forEach((x) => console.log('  FAIL', x));
console.log('page errors', errs.slice(0, 5));
await b.close();
process.exit(bad.length ? 1 : 0);
