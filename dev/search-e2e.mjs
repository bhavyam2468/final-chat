import assert from 'node:assert/strict';
import { launch } from './browser.mjs';
const base = process.argv[2] || 'http://127.0.0.1:3000';
await fetch(base + '/api/dev', { method: 'POST', body: JSON.stringify({ mock: true }) });
const browser = await launch();
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__dev);
  assert.ok(await page.$('.dock.centered'), 'landing is search-first with centered composer');
  await page.click('.dock textarea'); await page.type('.dock textarea', 'search orbital mechanics official docs');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.dock button[aria-label="Stop"]');
  await page.waitForFunction(() => !document.querySelector('.dock button[aria-label="Stop"]'), { timeout: 60000 });
  await page.waitForSelector('main .srcs .src');
  assert.ok(!(await page.$('.dock.centered')), 'composer moves down after first query');
  assert.equal(await page.$$eval('main .tool', (e) => e.length), 0, 'finished history is a clean answer, not tool chatter');
  const items = await fetch(base + '/api/conversations').then((r) => r.json());
  const search = items.find((c) => c.title.includes('search orbital mechanics'));
  assert.equal(search.mode, 'search');
  const original = await fetch(`${base}/api/conversations/${search.id}`).then((r) => r.json());
  const answer = original.messages.find((m) => m.role === 'assistant');
  assert.ok(answer.parts.some((p) => p.type === 'tool'), 'trace retained internally for lossless promotion');
  await page.click('.search-mode button');
  await page.waitForFunction(() => !document.querySelector('.search-mode'));
  const promoted = await fetch(`${base}/api/conversations/${search.id}`).then((r) => r.json());
  assert.equal(promoted.conversation.state.mode, 'chat');
  assert.deepEqual(promoted.messages, original.messages, 'promotion preserves message IDs, branches, attachments and trace');
  // Reopening a just-finished run replays from zero, not on top of its persisted answer.
  await page.click('[aria-label="New chat"]'); await page.click('[aria-label="Chats"]');
  await page.waitForSelector('.lstack .li');
  await page.evaluate(() => [...document.querySelectorAll('.lstack .li')].find((e) => e.textContent.includes('search orbital mechanics')).click());
  await page.waitForFunction(() => !document.querySelector('.dock [aria-label="Stop"]'));
  await page.waitForFunction(() => document.querySelector('main.column')?.textContent.includes('orbital'));
  assert.equal(await page.$$eval(`main [data-mid="${answer.id}"]`, (e) => e.length), 1, 'finished answer is not duplicated');
  // Same conversation, simultaneous tabs/requests: only one accepted.
  const user = promoted.messages.at(-1).id;
  const responses = await Promise.all([1, 2].map(() => fetch(base + '/api/chat', { method: 'POST', body: JSON.stringify({ conversationId: search.id, parentId: user, user: { content: 'longtext please' } }) })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  await fetch(base + '/api/chat', { method: 'POST', body: JSON.stringify({ stop: true, conversationId: search.id }) });
  await Promise.all(responses.map((r) => r.text()));
  assert.deepEqual(errors, []);
  console.log('PASS search landing, source cards, clean history, promotion, replay, simultaneous request exclusion');
} finally { await browser.close(); }
