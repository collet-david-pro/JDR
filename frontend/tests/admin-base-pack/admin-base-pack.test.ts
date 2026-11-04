import { describe, expect, it } from 'vitest';
import { runBasePack, type BasePackReport } from '../../src/lib/admin-base-pack';

const base: BasePackReport = {
  installed: 0,
  present: 0,
  failed: [],
  remaining: 0,
  total: 10,
  complete: true,
  busy: false,
};

describe('runBasePack', () => {
  it('repeats until complete, cumulates installed and retries failures on the first call only', async () => {
    const resumes: boolean[] = [];
    const reports = [
      { ...base, installed: 4, remaining: 6, complete: false },
      { ...base, installed: 4, remaining: 2, complete: false },
      { ...base, installed: 2, remaining: 0 },
    ];
    const progress: number[] = [];
    const result = await runBasePack(
      (resume) => {
        resumes.push(resume);
        return Promise.resolve(reports[resumes.length - 1]!);
      },
      (done) => progress.push(done),
    );
    expect(resumes).toEqual([false, true, true]);
    expect(progress).toEqual([4, 8, 10]);
    expect(result.installed).toBe(10);
    expect(result.present).toBe(0);
    expect(result.complete).toBe(true);
  });

  it('stops when busy and reports failures', async () => {
    const busy = await runBasePack(() => Promise.resolve({ ...base, complete: false, busy: true }));
    expect(busy.busy).toBe(true);
    const failed = await runBasePack(() =>
      Promise.resolve({ ...base, failed: [{ key: 'a', name: 'A', reason: 'x' }] }),
    );
    expect(failed.failed).toHaveLength(1);
    expect(failed.present).toBe(9);
  });
});
