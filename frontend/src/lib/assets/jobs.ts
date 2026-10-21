/**
 * Background jobs advanced by the client (packs): POST /jobs/{id}/step is called in a loop
 * until the job is finished. Cancelling stops the loop and asks the server to cancel.
 */

import { ApiError } from '../api';
import type { Job } from '../types';

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['done', 'failed', 'cancelled']);

export function isTerminal(job: Job): boolean {
  return TERMINAL_STATUSES.has(job.status);
}

export class JobFailedError extends Error {
  override readonly name = 'JobFailedError';
  constructor(readonly job: Job) {
    super(`Job ${job.id} ${job.status}`);
  }
}

/** Error code carried by the result of a failed job (`{error: {code}}` or `{code}`), if any. */
export function jobErrorCode(job: Job): string | null {
  const result = job.result;
  if (typeof result !== 'object' || result === null) return null;
  const record = result as Record<string, unknown>;
  const nested = record['error'];
  if (typeof nested === 'object' && nested !== null) {
    const code = (nested as Record<string, unknown>)['code'];
    if (typeof code === 'string') return code;
  }
  return typeof record['code'] === 'string' ? record['code'] : null;
}

export interface RunJobOptions {
  readonly step: (id: string, signal?: AbortSignal) => Promise<Job>;
  /** Server-side cancellation, called once when `signal` aborts. */
  readonly cancel?: (id: string) => Promise<Job>;
  readonly onProgress?: (job: Job) => void;
  readonly signal?: AbortSignal;
  /** Guard against a job that never ends. */
  readonly maxSteps?: number;
}

/** Read through a function: TypeScript would keep the narrowing across `await`. */
const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const aborted = (): ApiError =>
  new ApiError({ code: 'aborted', message: 'Job cancelled', status: 0 });

/**
 * Runs a job to completion. Resolves with the `done` job; rejects with JobFailedError
 * (`failed` / `cancelled` by the server) or ApiError `aborted` (cancelled by the client).
 */
export async function runJob(start: Job, options: RunJobOptions): Promise<Job> {
  const { signal } = options;
  const maxSteps = options.maxSteps ?? 100_000;
  let job = start;
  options.onProgress?.(job);

  const cancelOnServer = async (): Promise<void> => {
    if (options.cancel === undefined || isTerminal(job)) return;
    try {
      job = await options.cancel(job.id);
      options.onProgress?.(job);
    } catch {
      // Best effort: the server purges abandoned jobs anyway.
    }
  };

  for (let steps = 0; !isTerminal(job); steps++) {
    if (isAborted(signal)) {
      await cancelOnServer();
      throw aborted();
    }
    if (steps >= maxSteps) throw new JobFailedError(job);
    try {
      job = await options.step(job.id, signal);
    } catch (error) {
      if (isAborted(signal)) {
        await cancelOnServer();
        throw aborted();
      }
      throw error;
    }
    options.onProgress?.(job);
  }
  if (job.status !== 'done') throw new JobFailedError(job);
  return job;
}
