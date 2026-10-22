/**
 * Runs a PNG export from the page (loaded on demand by the dialog): in export.worker when it
 * can use an OffscreenCanvas 2D context, else on the main thread band by band, yielding to the
 * event loop between bands so the interface never freezes (projet.md D5, 22).
 *
 * Cancellation: the worker is terminated (or the main-thread loop stops), the output stream is
 * aborted and the partial file removed when possible.
 */
import type { MapView, TileLayerId } from '../editor/contracts';
import { loadTileImages } from './images';
import { runExport, type ExportProgress, type Surface } from './job';
import type { OutputTarget } from './output';
import { canUseOffscreen2d, type FromWorker, type ToWorker } from './protocol';
import type { Ctx2D } from './renderer';
import { buildSnapshot, type ExportOptions, type SnapshotPaletteEntry } from './scene';

export interface ExportOutcome {
  readonly files: number;
  readonly failed: readonly SnapshotPaletteEntry[];
  readonly where: 'worker' | 'main';
}

export interface ExportHandle {
  readonly done: Promise<ExportOutcome>;
  cancel(): void;
}

export interface StartExportInput {
  readonly view: MapView;
  readonly layers: readonly TileLayerId[];
  readonly options: ExportOptions;
  readonly target: OutputTarget;
  readonly onProgress: (progress: ExportProgress) => void;
  /** Skip the worker (tests, diagnostics). */
  readonly mainThread?: boolean;
}

const PROBE_TIMEOUT_MS = 10_000;
let nextId = 1;

function abortError(): DOMException {
  return new DOMException('Export cancelled', 'AbortError');
}

function createWorker(): Worker | null {
  try {
    return new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
      type: 'module',
      name: 'export',
    });
  } catch {
    return null;
  }
}

/** Resolves true when the worker answers that it can render (OffscreenCanvas 2D). */
function probe(worker: Worker, id: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
    const onMessage = (event: MessageEvent<FromWorker>): void => {
      if (event.data.type === 'probe' && event.data.id === id) done(event.data.payload.ok);
    };
    const onError = (): void => done(false);
    function done(ok: boolean): void {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      resolve(ok);
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'probe', id } satisfies ToWorker);
  });
}

export function startExport(input: StartExportInput): ExportHandle {
  const controller = new AbortController();
  let worker: Worker | null = null;
  let cancelWorker: (() => void) | null = null;

  const run = async (): Promise<ExportOutcome> => {
    const id = nextId++;
    if (input.mainThread !== true) {
      worker = createWorker();
      if (worker !== null && !(await probe(worker, id))) {
        worker.terminate();
        worker = null;
      }
    }
    controller.signal.throwIfAborted();
    const { snapshot, transfer } = buildSnapshot(
      input.view,
      input.options.extent,
      input.layers,
      document.baseURI,
    );
    if (worker !== null) return runInWorker(worker, id, snapshot, transfer);
    return runOnMainThread(snapshot);
  };

  const runInWorker = (
    w: Worker,
    id: number,
    snapshot: ReturnType<typeof buildSnapshot>['snapshot'],
    transfer: ArrayBuffer[],
  ): Promise<ExportOutcome> =>
    new Promise<ExportOutcome>((resolve, reject) => {
      let writing = Promise.resolve();
      cancelWorker = () => {
        w.terminate();
        reject(abortError());
      };
      w.onerror = (event) => {
        event.preventDefault();
        w.terminate();
        reject(new Error(event.message || 'Export worker failed'));
      };
      w.onmessage = (event: MessageEvent<FromWorker>) => {
        const m = event.data;
        if (m.id !== id) return;
        switch (m.type) {
          case 'data':
            // Sequential writes; acknowledged once on disk / in the Blob.
            writing = writing.then(async () => {
              for (const chunk of m.payload.chunks) await input.target.write(chunk);
              w.postMessage({
                type: 'ack',
                id,
                payload: { seq: m.payload.seq },
              } satisfies ToWorker);
            });
            writing.catch((error: unknown) => {
              w.terminate();
              reject(error);
            });
            break;
          case 'progress':
            input.onProgress(m.payload);
            break;
          case 'done':
            void writing.then(() => {
              w.terminate();
              resolve({ files: m.payload.files, failed: m.payload.failed, where: 'worker' });
            });
            break;
          case 'error':
            w.terminate();
            reject(Object.assign(new Error(m.payload.message), { name: m.payload.name }));
            break;
          case 'probe':
            break;
        }
      };
      w.postMessage(
        { type: 'start', id, payload: { snapshot, options: input.options } } satisfies ToWorker,
        transfer,
      );
    });

  const runOnMainThread = async (
    snapshot: ReturnType<typeof buildSnapshot>['snapshot'],
  ): Promise<ExportOutcome> => {
    const images = await loadTileImages(snapshot.palette, controller.signal);
    try {
      let last = 0;
      const result = await runExport(snapshot, input.options, {
        images,
        createSurface: mainThreadSurface,
        sink: (bytes) => input.target.write(bytes),
        signal: controller.signal,
        onStep: async (progress) => {
          input.onProgress(progress);
          // Yield to the event loop at least every ~30 ms of work.
          const now = performance.now();
          if (now - last > 30) {
            await new Promise((r) => setTimeout(r, 0));
            last = performance.now();
          }
        },
      });
      return { files: result.files, failed: result.failed, where: 'main' };
    } finally {
      images.close();
    }
  };

  const done = (async () => {
    try {
      const outcome = await run();
      await input.target.close();
      return outcome;
    } catch (error) {
      await input.target.abort();
      throw controller.signal.aborted ? abortError() : error;
    }
  })();

  return {
    done,
    cancel() {
      if (controller.signal.aborted) return;
      controller.abort(abortError());
      cancelWorker?.();
      if (cancelWorker === null) (worker as Worker | null)?.terminate();
    },
  };
}

function mainThreadSurface(width: number, height: number): Surface {
  if (canUseOffscreen2d()) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return {
      ctx: ctx as unknown as Ctx2D,
      read: (w, h) => ctx.getImageData(0, 0, w, h).data,
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('Canvas 2D unavailable');
  return {
    ctx: ctx as unknown as Ctx2D,
    read: (w, h) => ctx.getImageData(0, 0, w, h).data,
    release: () => {
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
