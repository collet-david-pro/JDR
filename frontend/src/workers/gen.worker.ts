/**
 * gen.worker (P8e2a, D13): runs one procedural generation off the main thread.
 *
 * Cancellation: `generate` is synchronous, so the worker cannot read a `cancel` message while it
 * runs. The page therefore *terminates* the worker (gen-client.ts) and creates a new one when
 * needed; the `cancel` message is only honoured when it arrives before the run starts.
 * Progress is throttled to 10 messages per second. `ms` is measured here, outside procgen/.
 */
import { fingerprint } from '../procgen/canonical';
import { registerAllGenerators } from '../procgen/generators';
import { GenCancelled, runGenerator } from '../procgen/registry';
import {
  PROGRESS_INTERVAL_MS,
  type GenFromWorker,
  type GenRequest,
  type GenToWorker,
} from '../lib/procgen/gen-protocol';

interface WorkerScope {
  postMessage(message: GenFromWorker): void;
  onmessage: ((event: MessageEvent<GenToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const cancelled = new Set<number>();

async function run(id: number, req: GenRequest): Promise<void> {
  if (cancelled.delete(id)) {
    scope.postMessage({ type: 'cancelled', id });
    return;
  }
  try {
    registerAllGenerators();
    const t0 = performance.now();
    let last = -Infinity;
    const result = runGenerator(req.generator, req.gen_version, req.seed, req.params, {
      ...(req.zone === undefined ? {} : { zone: req.zone }),
      isCancelled: () => cancelled.has(id),
      progress: (phase, done, total) => {
        const now = performance.now();
        if (now - last < PROGRESS_INTERVAL_MS) return;
        last = now;
        scope.postMessage({ type: 'progress', id, payload: { phase, done, total } });
      },
    });
    const print = await fingerprint(result);
    scope.postMessage({
      type: 'done',
      id,
      payload: { result, fingerprint: print, ms: Math.round(performance.now() - t0) },
    });
  } catch (error) {
    if (error instanceof GenCancelled) {
      cancelled.delete(id);
      scope.postMessage({ type: 'cancelled', id });
      return;
    }
    const e = error instanceof Error ? error : new Error(String(error));
    scope.postMessage({ type: 'error', id, payload: { name: e.name, message: e.message } });
  }
}

scope.onmessage = (event) => {
  const m = event.data;
  if (m.type === 'cancel') cancelled.add(m.id);
  else void run(m.id, m.payload);
};
