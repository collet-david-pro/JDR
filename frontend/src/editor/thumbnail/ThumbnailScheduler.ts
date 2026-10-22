/**
 * Map thumbnail refresh (P4c, projet.md 9.2 `PUT /maps/{id}/thumbnail`, 18.1 p.3): after a
 * confirmed save, a thumbnail (≤ 512 px) is rendered and sent — at most once every 60 s. Saves
 * confirmed meanwhile are folded into one trailing refresh at the end of the interval.
 * Leaving the editor sends the pending refresh at once (last state of the Maps tab card).
 */

export const THUMBNAIL_INTERVAL_MS = 60_000;
export const THUMBNAIL_PX = 512;
/** Second attempt after a refusal of the image (413 too large, 415 type, 422 unreadable). */
export const THUMBNAIL_FALLBACK_PX = 256;
const REFUSED_IMAGE = new Set([413, 415, 422]);

export type ThumbnailRender = (maxPx: number, type: 'image/webp' | 'image/png') => Promise<Blob>;

/**
 * Renders and sends a thumbnail: WebP 512 px, then once PNG 256 px when the server refuses the
 * image (413 / 415 / 422). Other failures are thrown.
 */
export async function sendThumbnail(
  render: ThumbnailRender,
  upload: (image: Blob) => Promise<unknown>,
): Promise<void> {
  try {
    await upload(await render(THUMBNAIL_PX, 'image/webp'));
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status !== 'number' || !REFUSED_IMAGE.has(status)) throw error;
    await upload(await render(THUMBNAIL_FALLBACK_PX, 'image/png'));
  }
}

export interface SchedulerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface ThumbnailSchedulerOptions {
  /** Renders the current map and sends it (see sendThumbnail). */
  readonly send: () => Promise<unknown>;
  readonly interval?: number;
  readonly clock?: SchedulerClock;
  readonly onError?: (error: unknown) => void;
}

export class ThumbnailScheduler {
  private readonly interval: number;
  private readonly clock: SchedulerClock;
  private lastStart = -Infinity;
  private dirty = false;
  private running: Promise<void> | null = null;
  private timer: unknown = null;
  private disposed = false;

  constructor(private readonly options: ThumbnailSchedulerOptions) {
    this.interval = options.interval ?? THUMBNAIL_INTERVAL_MS;
    this.clock = options.clock ?? realClock;
  }

  /** A refresh is waiting (timer or in progress). */
  get pending(): boolean {
    return this.dirty || this.running !== null;
  }

  /** A save was confirmed by the server: the thumbnail is out of date. */
  saved(): void {
    if (this.disposed) return;
    this.dirty = true;
    this.kick();
  }

  /** Stops; with `flush`, a pending refresh is sent at once (leaving the editor). */
  dispose(options: { flush?: boolean } = {}): Promise<void> {
    if (this.disposed) return this.running ?? Promise.resolve();
    this.disposed = true;
    this.clearTimer();
    if (options.flush === true && this.dirty && this.running === null) return this.run();
    return this.running ?? Promise.resolve();
  }

  private kick(): void {
    if (this.disposed || this.running !== null || this.timer !== null || !this.dirty) return;
    const wait = this.lastStart + this.interval - this.clock.now();
    if (wait <= 0) {
      void this.run();
      return;
    }
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.kick();
    }, wait);
  }

  private run(): Promise<void> {
    this.dirty = false;
    this.lastStart = this.clock.now();
    const job = (async () => {
      try {
        await this.options.send();
      } catch (error) {
        this.options.onError?.(error);
      }
    })();
    this.running = job.finally(() => {
      this.running = null;
      this.kick();
    });
    return this.running;
  }

  private clearTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
