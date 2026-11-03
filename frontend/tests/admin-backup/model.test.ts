import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_WORD,
  canStartRestore,
  failedJobCode,
  isConfirmed,
  percentOf,
  type BackupInfo,
  type RestoreState,
} from '../../src/lib/admin-backup';
import { BackupModel, type BackupApiClient } from '../../src/lib/admin-backup.svelte';
import { ApiError } from '../../src/lib/api';
import { createTranslator, toMessages } from '../../src/lib/translator';
import type { Job } from '../../src/lib/types';

const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')) as Record<
    string,
    unknown
  >;

const tree = read('../../../i18n/fr.json');
const t = createTranslator({ locale: 'fr', messages: toMessages(tree) });

const info: BackupInfo = {
  current_version: '0.2.0',
  limits: { db_max_bytes: 1000, assets_max_bytes: 2000, chunk_bytes: 4 },
  restore: null,
  update_url: 'http://x/update.php',
};

const job = (status: string, percent: number, result: unknown = null, type = 'db_backup'): Job => ({
  id: '7',
  type,
  status,
  progress: { done: percent, total: 100, percent },
  result,
});

const restore = (
  status: string,
  phase: string,
  percent: number,
  extra: Partial<RestoreState> = {},
): RestoreState => ({
  id: 'ab12',
  status,
  phase,
  progress: { done: percent, total: 100, percent },
  version: '0.2.0',
  error: null,
  schema_behind: null,
  ...extra,
});

type Handler = (body: unknown, opts: Record<string, unknown>) => unknown;

function fakeApi(handlers: Record<string, Handler | Handler[]>) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const call =
    (method: string) =>
    async (
      path: string,
      body?: unknown,
      opts?: unknown,
    ): Promise<{ data: unknown; meta: object }> => {
      const key = `${method} ${path}`;
      calls.push(key);
      bodies.push(body);
      let handler = handlers[key];
      if (Array.isArray(handler)) handler = handler.length > 1 ? handler.shift() : handler[0];
      if (handler === undefined) throw new Error(`unexpected ${key}`);
      return { data: await handler(body, (opts ?? {}) as Record<string, unknown>), meta: {} };
    };
  const api = {
    get: async (path: string, opts?: unknown) => call('GET')(path, undefined, opts),
    post: call('POST'),
    put: call('PUT'),
    url: (path: string) => `/api/v1${path}`,
  } as unknown as BackupApiClient;
  return { api, calls, bodies };
}

const file = (size: number, name = 'dump.sql.gz'): File => new File([new Uint8Array(size)], name);

describe('double check before a restore', () => {
  it('needs the box and the exact word', () => {
    expect(isConfirmed(false, CONFIRM_WORD)).toBe(false);
    expect(isConfirmed(true, 'restaurer')).toBe(false);
    expect(isConfirmed(true, ` ${CONFIRM_WORD} `)).toBe(true);
    const base = { file: file(5), understood: true, word: CONFIRM_WORD, busy: false };
    expect(canStartRestore(base)).toBe(true);
    expect(canStartRestore({ ...base, file: null })).toBe(false);
    expect(canStartRestore({ ...base, understood: false })).toBe(false);
    expect(canStartRestore({ ...base, word: 'RESTAURE' })).toBe(false);
    expect(canStartRestore({ ...base, busy: true })).toBe(false);
  });

  it('keeps the model button disabled until file, box and word are given', async () => {
    const { api } = fakeApi({ 'GET /admin/backup': () => info });
    const model = new BackupModel(api, t);
    await model.load();
    expect(model.canRestore).toBe(false);
    model.file = file(10);
    expect(model.canRestore).toBe(false);
    model.understood = true;
    expect(model.canRestore).toBe(false);
    model.word = CONFIRM_WORD;
    expect(model.canRestore).toBe(true);
    model.setKind('assets');
    expect(model.file).toBeNull();
    expect(model.canRestore).toBe(false);
  });

  it('does nothing when the restore is not confirmed', async () => {
    const { api, calls } = fakeApi({ 'GET /admin/backup': () => info });
    const model = new BackupModel(api, t);
    await model.load();
    model.file = file(10);
    await model.restore();
    expect(calls).toEqual(['GET /admin/backup']);
  });
});

describe('restore sequence', () => {
  it('uploads in chunks, then steps the database restore until done', async () => {
    const steps = [
      restore('running', 'scan', 5),
      restore('running', 'apply', 60),
      restore('done', 'done', 100, { schema_behind: false }),
    ];
    const { api, calls, bodies } = fakeApi({
      'GET /admin/backup': () => info,
      'POST /admin/backup/uploads': () => ({ upload_id: 'u1', chunk_bytes: 4 }),
      'PUT /admin/backup/uploads/u1': (_body, opts) => ({
        received: Math.min(10, Number((opts['query'] as Record<string, number>)['offset']) + 4),
      }),
      'POST /admin/backup/restore/db': () => ({
        restore: restore('running', 'scan', 0, { token: 'tok' }),
      }),
      'POST /admin/backup/restore/db/ab12/step': steps.map((s) => () => ({ restore: s })),
    });
    const model = new BackupModel(api, t);
    await model.load();
    model.file = file(10);
    model.understood = true;
    model.word = CONFIRM_WORD;
    await model.restore();
    expect(calls).toEqual([
      'GET /admin/backup',
      'POST /admin/backup/uploads',
      'PUT /admin/backup/uploads/u1',
      'PUT /admin/backup/uploads/u1',
      'PUT /admin/backup/uploads/u1',
      'POST /admin/backup/restore/db',
      'POST /admin/backup/restore/db/ab12/step',
      'POST /admin/backup/restore/db/ab12/step',
      'POST /admin/backup/restore/db/ab12/step',
    ]);
    expect(bodies[1]).toEqual({ kind: 'db', size: 10 });
    expect(bodies[6]).toEqual({ token: 'tok' });
    expect(model.restorePhase).toBe('done');
    expect(model.restoreOutcome).toEqual({ kind: 'db', schemaBehind: false });
    expect(model.restoreFailure).toBeNull();
    // The double check is asked again for the next restore.
    expect(model.understood).toBe(false);
    expect(model.word).toBe('');
    expect(model.canRestore).toBe(false);
  });

  it('reports a schema behind and a failed step', async () => {
    const run = async (final: RestoreState) => {
      const { api } = fakeApi({
        'GET /admin/backup': () => info,
        'POST /admin/backup/uploads': () => ({ upload_id: 'u1', chunk_bytes: 100 }),
        'PUT /admin/backup/uploads/u1': () => ({ received: 10 }),
        'POST /admin/backup/restore/db': () => ({
          restore: restore('running', 'scan', 0, { token: 'tok' }),
        }),
        'POST /admin/backup/restore/db/ab12/step': () => ({ restore: final }),
      });
      const model = new BackupModel(api, t);
      await model.load();
      model.file = file(10);
      model.understood = true;
      model.word = CONFIRM_WORD;
      await model.restore();
      return model;
    };
    const behind = await run(restore('done', 'done', 100, { schema_behind: true }));
    expect(behind.restoreOutcome).toEqual({ kind: 'db', schemaBehind: true });
    const failed = await run(restore('failed', 'scan', 3, { error: 'backup.invalid_file' }));
    expect(failed.restorePhase).toBe('failed');
    expect(failed.restoreFailure?.message).toContain('pas une sauvegarde valide');
  });

  it('shows a refusal of the server (dump too recent)', async () => {
    const { api } = fakeApi({
      'GET /admin/backup': () => info,
      'POST /admin/backup/uploads': () => ({ upload_id: 'u1', chunk_bytes: 100 }),
      'PUT /admin/backup/uploads/u1': () => ({ received: 10 }),
      'POST /admin/backup/restore/db': () => {
        throw new ApiError({
          code: 'backup.too_recent',
          message: '',
          status: 422,
          fields: { version: '9.0.0', current: '0.2.0' },
        });
      },
    });
    const model = new BackupModel(api, t);
    await model.load();
    model.file = file(10);
    model.understood = true;
    model.word = CONFIRM_WORD;
    await model.restore();
    expect(model.restorePhase).toBe('failed');
    expect(model.restoreFailure?.message).toContain('9.0.0');
  });

  it('refuses a file over the limit before sending anything', async () => {
    const { api, calls } = fakeApi({ 'GET /admin/backup': () => info });
    const model = new BackupModel(api, t);
    await model.load();
    model.file = file(1001);
    model.understood = true;
    model.word = CONFIRM_WORD;
    await model.restore();
    expect(calls).toEqual(['GET /admin/backup']);
    expect(model.restoreFailure?.message).toBe(t('errors.backup.too_large'));
  });

  it('restores assets through the job and summarizes the result', async () => {
    const { api, calls } = fakeApi({
      'GET /admin/backup': () => info,
      'POST /admin/backup/uploads': () => ({ upload_id: 'u2', chunk_bytes: 100 }),
      'PUT /admin/backup/uploads/u2': () => ({ received: 10 }),
      'POST /admin/backup/restore/assets': () => ({
        job: job('pending', 0, null, 'assets_restore'),
      }),
      'POST /jobs/7/step': [
        () => ({ job: job('running', 50, null, 'assets_restore') }),
        () => ({
          job: job(
            'done',
            100,
            { restored: 3, skipped: 1, rejected: 1, rejected_files: ['assets/x.txt'] },
            'assets_restore',
          ),
        }),
      ],
    });
    const model = new BackupModel(api, t);
    await model.load();
    model.setKind('assets');
    model.file = file(10, 'assets.zip');
    model.understood = true;
    model.word = CONFIRM_WORD;
    await model.restore();
    expect(calls.filter((c) => c === 'POST /jobs/7/step')).toHaveLength(2);
    expect(model.restoreOutcome).toEqual({
      kind: 'assets',
      restored: 3,
      skipped: 1,
      rejected: 1,
      rejected_files: ['assets/x.txt'],
    });
  });
});

describe('backups', () => {
  it('steps the job, then downloads the file once', async () => {
    const downloads: string[][] = [];
    const { api } = fakeApi({
      'POST /admin/backup/jobs': () => ({ job: job('pending', 0) }),
      'POST /jobs/7/step': [
        () => ({ job: job('running', 40) }),
        () => ({ job: job('done', 100, { file_name: 'jdr-db-20261103-101010-v0.2.0.sql.gz' }) }),
      ],
    });
    const model = new BackupModel(api, t, { download: (url, name) => downloads.push([url, name]) });
    const running = model.backup('db');
    expect(model.backupKind).toBe('db');
    await running;
    expect(model.backupKind).toBeNull();
    expect(downloads).toEqual([
      ['/api/v1/jobs/7/download', 'jdr-db-20261103-101010-v0.2.0.sql.gz'],
    ]);
    expect(model.backupDone).toBe('jdr-db-20261103-101010-v0.2.0.sql.gz');
  });

  it('reports a failed job without downloading', async () => {
    const downloads: string[] = [];
    const { api } = fakeApi({
      'POST /admin/backup/jobs': () => ({ job: job('pending', 0) }),
      'POST /jobs/7/step': () => ({ job: job('failed', 10, { error: 'backup.archive_limit' }) }),
    });
    const model = new BackupModel(api, t, { download: (url) => downloads.push(url) });
    await model.backup('assets');
    expect(downloads).toEqual([]);
    expect(model.backupFailure?.message).toBe(t('errors.backup.archive_limit'));
    expect(failedJobCode(job('failed', 0, { error: 'x' }))).toBe('x');
  });

  it('computes percentages within bounds', () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 10)).toBe(50);
    expect(percentOf(20, 10)).toBe(100);
  });
});
