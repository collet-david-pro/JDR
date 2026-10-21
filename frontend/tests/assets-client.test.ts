import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/lib/api';
import { AssetsClient, assetQuery, usagesFromError } from '../src/lib/assets/assets-client';
import type { Asset, Job } from '../src/lib/types';
import { fakeXhrFactory } from './fixtures/fake-xhr';

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

const asset: Asset = {
  id: '5',
  uuid: 'u-5',
  name: 'Mur',
  kind: 'tile',
  mime: 'image/png',
  width: 64,
  height: 64,
  is_animated: false,
  frame_count: 1,
  duration_ms: 0,
  size_bytes: 1000,
  scope: 'personal',
  owner_id: '1',
  category_id: null,
  tags: [],
  favorite: false,
  source: 'upload',
  created_at: '2026-10-21T08:00:00Z',
  urls: { full: '/api/v1/files/u-5?t=full', thumb: '/api/v1/files/u-5?t=thumb' },
};

const ok = (data: unknown, meta: Record<string, unknown> = {}) => ({ ok: true, data, meta });
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'rq' },
  });

function setup(
  options: {
    base?: string;
    fetch?: (...args: FetchArgs) => Promise<Response>;
    refreshCsrf?: () => Promise<void>;
    onUnauthorized?: () => void;
  } = {},
) {
  const fetchMock = vi.fn(options.fetch ?? (() => Promise.resolve(json(ok(null)))));
  const api = new ApiClient({
    baseUrl: options.base ?? '/api/v1',
    fetch: fetchMock as unknown as typeof fetch,
    csrfToken: 'tok',
    sleep: () => Promise.resolve(),
    ...(options.refreshCsrf ? { refreshCsrf: options.refreshCsrf } : {}),
    ...(options.onUnauthorized ? { onUnauthorized: options.onUnauthorized } : {}),
  });
  return { api, fetchMock };
}

describe('assetQuery', () => {
  it('drops empty filters and encodes favorites as 1', () => {
    expect(
      assetQuery({ scope: 'mine', kind: '', q: '  ', tag: '', category: '', favorites: false }),
    ).toEqual({ scope: 'mine', kind: null, q: null, tag: null, category: null, favorites: null });
    expect(
      assetQuery({ scope: 'general', kind: 'token', q: ' orc ', tag: 'x', favorites: true }),
    ).toMatchObject({ scope: 'general', kind: 'token', q: 'orc', tag: 'x', favorites: 1 });
  });
});

describe('AssetsClient JSON calls', () => {
  it('lists assets with the filters and the cursor, in query routing mode', async () => {
    const { api, fetchMock } = setup({
      base: '/jdr/index.php?r=/api/v1',
      fetch: () => Promise.resolve(json(ok([asset], { next_cursor: 'c2' }))),
    });
    const page = await new AssetsClient(api).list({ scope: 'mine', kind: 'tile', q: 'mur' }, 'c1');
    expect(page).toEqual({ items: [asset], next: 'c2' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/jdr/index.php?r=/api/v1/assets&scope=mine&kind=tile&q=mur&cursor=c1&limit=50',
    );
  });

  it('caches the limits but not a failure', async () => {
    let calls = 0;
    const { api } = setup({
      fetch: () => {
        calls++;
        return Promise.resolve(
          calls === 1
            ? json({ ok: false, error: { code: 'internal_error', message: 'x' } }, 500)
            : json(ok({ max_upload_bytes: 1 })),
        );
      },
    });
    const client = new AssetsClient(api);
    await expect(client.limits()).rejects.toBeInstanceOf(ApiError);
    await expect(client.limits()).resolves.toEqual({ max_upload_bytes: 1 });
    await client.limits();
    expect(calls).toBe(2);
  });

  it('deletes with force=1 and exposes the usages of a 409 asset_in_use', async () => {
    const usages = { maps: [{ id: 3, name: 'Crypte' }], tokens: [{ id: '9', name: 'Orc' }] };
    const { api, fetchMock } = setup({
      fetch: (url) =>
        Promise.resolve(
          String(url).includes('force=1')
            ? new Response(null, { status: 204 })
            : json({ ok: false, error: { code: 'asset_in_use', message: 'in use', usages } }, 409),
        ),
    });
    const client = new AssetsClient(api);
    const error = await client.remove('5').catch((e: unknown) => e);
    expect(usagesFromError(error)).toEqual({
      maps: [{ id: '3', name: 'Crypte' }],
      tokens: [{ id: '9', name: 'Orc' }],
    });
    await client.remove('5', true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/assets/5?force=1');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(usagesFromError(new Error('x'))).toBeNull();
  });

  it('toggles favorites with PUT / DELETE and sends PATCH bodies as JSON', async () => {
    const { api, fetchMock } = setup({ fetch: () => Promise.resolve(json(ok(asset))) });
    const client = new AssetsClient(api);
    await client.setFavorite('5', true);
    await client.setFavorite('5', false);
    await client.update('5', { name: 'Mur 2', tags: ['pierre'] });
    const methods = fetchMock.mock.calls.map(([, init]) => init?.method);
    expect(methods).toEqual(['PUT', 'DELETE', 'PATCH']);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe('{"name":"Mur 2","tags":["pierre"]}');
  });

  it('drives jobs: export, step, cancel and download URL', async () => {
    const job: Job = {
      id: '7',
      type: 'pack_export',
      status: 'pending',
      progress: { done: 0, total: 2, percent: 0 },
      result: null,
    };
    const { api, fetchMock } = setup({ fetch: () => Promise.resolve(json(ok({ job }), 202)) });
    const client = new AssetsClient(api);
    await expect(client.exportPack({ asset_ids: ['1', '2'] })).resolves.toEqual(job);
    await client.stepJob('7');
    await client.cancelJob('7');
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      '/api/v1/asset-packs/export',
      '/api/v1/jobs/7/step',
      '/api/v1/jobs/7/cancel',
    ]);
    expect(client.jobDownloadUrl('7')).toBe('/api/v1/jobs/7/download');
  });
});

describe('AssetsClient upload (XHR multipart)', () => {
  it('posts the multipart fields with the CSRF header and reports progress', async () => {
    const { api } = setup({ base: '/b/index.php?r=/api/v1' });
    const { factory, requests } = fakeXhrFactory((xhr) => {
      xhr.progress(50, 100);
      xhr.respond({ status: 201, body: ok(asset) });
    });
    const onProgress = vi.fn();
    const result = await new AssetsClient(api, factory).upload(
      new Blob(['x'], { type: 'image/png' }),
      'mur.png',
      { kind: 'tile', name: 'Mur', category_id: '4', scope: 'general', client_op_id: 'op-1' },
      { onProgress },
    );
    expect(result).toEqual({ asset, duplicate: false });
    const xhr = requests[0];
    expect(xhr?.method).toBe('POST');
    expect(xhr?.url).toBe('/b/index.php?r=/api/v1/assets');
    expect(xhr?.headers['X-CSRF-Token']).toBe('tok');
    expect(xhr?.withCredentials).toBe(true);
    const body = xhr?.body;
    expect(body?.get('kind')).toBe('tile');
    expect(body?.get('name')).toBe('Mur');
    expect(body?.get('category_id')).toBe('4');
    expect(body?.get('scope')).toBe('general');
    expect(body?.get('client_op_id')).toBe('op-1');
    expect((body?.get('file') as File).name).toBe('mur.png');
    expect(onProgress).toHaveBeenCalledWith(50, 100);
  });

  it('flags duplicates (200 + meta.duplicate)', async () => {
    const { api } = setup();
    const { factory } = fakeXhrFactory((xhr) =>
      xhr.respond({ status: 200, body: ok(asset, { duplicate: true }) }),
    );
    const result = await new AssetsClient(api, factory).upload(new Blob(['x']), 'a.png', {
      kind: 'object',
    });
    expect(result.duplicate).toBe(true);
  });

  it.each([
    [413, 'file_too_large'],
    [415, 'unsupported_type'],
    [422, 'image_too_large'],
    [422, 'animation_too_long'],
    [413, 'quota_exceeded'],
    [429, 'rate_limited'],
  ])('turns HTTP %i into ApiError %s', async (status, code) => {
    const { api } = setup();
    const { factory } = fakeXhrFactory((xhr) =>
      xhr.respond({
        status,
        body: { ok: false, error: { code, message: code } },
        headers: { 'Retry-After': '12' },
      }),
    );
    const error = await new AssetsClient(api, factory)
      .upload(new Blob(['x']), 'a.png', { kind: 'object' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).retryAfter).toBe(12);
    expect((error as ApiError).requestId).toBe('rq-x');
  });

  it('renews the CSRF token once after csrf_invalid', async () => {
    const refreshCsrf = vi.fn(() => {
      api.setCsrfToken('fresh');
      return Promise.resolve();
    });
    const { api } = setup({ refreshCsrf });
    const { factory, requests } = fakeXhrFactory((xhr, index) =>
      xhr.respond(
        index === 0
          ? { status: 403, body: { ok: false, error: { code: 'csrf_invalid', message: '' } } }
          : { status: 201, body: ok(asset) },
      ),
    );
    await new AssetsClient(api, factory).upload(new Blob(['x']), 'a.png', { kind: 'object' });
    expect(refreshCsrf).toHaveBeenCalledOnce();
    expect(requests.map((r) => r.headers['X-CSRF-Token'])).toEqual(['tok', 'fresh']);
  });

  it('reports 401 to the client callbacks, network errors and cancellation', async () => {
    const onUnauthorized = vi.fn();
    const { api } = setup({ onUnauthorized });
    const unauth = fakeXhrFactory((xhr) =>
      xhr.respond({ status: 401, body: { ok: false, error: { code: 'unauthenticated' } } }),
    );
    await expect(
      new AssetsClient(api, unauth.factory).upload(new Blob(['x']), 'a', { kind: 'tile' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(onUnauthorized).toHaveBeenCalledOnce();

    const offline = fakeXhrFactory((xhr) => xhr.fail());
    await expect(
      new AssetsClient(api, offline.factory).upload(new Blob(['x']), 'a', { kind: 'tile' }),
    ).rejects.toMatchObject({ code: 'network_error' });

    const controller = new AbortController();
    const pending = fakeXhrFactory(() => controller.abort());
    await expect(
      new AssetsClient(api, pending.factory).upload(
        new Blob(['x']),
        'a',
        { kind: 'tile' },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(pending.requests[0]?.aborted).toBe(true);
  });

  it('imports a pack as multipart and returns the job', async () => {
    const { api } = setup();
    const job = { id: '3', type: 'pack_import', status: 'pending', progress: {}, result: null };
    const { factory, requests } = fakeXhrFactory((xhr) =>
      xhr.respond({ status: 202, body: ok({ job }) }),
    );
    await expect(
      new AssetsClient(api, factory).importPack(new Blob(['zip']), 'pack.zip', 'general'),
    ).resolves.toEqual(job);
    expect(requests[0]?.url).toBe('/api/v1/asset-packs/import');
    expect(requests[0]?.body?.get('scope')).toBe('general');
  });
});
