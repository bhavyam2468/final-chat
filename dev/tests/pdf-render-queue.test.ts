// Run: node --experimental-strip-types dev/tests/pdf-render-queue.test.ts
import assert from "node:assert/strict";
import { createPdfRenderQueue } from "../../src/lib/pdf-render-queue.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function main() {
  const queue = createPdfRenderQueue(2);
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  let active = 0, peak = 0;
  const task = (name: string) => async () => {
    started.push(name);
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.set(name, resolve));
    active--;
  };
  const release = (name: string) => {
    const done = releases.get(name);
    assert.ok(done, `${name} should have started before it is released`);
    releases.delete(name);
    done();
  };

  const first = queue.enqueue(task("first"), 0);
  const second = queue.enqueue(task("second"), 0);
  await flush();
  assert.deepEqual(started, ["first", "second"]);

  const far = queue.enqueue(task("far"), 3);
  const near = queue.enqueue(task("near"), 2);
  const moving = queue.enqueue(task("moving"), 5);
  const current = queue.enqueue(task("current"), 0);
  queue.reprioritize(moving, 1);
  const stale = queue.enqueue(task("stale"), 1);
  queue.cancel(stale);
  assert.equal(stale.finished, true);
  await stale.done;

  release("first");
  await first.done;
  await flush();
  assert.equal(started[2], "current", "the visible page overtakes queued prefetches");

  release("second");
  await second.done;
  await flush();
  assert.equal(started[3], "moving", "a queued page is reprioritized as the user scrolls");

  queue.cancel(far);
  assert.equal(far.finished, true);
  await far.done;
  release("current");
  await current.done;
  await flush();
  assert.equal(started[4], "near");
  release("moving");
  await moving.done;
  await flush();
  release("near");
  await near.done;

  assert.deepEqual(started, ["first", "second", "current", "moving", "near"]);
  assert.equal(peak, 2, "render concurrency never exceeds the configured limit");
  console.log("pdf-render-queue.test: priority, reprioritization, cancellation, and concurrency ok");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
