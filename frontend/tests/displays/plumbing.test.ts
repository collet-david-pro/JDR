import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/lib/api';
import { createDisplayApi, DISPLAY_SYNC_NAME } from '../../src/lib/displays/display-api';
import { DisplaysClient } from '../../src/lib/displays/displays-client';
import { SyncClientImpl } from '../../src/lib/realtime/sync-client';
import { resolveDeps } from '../../src/lib/realtime/deps';
import { harness, json } from '../realtime/helpers';

interface Call {
  method: string;
  url: URL;
  body: unknown;
  csrf: string | null;
}

/** fetch that records the calls and answers with the first matching route. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      csrf: headers.get('X-CSRF-Token'),
    });
    const route = routes[`${method} ${url.pathname.replace('/api/v1', '')}`];
    return Promise.resolve(
      route === undefined ? json({ ok: false, error: { code: 'nope' } }, 404) : route(),
    );
  });
  return { calls, fetch: fetchFn as unknown as typeof fetch };
}

const ok = (data: unknown, status = 200) => json({ ok: true, data, meta: {} }, status);

describe('ApiClient defaultQuery', () => {
  const make = (defaultQuery?: Record<string, string>) => {
    const f = fakeFetch({ 'GET /ping': () => ok({}) });
    const api = new ApiClient({
      baseUrl: '/api/v1',
      fetch: f.fetch,
      ...(defaultQuery === undefined ? {} : { defaultQuery }),
    });
    return { api, f };
  };

  it('is merged into url() and into every request, call parameters win', async () => {
    const { api, f } = make({ as: 'display' });
    expect(api.url('/x', { a: 1 })).toBe('/api/v1/x?as=display&a=1');
    expect(api.url('/x', { as: 'gm' })).toBe('/api/v1/x?as=gm');
    await api.get('/ping');
    await api.get('/ping', { query: { q: 'z' } });
    expect(f.calls.map((c) => c.url.search)).toEqual(['?as=display', '?as=display&q=z']);
  });

  it('has no effect when absent', async () => {
    const { api, f } = make();
    expect(api.url('/x')).toBe('/api/v1/x');
    await api.get('/ping');
    expect(f.calls[0]!.url.search).toBe('');
  });
});

describe('SyncClient name', () => {
  const names = () => {
    const locks: string[] = [];
    const channels: string[] = [];
    return {
      locks,
      channels,
      deps: {
        locks: {
          request: (name: string) => {
            locks.push(name);
            return new Promise<unknown>(() => undefined);
          },
        },
        broadcast: (name: string) => {
          channels.push(name);
          return { onmessage: null, postMessage: () => undefined, close: () => undefined };
        },
      },
    };
  };

  it('keeps the default lock and channel names', () => {
    const n = names();
    const c = new SyncClientImpl(harness().deps(n.deps));
    expect(n.locks).toEqual(['jdr-sync']);
    expect(n.channels).toEqual(['jdr-sync']);
    c.close();
  });

  it('uses its own lock and channel for a screen', () => {
    const n = names();
    const c = new SyncClientImpl(harness().deps({ ...n.deps, name: DISPLAY_SYNC_NAME }));
    expect(DISPLAY_SYNC_NAME).toBe('jdr-sync-display');
    expect(n.locks).toEqual(['jdr-sync-display']);
    expect(n.channels).toEqual(['jdr-sync-display']);
    c.close();
  });

  it('is part of the resolved dependencies only when given', () => {
    const url = (p: string) => p;
    expect(resolveDeps({ url })).not.toHaveProperty('name');
    expect(resolveDeps({ url, name: 'x' }).name).toBe('x');
  });
});

describe('createDisplayApi', () => {
  const me = { id: '5', name: 'Table', settings: {}, session: { id: '12' }, status: 'running' };

  it('sends as=display on every request, the stream URL included', async () => {
    const f = fakeFetch({
      'GET /display/me': () => ok(me),
      'GET /sessions/12/snapshot': () => ok({}),
    });
    const api = createDisplayApi({
      baseUrl: '/api/v1',
      csrfToken: 'anon',
      onUnpaired: () => undefined,
      fetch: f.fetch,
      sync: { locks: null, broadcast: null, eventSource: null },
    });
    await api.device.me();
    await api.sessions.snapshot('12');
    expect(f.calls.map((c) => c.url.searchParams.get('as'))).toEqual(['display', 'display']);
    expect(api.api.url('/events', { channels: 'session:12' })).toBe(
      '/api/v1/events?as=display&channels=session%3A12',
    );
    api.sync.close();
  });

  it('reports a 401 as an unpaired screen (never a redirection)', async () => {
    const onUnpaired = vi.fn();
    const f = fakeFetch({
      'GET /display/me': () =>
        json({ ok: false, error: { code: 'display_unpaired', message: 'x' } }, 401),
    });
    const api = createDisplayApi({
      baseUrl: '/api/v1',
      csrfToken: 'anon',
      onUnpaired,
      fetch: f.fetch,
      sync: { locks: null, broadcast: null, eventSource: null },
    });
    await expect(api.device.me()).rejects.toMatchObject({ status: 401 });
    expect(onUnpaired).toHaveBeenCalledTimes(1);
    api.sync.close();
  });

  it('renews the anonymous CSRF token through GET /auth/me', async () => {
    let first = true;
    const f = fakeFetch({
      'POST /display/pair': () => {
        if (first) {
          first = false;
          return json({ ok: false, error: { code: 'csrf_invalid', message: 'x' } }, 403);
        }
        return ok({ display: me });
      },
      'GET /auth/me': () => ok({ user: null, csrf: 'fresh' }),
    });
    const api = createDisplayApi({
      baseUrl: '/api/v1',
      csrfToken: 'stale',
      onUnpaired: () => undefined,
      fetch: f.fetch,
      sync: { locks: null, broadcast: null, eventSource: null },
    });
    const paired = await api.device.pair(' K7F2-QM9X ');
    expect(paired.id).toBe('5');
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname.replace('/api/v1', '')}`)).toEqual([
      'POST /display/pair',
      'GET /auth/me',
      'POST /display/pair',
    ]);
    expect(f.calls[0]!.csrf).toBe('stale');
    expect(f.calls[2]!.csrf).toBe('fresh');
    expect(f.calls[2]!.body).toEqual({ code: 'K7F2-QM9X' });
    api.sync.close();
  });

  it('patches only the settings it is given', async () => {
    const f = fakeFetch({ 'PATCH /display/me': () => ok(me) });
    const api = createDisplayApi({
      baseUrl: '/api/v1',
      csrfToken: 'c',
      onUnpaired: () => undefined,
      fetch: f.fetch,
      sync: { locks: null, broadcast: null, eventSource: null },
    });
    await api.device.patchMe({ rotation: 90, mirror: true });
    expect(f.calls[0]!.body).toEqual({ settings: { rotation: 90, mirror: true } });
    api.sync.close();
  });
});

describe('DisplaysClient (GM)', () => {
  it('calls the GM endpoints', async () => {
    const info = { id: '9', pairing: null };
    const f = fakeFetch({
      'POST /sessions/12/displays': () => ok(info, 201),
      'GET /sessions/12/displays': () => ok({ displays: [info] }),
      'PATCH /displays/9': () => ok(info),
      'DELETE /displays/9': () => new Response(null, { status: 204 }),
      'POST /displays/9/regenerate-code': () => ok(info),
    });
    const client = new DisplaysClient(
      new ApiClient({ baseUrl: '/api/v1', fetch: f.fetch, csrfToken: 'c' }),
    );
    await client.create('12', 'Table');
    expect((await client.list('12')).displays).toHaveLength(1);
    expect('attach' in client).toBe(false);
    await client.update('9', { name: 'Salon', settings: { mirror: true } });
    await client.remove('9');
    await client.regenerateCode('9');
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname.replace('/api/v1', '')}`)).toEqual([
      'POST /sessions/12/displays',
      'GET /sessions/12/displays',
      'PATCH /displays/9',
      'DELETE /displays/9',
      'POST /displays/9/regenerate-code',
    ]);
    expect(f.calls[0]!.body).toEqual({ name: 'Table' });
    expect(f.calls[2]!.body).toEqual({ name: 'Salon', settings: { mirror: true } });
  });
});
