import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api';
import { JobFailedError, jobErrorCode, runJob } from '../src/lib/assets/jobs';
import type { Job } from '../src/lib/types';

function job(status: string, done = 0, total = 3, result: unknown = null): Job {
  return {
    id: 'j1',
    type: 'pack_export',
    status,
    progress: { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) },
    result,
  };
}

describe('runJob', () => {
  it('steps until done and reports the progress', async () => {
    const sequence = [job('running', 1), job('running', 2), job('done', 3)];
    const step = vi.fn(() => Promise.resolve(sequence.shift() ?? job('done', 3)));
    const onProgress = vi.fn();
    const result = await runJob(job('pending'), { step, onProgress });
    expect(result.status).toBe('done');
    expect(step).toHaveBeenCalledTimes(3);
    expect(step).toHaveBeenCalledWith('j1', undefined);
    expect(onProgress.mock.calls.map(([j]) => (j as Job).progress.done)).toEqual([0, 1, 2, 3]);
  });

  it('does not step a job that is already finished', async () => {
    const step = vi.fn();
    await expect(runJob(job('done', 3), { step })).resolves.toMatchObject({ status: 'done' });
    expect(step).not.toHaveBeenCalled();
  });

  it('stops on failed with JobFailedError (result error code available)', async () => {
    const step = vi.fn(() =>
      Promise.resolve(job('failed', 1, 3, { error: { code: 'quota_exceeded' } })),
    );
    const error = await runJob(job('running'), { step }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobFailedError);
    expect(jobErrorCode((error as JobFailedError).job)).toBe('quota_exceeded');
    expect(step).toHaveBeenCalledOnce();
  });

  it('stops on a server-side cancellation', async () => {
    const step = vi.fn(() => Promise.resolve(job('cancelled', 1)));
    await expect(runJob(job('running'), { step })).rejects.toBeInstanceOf(JobFailedError);
  });

  it('cancels on the client: stops stepping and calls the cancel endpoint', async () => {
    const controller = new AbortController();
    const step = vi.fn(() => {
      controller.abort();
      return Promise.resolve(job('running', 1));
    });
    const cancel = vi.fn(() => Promise.resolve(job('cancelled', 1)));
    const onProgress = vi.fn();
    const error = await runJob(job('running'), {
      step,
      cancel,
      onProgress,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('aborted');
    expect(step).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith('j1');
  });

  it('propagates step errors and guards against endless jobs', async () => {
    const failing = vi.fn(() =>
      Promise.reject(new ApiError({ code: 'network_error', message: 'x', status: 0 })),
    );
    await expect(runJob(job('running'), { step: failing })).rejects.toMatchObject({
      code: 'network_error',
    });
    const endless = vi.fn(() => Promise.resolve(job('running')));
    await expect(runJob(job('running'), { step: endless, maxSteps: 5 })).rejects.toBeInstanceOf(
      JobFailedError,
    );
    expect(endless).toHaveBeenCalledTimes(5);
  });

  it('jobErrorCode reads both result shapes', () => {
    expect(jobErrorCode(job('failed', 0, 0, { code: 'unsupported_type' }))).toBe(
      'unsupported_type',
    );
    expect(jobErrorCode(job('failed', 0, 0, null))).toBeNull();
  });
});
