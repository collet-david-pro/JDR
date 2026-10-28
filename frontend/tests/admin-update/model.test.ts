import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  UpdateModel,
  compareVersions,
  isNewerRelease,
  isResumable,
  resumeUrl,
  updateError,
  type UpdateApiClient,
  type UpdateInfo,
  type UpdateRun,
} from '../../src/lib/admin-update.svelte';
import { ApiError } from '../../src/lib/api';
import { createTranslator, toMessages } from '../../src/lib/translator';

const read = (path: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const tree = read('../../../i18n/fr.json') as Record<string, unknown>;
const t = createTranslator({ locale: 'fr', messages: toMessages(tree) });

const info: UpdateInfo = {
  current: '0.1.0',
  db_version: '0003',
  required_db_version: '0003',
  channel: 'stable',
  check: null,
  pending: null,
  run: null,
  upload_max_bytes: 104_857_600,
  chunk_bytes: 10,
  php: { upload_max_filesize: '2M', post_max_size: '8M' },
  update_url: 'http://x/update.php',
};
const summary = {
  id: 'p1',
  version: '0.2.0',
  current: '0.1.0',
  authenticity: 'unverified',
  sha256: 'a',
  size: 25,
  files: { added: 1, changed: 2, removed: 0, unchanged: 5 },
  changes: { added: ['a'], changed: ['b', 'c'], removed: [] },
  migrations: ['0004_x.sql'],
  warnings: [],
  uploaded_at: '2026-10-28T10:00:00Z',
};

function fakeApi(
  handlers: Record<string, (body: unknown, opts: Record<string, unknown>) => unknown>,
) {
  const calls: string[] = [];
  const call = (method: string) => async (path: string, body?: unknown, opts?: unknown) => {
    const key = `${method} ${path}`;
    calls.push(key);
    const handler = handlers[key];
    if (handler === undefined) throw new Error(`unexpected ${key}`);
    const data = handler(body, (opts ?? {}) as Record<string, unknown>);
    return { data, meta: {}, status: 200, requestId: null };
  };
  const api = {
    get: call('GET'),
    post: call('POST'),
    put: call('PUT'),
    patch: call('PATCH'),
    delete: (path: string, opts?: unknown) => call('DELETE')(path, undefined, opts),
  } as unknown as UpdateApiClient;
  return { api, calls };
}

describe('upload flow', () => {
  it('hashes, uploads in chunks, completes and exposes the pending summary', async () => {
    const puts: number[] = [];
    const { api, calls } = fakeApi({
      'GET /admin/update': () => info,
      'POST /admin/update/uploads': (body) => {
        expect(body).toEqual({ size: 25, sha256: 'deadbeef' });
        return { upload_id: 'u1', chunk_bytes: 10 };
      },
      'PUT /admin/update/uploads/u1': (body, opts) => {
        const offset = (opts['query'] as { offset: number }).offset;
        puts.push(offset);
        return { received: offset + (body as Blob).size };
      },
      'POST /admin/update/uploads/u1/complete': () => ({ pending: summary }),
    });
    const model = new UpdateModel(api, t, { sha256: async () => 'deadbeef' });
    await model.load();
    await model.send(new File([new Uint8Array(25)], 'u.zip'));
    expect(puts).toEqual([0, 10, 20]);
    expect(calls.at(-1)).toBe('POST /admin/update/uploads/u1/complete');
    expect(model.pending?.version).toBe('0.2.0');
    expect(model.phase).toBe('idle');
    expect(model.uploadFailure).toBeNull();
  });

  it('shows the translated server error and keeps no pending package', async () => {
    const { api } = fakeApi({
      'GET /admin/update': () => info,
      'POST /admin/update/uploads': () => ({ upload_id: 'u1', chunk_bytes: 100 }),
      'PUT /admin/update/uploads/u1': (b) => ({ received: (b as Blob).size }),
      'POST /admin/update/uploads/u1/complete': () => {
        throw new ApiError({ code: 'update.invalid_zip', message: 'x', status: 422 });
      },
    });
    const model = new UpdateModel(api, t, { sha256: async () => 'h' });
    await model.load();
    await model.send(new File(['hello'], 'a.zip'));
    expect(model.uploadFailure?.message).toBe("Ce fichier n'est pas une archive zip valide.");
    expect(model.pending).toBeNull();
  });

  it('refuses a file over the limit without calling the server', async () => {
    const { api, calls } = fakeApi({
      'GET /admin/update': () => ({ ...info, upload_max_bytes: 3 }),
    });
    const model = new UpdateModel(api, t, { sha256: async () => 'h' });
    await model.load();
    await model.send(new File(['hello'], 'a.zip'));
    expect(calls).toEqual(['GET /admin/update']);
    expect(model.uploadFailure?.message).toContain('trop volumineuse');
  });
});

describe('actions', () => {
  it('install sends confirm_unverified and navigates to the redirect', async () => {
    const navigate = vi.fn();
    const { api } = fakeApi({
      'GET /admin/update': () => ({ ...info, pending: summary }),
      'POST /admin/update/start': (body) => {
        expect(body).toEqual({ confirm_unverified: true });
        return { redirect: 'http://x/update.php?id=r1', run: {} };
      },
    });
    const model = new UpdateModel(api, t, { navigate });
    await model.load();
    await model.install(true);
    expect(navigate).toHaveBeenCalledWith('http://x/update.php?id=r1');
  });

  it('discard clears the pending package', async () => {
    const { api } = fakeApi({
      'GET /admin/update': () => ({ ...info, pending: summary }),
      'DELETE /admin/update/pending': () => null,
    });
    const model = new UpdateModel(api, t);
    await model.load();
    await model.discard();
    expect(model.pending).toBeNull();
  });

  it('a 429 on check exposes Retry-After instead of an error', async () => {
    const api = {
      get: async () => ({ data: info, meta: {}, status: 200, requestId: null }),
      post: async () => {
        throw new ApiError({ code: 'rate_limited', message: '', status: 429, retryAfter: 17 });
      },
    } as unknown as UpdateApiClient;
    const model = new UpdateModel(api, t);
    await model.runCheck();
    expect(model.retryAfter).toBe(17);
    expect(model.actionFailure).toBeNull();
    expect(t('admin.update.check.rate_limited', { seconds: 17 })).toContain('17 s');
  });
});

describe('state helpers', () => {
  const run = (state: string): UpdateRun => ({
    id: 'r1',
    mode: 'upload',
    from: '0.1.0',
    to: '0.2.0',
    step: 's',
    state,
    error: null,
    progress: null,
    updated_at: '',
  });

  it('flags the resumable run states only', () => {
    for (const s of ['running', 'rolling_back', 'restoring', 'failed_migration']) {
      expect(isResumable(run(s))).toBe(true);
    }
    expect(isResumable(run('done'))).toBe(false);
    expect(isResumable(null)).toBe(false);
    expect(resumeUrl(info, run('running'))).toBe('http://x/update.php?id=r1');
  });

  it('compares versions with semver precedence', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('x', '1.0.0')).toBeNull();
    const latest = {
      version: '0.1.0',
      name: null,
      published_at: null,
      notes: null,
      html_url: null,
      update_asset: null,
    };
    expect(
      isNewerRelease({ current: '0.1.0', channel: 'stable', latest, checked_at: '', error: null }),
    ).toBe(false);
    expect(
      isNewerRelease({
        current: '0.1.0',
        channel: 'stable',
        latest: { ...latest, version: '0.1.1' },
        checked_at: '',
        error: null,
      }),
    ).toBe(true);
  });
});

describe('error messages and translations', () => {
  it('interpolates the fields of update.* errors', () => {
    const e = (code: string, fields: Record<string, string>) =>
      updateError(new ApiError({ code, message: '', status: 422, fields }), t).message;
    expect(e('update.not_newer', { version: '0.1.0', current: '0.1.0' })).toContain('0.1.0');
    expect(e('update.unsafe_path', { path: '../x.php' })).toContain('../x.php');
    expect(e('update.file_hash', { path: 'a.php', reason: 'mismatch' })).toContain('a.php');
    expect(e('update.file_hash', { path: 'a.php', reason: 'mismatch' })).toContain(
      'empreinte annoncée',
    );
    expect(
      e('update.hash_mismatch', { expected: 'e'.repeat(64), actual: 'a'.repeat(64) }),
    ).toContain('…');
  });

  it('has every key used by the screen', () => {
    const codes = [
      'too_large',
      'bad_offset',
      'upload_incomplete',
      'upload_hash',
      'invalid_zip',
      'unsafe_path',
      'missing_manifest',
      'file_hash',
      'not_newer',
      'hash_mismatch',
      'run_in_progress',
      'unverified',
      'no_package',
      'version_changed',
    ];
    const keys = [
      'admin.tabs.update',
      'admin.update.title',
      'admin.update.errors.no_crypto',
      ...codes.map((c) => `errors.update.${c}`),
      ...['mismatch', 'unlisted', 'missing'].map((r) => `admin.update.file_hash_reason.${r}`),
      ...['unreachable', 'invalid_response'].map((r) => `admin.update.check.error_${r}`),
      ...['running', 'rolling_back', 'restoring', 'failed_migration'].map(
        (s) => `admin.update.run.state_${s}`,
      ),
      ...['added', 'changed', 'removed'].map((k) => `admin.update.summary.files_${k}`),
    ];
    for (const key of keys) expect(t(key, { count: 2 }), key).not.toBe(key);
  });
});
