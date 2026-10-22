import { describe, expect, it } from 'vitest';
import {
  markThumbnailStale,
  takeThumbnailStale,
  thumbnailSize,
} from '../../src/editor/thumbnail/render';
import {
  sendThumbnail,
  THUMBNAIL_INTERVAL_MS,
  ThumbnailScheduler,
  type SchedulerClock,
} from '../../src/editor/thumbnail/ThumbnailScheduler';
import { selectionBounds, viewportCellRect } from '../../src/editor/ui/export-source';

/** Manual clock: timers fire on advance(). */
class FakeClock implements SchedulerClock {
  time = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  get pendingTimers(): number {
    return this.timers.length;
  }
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      await flush();
      const next = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.time = next.at;
      next.fn();
    }
    this.time = end;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function setup(options: { failRender?: boolean } = {}) {
  const clock = new FakeClock();
  const uploads: number[] = [];
  const errors: unknown[] = [];
  let renders = 0;
  const scheduler = new ThumbnailScheduler({
    clock,
    send: async () => {
      renders++;
      if (options.failRender === true) throw new Error('no canvas');
      await Promise.resolve();
      uploads.push(clock.now());
    },
    onError: (e) => errors.push(e),
  });
  return { clock, scheduler, uploads, errors, renders: () => renders };
}

describe('ThumbnailScheduler', () => {
  it('sends the first thumbnail at once, then at most once a minute', async () => {
    const { clock, scheduler, uploads } = setup();
    scheduler.saved();
    await clock.advance(0);
    expect(uploads).toEqual([0]);
    // Saves within the minute are folded into one trailing refresh.
    await clock.advance(5_000);
    scheduler.saved();
    await clock.advance(10_000);
    scheduler.saved();
    scheduler.saved();
    expect(uploads).toEqual([0]);
    expect(scheduler.pending).toBe(true);
    await clock.advance(44_999);
    expect(uploads).toEqual([0]);
    await clock.advance(1);
    expect(uploads).toEqual([0, THUMBNAIL_INTERVAL_MS]);
    // Nothing new: no more thumbnails.
    await clock.advance(5 * THUMBNAIL_INTERVAL_MS);
    expect(uploads).toHaveLength(2);
    expect(scheduler.pending).toBe(false);
    // A save long after: at once again.
    scheduler.saved();
    await clock.advance(0);
    expect(uploads).toEqual([0, 60_000, 360_000]);
  });

  it('folds a save during the upload into the next interval', async () => {
    const { clock, scheduler, uploads } = setup();
    scheduler.saved();
    scheduler.saved(); // same tick: still one
    await clock.advance(0);
    expect(uploads).toEqual([0]);
    scheduler.saved();
    await clock.advance(59_999);
    expect(uploads).toEqual([0]);
    await clock.advance(1);
    expect(uploads).toEqual([0, 60_000]);
  });

  it('reports errors and keeps working', async () => {
    const { clock, scheduler, errors, uploads } = setup({ failRender: true });
    scheduler.saved();
    await clock.advance(0);
    expect(errors).toHaveLength(1);
    expect(uploads).toEqual([]);
    expect(scheduler.pending).toBe(false);
  });

  it('flushes a pending thumbnail when leaving, and nothing after', async () => {
    const { clock, scheduler, uploads } = setup();
    scheduler.saved();
    await clock.advance(1_000);
    scheduler.saved();
    expect(clock.pendingTimers).toBe(1);
    await scheduler.dispose({ flush: true });
    expect(uploads).toEqual([0, 1_000]);
    expect(clock.pendingTimers).toBe(0);
    scheduler.saved();
    await clock.advance(120_000);
    expect(uploads).toHaveLength(2);
  });

  it('drops a pending thumbnail when leaving without flush', async () => {
    const { clock, scheduler, uploads } = setup();
    scheduler.saved();
    await clock.advance(1_000);
    scheduler.saved();
    await scheduler.dispose();
    await clock.advance(120_000);
    expect(uploads).toEqual([0]);
  });
});

describe('sendThumbnail', () => {
  function run(failures: unknown[]) {
    const renders: string[] = [];
    const uploads: string[] = [];
    const done = sendThumbnail(
      (maxPx, type) => {
        renders.push(`${maxPx}:${type}`);
        return Promise.resolve(new Blob([type], { type }));
      },
      (image) => {
        uploads.push(image.type);
        const f = failures.shift();
        return f === undefined ? Promise.resolve() : Promise.reject(f);
      },
    );
    return { done, renders, uploads };
  }

  it('sends WebP 512 px', async () => {
    const r = run([]);
    await r.done;
    expect(r.renders).toEqual(['512:image/webp']);
  });

  it.each([413, 415, 422])('falls back once to PNG 256 px after %i', async (status) => {
    const r = run([{ status }]);
    await r.done;
    expect(r.renders).toEqual(['512:image/webp', '256:image/png']);
    expect(r.uploads).toEqual(['image/webp', 'image/png']);
  });

  it('gives up after a second refusal or another error', async () => {
    await expect(run([{ status: 413 }, { status: 413 }]).done).rejects.toEqual({ status: 413 });
    const other = run([{ status: 500 }]);
    await expect(other.done).rejects.toEqual({ status: 500 });
    expect(other.renders).toHaveLength(1);
  });
});

describe('thumbnail size and helpers', () => {
  const grid = (width: number, height: number, cellPx = 70) => ({
    width,
    height,
    cellPx,
    unitLabel: 'ft',
    unitPerCell: 5,
  });

  it('fits the longest side in 512 px without enlarging small maps', () => {
    expect(thumbnailSize(grid(60, 40))).toEqual({ width: 512, height: 341, cellPx: 512 / 60 });
    expect(thumbnailSize(grid(400, 400))).toEqual({ width: 512, height: 512, cellPx: 1.28 });
    expect(thumbnailSize(grid(3, 2, 70))).toEqual({ width: 210, height: 140, cellPx: 70 });
    expect(thumbnailSize(grid(1, 400), 256)).toEqual({ width: 1, height: 256, cellPx: 0.64 });
  });

  it('remembers maps whose thumbnail is stale (once)', () => {
    markThumbnailStale('m9');
    expect(takeThumbnailStale('m9')).toBe(true);
    expect(takeThumbnailStale('m9')).toBe(false);
  });

  it('computes the PNG export areas (selection, visible cells)', () => {
    const g = grid(60, 40, 50);
    expect(selectionBounds(g, [])).toBeNull();
    expect(
      selectionBounds(g, [
        { x: 2, y: 3, w: 4, h: 1 },
        { x: 10, y: 1, w: 2, h: 2 },
      ]),
    ).toEqual({ x: 2, y: 1, w: 10, h: 3 });
    expect(selectionBounds(g, [{ x: 58, y: 38, w: 10, h: 10 }])).toEqual({
      x: 58,
      y: 38,
      w: 2,
      h: 2,
    });
    // 500×300 px at zoom 1, 50 px per cell = 10 × 6 cells around (20, 20).
    expect(viewportCellRect(g, { x: 20, y: 20, zoom: 1 }, { width: 500, height: 300 })).toEqual({
      x: 15,
      y: 17,
      w: 10,
      h: 6,
    });
    expect(
      viewportCellRect(g, { x: 0.5, y: 0.5, zoom: 0.1 }, { width: 1000, height: 1000 }),
    ).toEqual({
      x: 0,
      y: 0,
      w: 60,
      h: 40,
    });
    expect(viewportCellRect(g, { x: -100, y: 0, zoom: 1 }, { width: 100, height: 100 })).toBeNull();
    expect(viewportCellRect(g, { x: 1, y: 1, zoom: 1 }, { width: 0, height: 100 })).toBeNull();
  });
});
