/**
 * Preloading of the assets of the current map (projet.md 11.5): every signed URL of
 * `GET /sessions/{id}/preload` is downloaded (progress in bytes) and the images are decoded;
 * the lobby then sends `ready`. A failing asset is counted, never blocks the player, and the
 * whole preload can be tried again.
 */
import type { Preload, PreloadAsset } from '../types';

export interface PreloadProgress {
  readonly status: 'idle' | 'loading' | 'done' | 'error';
  /** Assets finished (downloaded or failed). */
  readonly done: number;
  readonly total: number;
  readonly loadedBytes: number;
  readonly totalBytes: number;
  /** Assets that failed (download or decoding). */
  readonly errors: number;
  /** The preload request itself failed (status `error`). */
  readonly error: unknown;
}

export interface PreloadHost {
  preload(signal: AbortSignal): Promise<Preload>;
  /** Downloads an asset; `onBytes` receives the bytes read since the last call. */
  download(asset: PreloadAsset, signal: AbortSignal, onBytes: (n: number) => void): Promise<Blob>;
  /** Decodes an image (throws when it is not one). */
  decode(blob: Blob, asset: PreloadAsset): Promise<void>;
}

export const PRELOAD_CONCURRENCY = 4;

const IDLE: PreloadProgress = {
  status: 'idle',
  done: 0,
  total: 0,
  loadedBytes: 0,
  totalBytes: 0,
  errors: 0,
  error: null,
};

export class Preloader {
  private progress: PreloadProgress = IDLE;
  private abort: AbortController | null = null;
  private run = 0;

  constructor(
    private readonly host: PreloadHost,
    private readonly onChange: (progress: PreloadProgress) => void,
  ) {}

  get current(): PreloadProgress {
    return this.progress;
  }

  /** Starts (or starts again) the preload. */
  start(): Promise<void> {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const id = ++this.run;
    this.set({ ...IDLE, status: 'loading' });
    return this.load(abort.signal, id);
  }

  stop(): void {
    this.run++;
    this.abort?.abort();
    this.abort = null;
  }

  private set(next: PreloadProgress): void {
    this.progress = next;
    this.onChange(next);
  }

  private async load(signal: AbortSignal, id: number): Promise<void> {
    let list: Preload;
    try {
      list = await this.host.preload(signal);
    } catch (error) {
      if (id === this.run) this.set({ ...IDLE, status: 'error', error });
      return;
    }
    if (id !== this.run) return;
    const assets = list.assets;
    let done = 0;
    let errors = 0;
    let loaded = 0;
    const total = Math.max(
      list.total_bytes,
      assets.reduce((n, a) => n + a.bytes, 0),
    );
    const update = (status: PreloadProgress['status']): void => {
      if (id !== this.run) return;
      this.set({
        status,
        done,
        total: assets.length,
        loadedBytes: Math.min(loaded, total),
        totalBytes: total,
        errors,
        error: null,
      });
    };
    update(assets.length === 0 ? 'done' : 'loading');
    if (assets.length === 0) return;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (id === this.run && next < assets.length) {
        const asset = assets[next++]!;
        let counted = 0;
        try {
          const blob = await this.host.download(asset, signal, (n) => {
            counted += n;
            loaded += n;
            update('loading');
          });
          await this.host.decode(blob, asset);
        } catch {
          if (id !== this.run) return;
          errors++;
        }
        // An asset smaller or larger than announced: the bar follows the announced sizes.
        loaded += Math.max(0, asset.bytes - counted);
        done++;
        update('loading');
      }
    };
    await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, assets.length) }, worker));
    update('done');
  }
}

/** Browser implementation: fetch with a byte counter, `createImageBitmap` for the images. */
export function browserPreloadHost(
  preload: (signal: AbortSignal) => Promise<Preload>,
  fetcher: typeof fetch = (...args) => fetch(...args),
): PreloadHost {
  return {
    preload,
    async download(asset, signal, onBytes) {
      const response = await fetcher(asset.url, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`asset ${asset.id}: ${response.status}`);
      const body = response.body;
      if (body === null) {
        const blob = await response.blob();
        onBytes(blob.size);
        return blob;
      }
      const reader = body.getReader();
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value as Uint8Array<ArrayBuffer>);
        onBytes(value.byteLength);
      }
      return new Blob(parts, { type: response.headers.get('content-type') ?? '' });
    },
    async decode(blob) {
      if (!blob.type.startsWith('image/') || typeof createImageBitmap !== 'function') return;
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
    },
  };
}

/** Progress as a ratio 0..1 (bytes when known, else assets). */
export function preloadRatio(p: PreloadProgress): number {
  if (p.status === 'done') return 1;
  if (p.totalBytes > 0) return Math.min(1, p.loadedBytes / p.totalBytes);
  return p.total > 0 ? p.done / p.total : 0;
}
