/**
 * export.worker (projet.md 13.4, 17): renders the PNG export band by band on an OffscreenCanvas
 * (Canvas 2D, see export/job.ts for the choice) and streams the encoded bytes to the page.
 * Cancellation = the page terminates the worker.
 */
import { loadTileImages } from '../export/images';
import { runExport, type ExportProgress, type Surface } from '../export/job';
import { MAX_UNACKED, canUseOffscreen2d, type FromWorker, type ToWorker } from '../export/protocol';
import type { Ctx2D } from '../export/renderer';

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;

let seq = 0;
let acked = 0;
let ackWaiter: (() => void) | null = null;
let pending: Uint8Array[] = [];

function post(message: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function createSurface(width: number, height: number): Surface {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('OffscreenCanvas 2D unavailable');
  return {
    ctx: ctx as unknown as Ctx2D,
    read: (w, h) => ctx.getImageData(0, 0, w, h).data,
    release: () => {
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}

/** Sends the buffered output and waits while too many batches are unacknowledged. */
async function flush(id: number): Promise<void> {
  if (pending.length > 0) {
    const chunks = pending;
    pending = [];
    seq++;
    post(
      { type: 'data', id, payload: { seq, chunks } },
      chunks.map((c) => c.buffer as ArrayBuffer),
    );
  }
  while (seq - acked > MAX_UNACKED) {
    await new Promise<void>((resolve) => (ackWaiter = resolve));
  }
}

async function start(id: number, message: Extract<ToWorker, { type: 'start' }>): Promise<void> {
  const { snapshot, options } = message.payload;
  const controller = new AbortController();
  try {
    const images = await loadTileImages(snapshot.palette, controller.signal);
    let lastProgress = 0;
    const result = await runExport(snapshot, options, {
      images,
      createSurface,
      signal: controller.signal,
      sink: (bytes) => {
        // Own copy: transferred to the page (encoder buffers are never reused, but a chunk
        // may be a view on a larger buffer).
        pending.push(
          bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
            ? bytes
            : bytes.slice(),
        );
      },
      onStep: async (progress: ExportProgress) => {
        const now = performance.now();
        if (now - lastProgress > 100 || progress.done === progress.total) {
          lastProgress = now;
          post({ type: 'progress', id, payload: progress });
        }
        await flush(id);
      },
    });
    await flush(id);
    // Wait until the page wrote everything before reporting completion.
    while (acked < seq) await new Promise<void>((resolve) => (ackWaiter = resolve));
    images.close();
    post({ type: 'done', id, payload: { files: result.files, failed: result.failed } });
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    post({ type: 'error', id, payload: { name: e.name, message: e.message } });
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'probe':
      post({ type: 'probe', id: message.id, payload: { ok: canUseOffscreen2d() } });
      break;
    case 'start':
      void start(message.id, message);
      break;
    case 'ack':
      acked = Math.max(acked, message.payload.seq);
      ackWaiter?.();
      ackWaiter = null;
      break;
  }
};
