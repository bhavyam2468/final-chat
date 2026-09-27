import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeRun, attach, reserveRun, startRun, stopRun } from '../../src/lib/runs';
import { validateArgs } from '../../src/lib/tools/validate';
import { spawnRun } from '../../src/lib/exec';

const events = async (s: ReadableStream) => (await new Response(s).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('one conversation reservation before async work; other conversations independent', () => {
  const release = reserveRun('a'); assert.ok(release);
  assert.equal(reserveRun('a'), null);
  const other = reserveRun('b'); assert.ok(other); other(); release();
  const again = reserveRun('a'); assert.ok(again); again();
});
test('detach only removes the viewer, explicit Stop affects only its conversation', async () => {
  const a = startRun('a', 'answer-a'), b = startRun('b', 'answer-b');
  const ctrl = new AbortController(); const s = attach(a.run, ctrl.signal);
  a.emit({ t: 'text', d: 'partial' }); ctrl.abort();
  assert.equal(a.run.listeners.size, 0); assert.equal(a.signal.aborted, false);
  assert.equal(stopRun('a'), true); assert.equal(a.signal.aborted, true); assert.equal(b.signal.aborted, false);
  a.finish(); b.finish(); assert.equal(activeRun('a'), undefined);
  assert.equal((await events(s))[0].d, 'partial');
});
test('finished replay has one done and bounded stdout; text is coalesced in order', async () => {
  const a = startRun('replay', 'answer');
  a.emit({ t: 'meta', assistantId: 'answer' });
  for (let i = 0; i < 100; i++) a.emit({ t: 'text', d: 'x' });
  a.emit({ t: 'tool', id: 'tool', name: 'shell', args: {} });
  for (let i = 0; i < 100; i++) a.emit({ t: 'toolOutput', id: 'tool', chunk: 'y'.repeat(100) });
  a.finish(); a.finish(); a.emit({ t: 'text', d: 'too late' });
  const out = await events(attach(a.run, new AbortController().signal));
  assert.equal(out.length, 5); assert.equal(out[1].d, 'x'.repeat(100));
  assert.equal(out[3].chunk.length, 6000); assert.equal(out.at(-1).t, 'done');
});
test('already aborted attachment does not leak listeners', async () => {
  const a = startRun('gone', 'answer'); const c = new AbortController(); c.abort();
  await events(attach(a.run, c.signal)); assert.equal(a.run.listeners.size, 0); a.finish();
});
test('tool schemas reject missing fields, malformed objects, coercions and unsupported browser steps', () => {
  const schema = { type: 'object', properties: { path: { type: 'string' }, host: { type: 'boolean' }, steps: { type: 'array', items: { type: 'object', properties: { click: { type: 'string' } } } } }, required: ['path'] };
  assert.match(validateArgs(schema, {})!, /path is required/);
  assert.match(validateArgs(schema, null)!, /must be object/);
  assert.match(validateArgs(schema, [])!, /must be object/);
  assert.match(validateArgs(schema, { path: 'a', host: 'True' })!, /must be boolean/);
  assert.match(validateArgs(schema, { path: 'a', steps: [{ type: 'click' }] })!, /not supported/);
  assert.equal(validateArgs(schema, { path: 'a', host: true, steps: [{ click: 'button' }] }), null);
});
test('cancellation before spawn never executes code', async () => {
  const c = new AbortController(); c.abort();
  const out = await spawnRun('bash', ['-c', 'echo MUST_NOT_RUN'], { cwd: process.cwd(), env: process.env, timeout: 2000, signal: c.signal });
  assert.equal(out.code, 130); assert.ok(!out.out.includes('MUST_NOT_RUN'));
});
test('Stop kills child process group and streams output before completion', async () => {
  const c = new AbortController(); let streamed = '';
  const start = Date.now();
  const result = await spawnRun('bash', ['-c', 'echo ready; sleep 30 & wait'], { cwd: process.cwd(), env: process.env, timeout: 10000, signal: c.signal, onData: (s) => { streamed += s; c.abort(); } });
  assert.match(streamed, /ready/); assert.equal(result.code, 130); assert.ok(Date.now() - start < 5000);
});
