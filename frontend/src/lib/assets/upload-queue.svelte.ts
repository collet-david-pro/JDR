/**
 * Upload queue of the library: several files, a limited number in parallel, one state per
 * file (waiting, reducing, sending %, done, error, cancelled), retry and cancellation.
 * The queue knows nothing about the network or the canvas: `prepare` and `send` are
 * injected (tests use fakes).
 */

import { ApiError } from '../api';
import type { Asset, AssetLimits } from '../types';
import type { PreparedFile } from './reduce';
import { failureFromError, type UploadFailure } from './upload-errors';

export type UploadStatus =
  'pending' | 'preparing' | 'reducing' | 'uploading' | 'waiting' | 'done' | 'error' | 'cancelled';

export const UPLOAD_STATUSES: readonly UploadStatus[] = [
  'pending',
  'preparing',
  'reducing',
  'uploading',
  'waiting',
  'done',
  'error',
  'cancelled',
];

export interface UploadItem {
  readonly id: number;
  readonly name: string;
  readonly size: number;
  readonly status: UploadStatus;
  /** Sending progress in [0, 1]. */
  readonly progress: number;
  /** The file was reduced before sending. */
  readonly reduced: boolean;
  readonly duplicate: boolean;
  readonly failure: UploadFailure | null;
  readonly asset: Asset | null;
}

export interface SendResult {
  readonly asset: Asset;
  readonly duplicate: boolean;
}

export interface UploadQueueDeps {
  readonly prepare: (
    file: File,
    signal: AbortSignal,
    onReduce: () => void,
  ) => Promise<PreparedFile>;
  readonly send: (
    prepared: PreparedFile,
    clientOpId: string,
    onProgress: (loaded: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<SendResult>;
  readonly limits?: () => AssetLimits | null;
  /** Called after each successful upload (refresh the grid and the storage gauge). */
  readonly onDone?: (item: UploadItem, result: SendResult) => void;
  /** Called on every status change (aria-live announcements). */
  readonly onStatus?: (item: UploadItem) => void;
  readonly concurrency?: number;
  readonly makeOpId?: () => string;
  /** Abortable sleep (rate limiting); injectable for tests. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Automatic retries after a 429 rate_limited. */
  readonly rateLimitRetries?: number;
}

export const DEFAULT_CONCURRENCY = 2;
const MAX_RETRY_AFTER_S = 60;
const DEFAULT_RETRY_AFTER_S = 5;

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ApiError({ code: 'aborted', message: 'Aborted', status: 0 }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

function isAbort(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.code === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

let opCounter = 0;
function defaultOpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  opCounter++;
  return `op-${Date.now().toString(36)}-${opCounter}`;
}

const ACTIVE: ReadonlySet<UploadStatus> = new Set([
  'preparing',
  'reducing',
  'uploading',
  'waiting',
]);
const FINISHED: ReadonlySet<UploadStatus> = new Set(['done', 'error', 'cancelled']);

interface Entry {
  readonly file: File;
  readonly opId: string;
  controller: AbortController | null;
}

export class UploadQueue {
  items = $state.raw<readonly UploadItem[]>([]);

  private nextId = 1;
  // Bookkeeping (files, controllers), never displayed: a plain Map is intended.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly entries = new Map<number, Entry>();
  private running = 0;
  private idleWaiters: (() => void)[] = [];
  private readonly concurrency: number;

  constructor(private readonly deps: UploadQueueDeps) {
    this.concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  }

  /** Number of files being prepared or sent. */
  get active(): number {
    return this.items.filter((item) => ACTIVE.has(item.status)).length;
  }

  get pending(): number {
    return this.items.filter((item) => item.status === 'pending').length;
  }

  get busy(): boolean {
    return this.items.some((item) => item.status === 'pending' || ACTIVE.has(item.status));
  }

  get hasFinished(): boolean {
    return this.items.some((item) => FINISHED.has(item.status));
  }

  add(files: Iterable<File>): number[] {
    const makeOpId = this.deps.makeOpId ?? defaultOpId;
    const added: UploadItem[] = [];
    for (const file of files) {
      const id = this.nextId++;
      this.entries.set(id, { file, opId: makeOpId(), controller: null });
      added.push({
        id,
        name: file.name,
        size: file.size,
        status: 'pending',
        progress: 0,
        reduced: false,
        duplicate: false,
        failure: null,
        asset: null,
      });
    }
    this.items = [...this.items, ...added];
    this.pump();
    return added.map((item) => item.id);
  }

  cancel(id: number): void {
    const item = this.get(id);
    if (item === undefined || FINISHED.has(item.status)) return;
    const entry = this.entries.get(id);
    if (item.status === 'pending') {
      this.update(id, { status: 'cancelled', progress: 0 });
      this.settleIdle();
      return;
    }
    entry?.controller?.abort();
  }

  cancelAll(): void {
    for (const item of this.items) this.cancel(item.id);
  }

  /** Puts a failed or cancelled file back in the queue (same client_op_id). */
  retry(id: number): void {
    const item = this.get(id);
    if (item === undefined || (item.status !== 'error' && item.status !== 'cancelled')) return;
    this.update(id, { status: 'pending', progress: 0, failure: null });
    this.pump();
  }

  /** Removes the finished files (done, error, cancelled) from the list. */
  clearFinished(): void {
    for (const item of this.items) if (FINISHED.has(item.status)) this.entries.delete(item.id);
    this.items = this.items.filter((item) => !FINISHED.has(item.status));
  }

  /** Resolves when nothing is pending or running (tests, "close" buttons). */
  whenIdle(): Promise<void> {
    if (!this.busy && this.running === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  get(id: number): UploadItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  private update(id: number, patch: Partial<Omit<UploadItem, 'id'>>): UploadItem | undefined {
    let updated: UploadItem | undefined;
    this.items = this.items.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...patch };
      return updated;
    });
    if (updated !== undefined && patch.status !== undefined) this.deps.onStatus?.(updated);
    return updated;
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const next = this.items.find((item) => item.status === 'pending');
      if (next === undefined) break;
      this.running++;
      void this.run(next.id).finally(() => {
        this.running--;
        this.pump();
        this.settleIdle();
      });
    }
  }

  private settleIdle(): void {
    if (this.busy || this.running > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private async run(id: number): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    const controller = new AbortController();
    entry.controller = controller;
    const signal = controller.signal;
    const sleep = this.deps.sleep ?? abortableSleep;
    const retries = this.deps.rateLimitRetries ?? 3;

    try {
      this.update(id, { status: 'preparing', progress: 0 });
      const prepared = await this.deps.prepare(entry.file, signal, () => {
        this.update(id, { status: 'reducing' });
      });
      this.update(id, { reduced: prepared.reduced });
      if (signal.aborted) throw new ApiError({ code: 'aborted', message: 'Aborted', status: 0 });

      for (let attempt = 0; ; attempt++) {
        this.update(id, { status: 'uploading', progress: 0 });
        try {
          const result = await this.deps.send(
            prepared,
            entry.opId,
            (loaded, total) => {
              if (total > 0) this.update(id, { progress: Math.min(1, loaded / total) });
            },
            signal,
          );
          const done = this.update(id, {
            status: 'done',
            progress: 1,
            duplicate: result.duplicate,
            asset: result.asset,
          });
          if (done !== undefined) this.deps.onDone?.(done, result);
          return;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'rate_limited' && attempt < retries) {
            this.update(id, { status: 'waiting', progress: 0 });
            const seconds = Math.min(MAX_RETRY_AFTER_S, error.retryAfter ?? DEFAULT_RETRY_AFTER_S);
            await sleep(seconds * 1000, signal);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (isAbort(error) || signal.aborted) {
        this.update(id, { status: 'cancelled', progress: 0 });
      } else {
        this.update(id, {
          status: 'error',
          progress: 0,
          failure: failureFromError(error, this.deps.limits?.() ?? null),
        });
      }
    } finally {
      entry.controller = null;
    }
  }
}
