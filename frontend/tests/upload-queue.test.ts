import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api';
import { UploadRejected, type PreparedFile } from '../src/lib/assets/reduce';
import { failureFromError, failureText } from '../src/lib/assets/upload-errors';
import {
  UploadQueue,
  type SendResult,
  type UploadQueueDeps,
} from '../src/lib/assets/upload-queue.svelte';
import type { Asset, AssetLimits } from '../src/lib/types';

const limits: AssetLimits = {
  max_upload_bytes: 10 * 1024 * 1024,
  max_dimension_px: 4096,
  max_total_pixels: 16_777_216,
  max_frames: 300,
  max_animation_ms: 60_000,
  accepted_mimes: ['image/png'],
};

const assetFor = (name: string): Asset => ({ id: name, name }) as unknown as Asset;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const files = (...names: string[]): File[] => names.map((n) => new File(['data'], n));

/** Queue whose sends wait for the test to settle them. */
function controlledQueue(overrides: Partial<UploadQueueDeps> = {}) {
  const sends = new Map<string, Deferred<SendResult>>();
  const signals = new Map<string, AbortSignal>();
  const opIds: string[] = [];
  let op = 0;
  const deps: UploadQueueDeps = {
    prepare: (file) =>
      Promise.resolve({
        blob: file,
        fileName: file.name,
        reduced: false,
        originalSize: file.size,
        info: null,
      } satisfies PreparedFile),
    send: (prepared, opId, onProgress, signal) => {
      opIds.push(opId);
      const d = deferred<SendResult>();
      sends.set(prepared.fileName, d);
      signals.set(prepared.fileName, signal);
      signal.addEventListener('abort', () =>
        d.reject(new ApiError({ code: 'aborted', message: '', status: 0 })),
      );
      onProgress(25, 100);
      return d.promise;
    },
    limits: () => limits,
    makeOpId: () => `op-${++op}`,
    ...overrides,
  };
  return { queue: new UploadQueue(deps), sends, signals, opIds };
}

describe('UploadQueue', () => {
  it('runs at most two uploads at a time, then the next ones', async () => {
    const { queue, sends } = controlledQueue();
    queue.add(files('a.png', 'b.png', 'c.png'));
    await flush();
    expect(queue.items.map((i) => i.status)).toEqual(['uploading', 'uploading', 'pending']);
    expect(queue.items[0]?.progress).toBe(0.25);
    expect(sends.size).toBe(2);

    sends.get('a.png')?.resolve({ asset: assetFor('a'), duplicate: false });
    await flush();
    expect(queue.items.map((i) => i.status)).toEqual(['done', 'uploading', 'uploading']);
    expect(queue.items[0]?.progress).toBe(1);

    sends.get('b.png')?.resolve({ asset: assetFor('b'), duplicate: true });
    sends.get('c.png')?.resolve({ asset: assetFor('c'), duplicate: false });
    await queue.whenIdle();
    expect(queue.items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
    expect(queue.items[1]?.duplicate).toBe(true);
    expect(queue.busy).toBe(false);
  });

  it('calls onDone and onStatus', async () => {
    const onDone = vi.fn();
    const onStatus = vi.fn();
    const { queue, sends } = controlledQueue({ onDone, onStatus });
    queue.add(files('a.png'));
    await flush();
    sends.get('a.png')?.resolve({ asset: assetFor('a'), duplicate: true });
    await queue.whenIdle();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0]?.[1]).toEqual({ asset: assetFor('a'), duplicate: true });
    expect(onStatus.mock.calls.map(([item]) => (item as { status: string }).status)).toEqual([
      'preparing',
      'uploading',
      'done',
    ]);
  });

  it('records explicit, translated errors and keeps going', async () => {
    const { queue, sends } = controlledQueue();
    queue.add(files('a.png', 'b.png'));
    await flush();
    sends
      .get('a.png')
      ?.reject(new ApiError({ code: 'quota_exceeded', message: '', status: 413, requestId: 'r1' }));
    sends.get('b.png')?.resolve({ asset: assetFor('b'), duplicate: false });
    await queue.whenIdle();
    const failure = queue.items[0]?.failure;
    expect(queue.items[0]?.status).toBe('error');
    expect(failure).toMatchObject({ key: 'library.upload.errors.quota_exceeded', requestId: 'r1' });
    expect(queue.items[1]?.status).toBe('done');
  });

  it('reports refusals decided before sending', async () => {
    const { queue } = controlledQueue({
      prepare: () => Promise.reject(new UploadRejected('animated_too_heavy')),
    });
    queue.add(files('anim.gif'));
    await queue.whenIdle();
    expect(queue.items[0]).toMatchObject({
      status: 'error',
      failure: { key: 'library.upload.reject.animated_too_heavy' },
    });
  });

  it('shows the reducing state when the file is reduced', async () => {
    const prepared = deferred<PreparedFile>();
    let reduce: () => void = () => undefined;
    const { queue, sends } = controlledQueue({
      prepare: (_file, _signal, onReduce) => {
        reduce = onReduce;
        return prepared.promise;
      },
    });
    queue.add(files('big.png'));
    await flush();
    expect(queue.items[0]?.status).toBe('preparing');
    reduce();
    expect(queue.items[0]?.status).toBe('reducing');
    prepared.resolve({
      blob: new Blob(['x']),
      fileName: 'big.png',
      reduced: true,
      originalSize: 10,
      info: null,
    });
    await flush();
    expect(queue.items[0]).toMatchObject({ status: 'uploading', reduced: true });
    sends.get('big.png')?.resolve({ asset: assetFor('big'), duplicate: false });
    await queue.whenIdle();
  });

  it('cancels a running upload and a pending one; retry keeps the client_op_id', async () => {
    const { queue, sends, signals, opIds } = controlledQueue({ concurrency: 1 });
    const [a, b] = queue.add(files('a.png', 'b.png'));
    await flush();
    queue.cancel(b ?? 0);
    expect(queue.get(b ?? 0)?.status).toBe('cancelled');
    queue.cancel(a ?? 0);
    await flush();
    expect(signals.get('a.png')?.aborted).toBe(true);
    expect(queue.get(a ?? 0)?.status).toBe('cancelled');
    await queue.whenIdle();

    queue.retry(a ?? 0);
    await flush();
    expect(queue.get(a ?? 0)?.status).toBe('uploading');
    sends.get('a.png')?.resolve({ asset: assetFor('a'), duplicate: false });
    await queue.whenIdle();
    expect(queue.get(a ?? 0)?.status).toBe('done');
    expect(opIds).toEqual(['op-1', 'op-1']);

    queue.clearFinished();
    expect(queue.items).toEqual([]);
  });

  it('waits and retries automatically after rate_limited', async () => {
    const sleep = vi.fn((_ms: number, _signal: AbortSignal) => Promise.resolve());
    let calls = 0;
    const queue = new UploadQueue({
      prepare: (file) =>
        Promise.resolve({
          blob: file,
          fileName: file.name,
          reduced: false,
          originalSize: 1,
          info: null,
        }),
      send: () => {
        calls++;
        if (calls < 3) {
          return Promise.reject(
            new ApiError({ code: 'rate_limited', message: '', status: 429, retryAfter: 600 }),
          );
        }
        return Promise.resolve({ asset: assetFor('a'), duplicate: false });
      },
      sleep,
    });
    queue.add(files('a.png'));
    await queue.whenIdle();
    expect(queue.items[0]?.status).toBe('done');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(60_000); // Retry-After capped to 60 s
  });

  it('gives up after the automatic rate-limit retries', async () => {
    const queue = new UploadQueue({
      prepare: (file) =>
        Promise.resolve({
          blob: file,
          fileName: file.name,
          reduced: false,
          originalSize: 1,
          info: null,
        }),
      send: () =>
        Promise.reject(
          new ApiError({ code: 'rate_limited', message: '', status: 429, retryAfter: 2 }),
        ),
      sleep: () => Promise.resolve(),
      rateLimitRetries: 1,
    });
    queue.add(files('a.png'));
    await queue.whenIdle();
    expect(queue.items[0]?.failure?.key).toBe('errors.rate_limited_for');
  });
});

describe('upload failures', () => {
  it('maps server codes to explicit messages with the limits', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      `${key}${params ? JSON.stringify(params) : ''}`;
    const failure = failureFromError(
      new ApiError({ code: 'file_too_large', message: '', status: 413 }),
      limits,
    );
    expect(failure.key).toBe('library.upload.errors.file_too_large');
    expect(failure.params['dimension']).toBe(4096);
    expect(failureText(failure, t)).toContain('library.upload.errors.file_too_large');
    expect(
      failureFromError(new ApiError({ code: 'image_too_large', message: '', status: 422 }), null)
        .key,
    ).toBe('errors.image_too_large');
    expect(
      failureFromError(new ApiError({ code: 'network_error', message: '', status: 0 }), limits).key,
    ).toBe('errors.network');
    expect(failureFromError(new Error('x'), limits).key).toBe('errors.unknown');
    expect(failureText({ key: 'missing.key', params: {}, requestId: null }, (k) => k)).toBe(
      'errors.unknown',
    );
  });
});
