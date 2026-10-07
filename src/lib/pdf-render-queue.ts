export type PdfRenderJob = {
  run: () => Promise<void>;
  priority: number;
  order: number;
  cancelled: boolean;
  started: boolean;
  finished: boolean;
  done: Promise<void>;
  settle: () => void;
};

/** A small priority queue keeps current-page renders ahead of bounded prefetch work. */
export function createPdfRenderQueue(maxConcurrent: number) {
  const pending: PdfRenderJob[] = [];
  const limit = Number.isFinite(maxConcurrent) ? Math.max(1, Math.floor(maxConcurrent)) : 1;
  let active = 0;
  let order = 0;

  const pump = () => {
    pending.sort((a, b) => a.priority - b.priority || a.order - b.order);
    while (active < limit && pending.length) {
      const job = pending.shift()!;
      if (job.cancelled) { job.finished = true; job.settle(); continue; }
      job.started = true;
      active++;
      void Promise.resolve().then(job.run).catch(() => {}).finally(() => {
        job.finished = true;
        active--;
        job.settle();
        pump();
      });
    }
  };

  const enqueue = (run: () => Promise<void>, priority: number): PdfRenderJob => {
    let settle = () => {};
    const done = new Promise<void>((resolve) => { settle = resolve; });
    const job: PdfRenderJob = { run, priority, order: order++, cancelled: false, started: false, finished: false, done, settle };
    pending.push(job);
    pump();
    return job;
  };

  const cancel = (job: PdfRenderJob | null) => {
    if (!job || job.cancelled || job.finished) return;
    job.cancelled = true;
    if (!job.started) {
      const index = pending.indexOf(job);
      if (index >= 0) pending.splice(index, 1);
      job.finished = true;
      job.settle();
    }
    pump();
  };

  const reprioritize = (job: PdfRenderJob | null, priority: number) => {
    if (!job || job.cancelled || job.started || job.finished || job.priority === priority) return;
    job.priority = priority;
    pump();
  };

  return { enqueue, cancel, reprioritize };
}
