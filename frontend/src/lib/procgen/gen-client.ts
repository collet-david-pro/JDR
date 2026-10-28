/**
 * Page-side client of gen.worker (P8e2a, D13, D14: no duration threshold, progress + cancel).
 *
 *   const client = createGenClient();
 *   const { promise, cancel } = client.run(request, { onProgress });
 *   const { result, fingerprint, ms } = await promise; // GenCancelledError after cancel()
 *   client.dispose();
 *
 * One active run per client: a new `run` cancels the previous one (its promise rejects with
 * GenCancelledError). Cancellation in worker mode = `terminate()` of the worker (the generators
 * are synchronous and cannot poll a message); a new worker is created lazily by the next run.
 * Fallback (`mode === 'main'`: no `Worker`, or its creation failed): the generation runs on the
 * main thread after a macrotask, without progress throttling and WITHOUT cancellation once it
 * has started (cancel() before the start still rejects).
 */
import { fingerprint } from '../../procgen/canonical';
import { registerAllGenerators } from '../../procgen/generators';
import { runGenerator } from '../../procgen/registry';
import type {
  GenFromWorker,
  GenOutcome,
  GenProgress,
  GenRequest,
  GenToWorker,
} from './gen-protocol';

export type { GenOutcome, GenProgress, GenRequest } from './gen-protocol';

export class GenCancelledError extends Error {
  constructor() {
    super('Generation cancelled');
    this.name = 'GenCancelledError';
  }
}

export interface GenRunOptions {
  onProgress?: (progress: GenProgress) => void;
}

export interface GenRun {
  promise: Promise<GenOutcome>;
  cancel(): void;
}

export interface GenClient {
  /** 'worker' until a worker cannot be created; then 'main' (no cancellation once started). */
  readonly mode: 'worker' | 'main';
  run(request: GenRequest, options?: GenRunOptions): GenRun;
  dispose(): void;
}

export interface GenClientOptions {
  /** Force the main-thread fallback (tests, diagnostics). */
  mainThread?: boolean;
  /** Worker factory (tests); default: the real gen.worker. Return null / throw = fallback. */
  createWorker?: () => Worker | null;
}

function defaultWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('../../workers/gen.worker.ts', import.meta.url), {
    type: 'module',
    name: 'gen',
  });
}

interface Active {
  id: number;
  reject(error: unknown): void;
  cancel(): void;
}

export function createGenClient(options: GenClientOptions = {}): GenClient {
  const factory = options.createWorker ?? defaultWorker;
  let mode: 'worker' | 'main' = options.mainThread === true ? 'main' : 'worker';
  let worker: Worker | null = null;
  let active: Active | null = null;
  let nextId = 1;
  let disposed = false;

  const ensureWorker = (): Worker | null => {
    if (mode === 'main') return null;
    if (worker !== null) return worker;
    try {
      worker = factory();
    } catch {
      worker = null;
    }
    if (worker === null) mode = 'main';
    return worker;
  };

  const dropWorker = (): void => {
    worker?.terminate();
    worker = null;
  };

  const runInWorker = (
    w: Worker,
    id: number,
    request: GenRequest,
    onProgress: ((p: GenProgress) => void) | undefined,
    resolve: (o: GenOutcome) => void,
    reject: (e: unknown) => void,
  ): Active => {
    const finish = (): void => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (active?.id === id) active = null;
    };
    const onMessage = (event: MessageEvent<GenFromWorker>): void => {
      const m = event.data;
      if (m.id !== id) return;
      switch (m.type) {
        case 'progress':
          onProgress?.(m.payload);
          return;
        case 'done':
          finish();
          resolve(m.payload);
          return;
        case 'cancelled':
          finish();
          reject(new GenCancelledError());
          return;
        case 'error': {
          finish();
          const error = new Error(m.payload.message);
          error.name = m.payload.name;
          reject(error);
        }
      }
    };
    const onError = (event: ErrorEvent | Event): void => {
      event.preventDefault?.();
      finish();
      dropWorker();
      reject(new Error((event as ErrorEvent).message || 'Generation worker failed'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ type: 'run', id, payload: request } satisfies GenToWorker);
    return {
      id,
      reject,
      cancel: () => {
        finish();
        dropWorker(); // terminate: the synchronous generator cannot be interrupted otherwise
        reject(new GenCancelledError());
      },
    };
  };

  const runOnMain = (
    id: number,
    request: GenRequest,
    onProgress: ((p: GenProgress) => void) | undefined,
    resolve: (o: GenOutcome) => void,
    reject: (e: unknown) => void,
  ): Active => {
    let state: 'waiting' | 'running' | 'cancelled' = 'waiting';
    const timer = setTimeout(() => {
      if (state !== 'waiting') return;
      state = 'running';
      void (async () => {
        try {
          registerAllGenerators();
          const t0 = performance.now();
          const result = runGenerator(
            request.generator,
            request.gen_version,
            request.seed,
            request.params,
            {
              ...(request.zone === undefined ? {} : { zone: request.zone }),
              ...(onProgress === undefined
                ? {}
                : { progress: (phase, done, total) => onProgress({ phase, done, total }) }),
            },
          );
          const print = await fingerprint(result);
          resolve({ result, fingerprint: print, ms: Math.round(performance.now() - t0) });
        } catch (error) {
          reject(error);
        } finally {
          if (active?.id === id) active = null;
        }
      })();
    }, 0);
    return {
      id,
      reject,
      cancel: () => {
        if (state !== 'waiting') return; // already running: cannot be interrupted
        state = 'cancelled';
        clearTimeout(timer);
        if (active?.id === id) active = null;
        reject(new GenCancelledError());
      },
    };
  };

  return {
    get mode() {
      return mode;
    },
    run(request, runOptions = {}) {
      if (disposed) throw new Error('GenClient disposed');
      active?.cancel();
      const id = nextId++;
      let current: Active | null = null;
      const promise = new Promise<GenOutcome>((resolve, reject) => {
        const w = ensureWorker();
        current =
          w !== null
            ? runInWorker(w, id, request, runOptions.onProgress, resolve, reject)
            : runOnMain(id, request, runOptions.onProgress, resolve, reject);
        active = current;
      });
      return {
        promise,
        cancel: () => {
          if (active?.id === id) active.cancel();
        },
      };
    },
    dispose() {
      disposed = true;
      active?.cancel();
      dropWorker();
    },
  };
}
