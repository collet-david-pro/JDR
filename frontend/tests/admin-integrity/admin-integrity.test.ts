import { describe, expect, it, vi } from 'vitest';
import {
  buildFixBody,
  groupIssues,
  needsConfirmation,
  runCheck,
  withoutFixed,
  type CheckSlice,
  type IntegrityIssue,
} from '../../src/lib/admin-integrity';

function issue(
  kind: IntegrityIssue['kind'],
  key: string,
  destructive: boolean | null,
): IntegrityIssue {
  return {
    id: `${kind}:${key}`,
    kind,
    severity: 'warning',
    subject: { type: 'x' },
    details: {},
    fix: destructive === null ? null : { action: 'a', destructive },
  };
}

describe('runCheck', () => {
  it('cumulates the slices until the cursor is null and reports the progress', async () => {
    const slices: CheckSlice[] = [
      {
        issues: [issue('quota_mismatch', '1', false)],
        cursor: 'c1',
        progress: { done: 1, total: 3 },
      },
      { issues: [issue('orphan_file', 'p', true)], cursor: 'c2', progress: { done: 2, total: 3 } },
      { issues: [], cursor: null, progress: { done: 3, total: 3 } },
    ];
    const cursors: (string | null)[] = [];
    const progress: number[] = [];
    const result = await runCheck(
      (cursor) => {
        cursors.push(cursor);
        return Promise.resolve(slices[cursors.length - 1] as CheckSlice);
      },
      { onProgress: (done) => progress.push(done) },
    );
    expect(cursors).toEqual([null, 'c1', 'c2']);
    expect(progress).toEqual([1, 2, 3]);
    expect(result.map((i) => i.id)).toEqual(['quota_mismatch:1', 'orphan_file:p']);
  });

  it('stops between slices when cancelled', async () => {
    const controller = new AbortController();
    const fetchSlice = vi.fn(() => {
      controller.abort();
      return Promise.resolve({ issues: [], cursor: 'next', progress: { done: 1, total: 2 } });
    });
    await expect(runCheck(fetchSlice, { signal: controller.signal })).rejects.toThrow();
    expect(fetchSlice).toHaveBeenCalledTimes(1);
  });
});

describe('groups and confirmation', () => {
  const issues = [
    issue('orphan_file', 'a', true),
    issue('quota_mismatch', '1', false),
    issue('orphan_file', 'b', true),
    issue('ref_to_deleted_asset', '1:2', null),
    issue('quota_mismatch', '2', false),
  ];

  it('groups by kind in display order with counters and the non destructive ones apart', () => {
    const groups = groupIssues(issues);
    expect(groups.map((g) => [g.kind, g.issues.length, g.safe.length])).toEqual([
      ['quota_mismatch', 2, 2],
      ['orphan_file', 2, 0],
      ['ref_to_deleted_asset', 1, 0],
    ]);
  });

  it('requires a confirmation as soon as one correction deletes', () => {
    expect(needsConfirmation([issues[1] as IntegrityIssue, issues[4] as IntegrityIssue])).toBe(
      false,
    );
    expect(needsConfirmation([issues[0] as IntegrityIssue])).toBe(true);
  });

  it('sends confirm only for a confirmed destructive correction', () => {
    const del = [issues[0] as IntegrityIssue];
    expect(buildFixBody(del, false).confirm).toBeUndefined();
    expect(buildFixBody(del, true).confirm).toBe(true);
    expect(buildFixBody([issues[1] as IntegrityIssue], true).confirm).toBeUndefined();
    expect(buildFixBody(del, true).issues[0]).toMatchObject({
      id: 'orphan_file:a',
      kind: 'orphan_file',
    });
  });

  it('drops the fixed and already fixed issues only', () => {
    const left = withoutFixed(issues, {
      fixed: ['quota_mismatch:1'],
      skipped: [
        { id: 'orphan_file:a', reason: 'already_fixed' },
        { id: 'orphan_file:b', reason: 'invalid' },
      ],
    });
    expect(left.map((i) => i.id)).toEqual([
      'orphan_file:b',
      'ref_to_deleted_asset:1:2',
      'quota_mismatch:2',
    ]);
  });
});
