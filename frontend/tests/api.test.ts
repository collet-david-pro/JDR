import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, buildApiUrl, type ApiClientOptions } from '../src/lib/api';

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1', ...headers },
  });
}

function client(
  fetchMock: (...args: FetchArgs) => Promise<Response>,
  options: Partial<ApiClientOptions> = {},
) {
  const sleep = vi.fn(() => Promise.resolve());
  const api = new ApiClient({
    baseUrl: '/api/v1',
    fetch: vi.fn(fetchMock) as unknown as typeof fetch,
    sleep,
    ...options,
  });
  return { api, sleep };
}

function calls(api: ApiClient): FetchArgs[] {
  // Access the injected mock through a typed cast of the private field.
  const fetchImpl = (api as unknown as { fetchImpl: ReturnType<typeof vi.fn> }).fetchImpl;
  return fetchImpl.mock.calls as FetchArgs[];
}

describe('buildApiUrl', () => {
  it('joins base, path and query (rewrite mode)', () => {
    expect(buildApiUrl('/base/api/v1', '/games/12')).toBe('/base/api/v1/games/12');
    expect(buildApiUrl('/api/v1/', '/games', { role: 'gm', limit: 50, cursor: null })).toBe(
      '/api/v1/games?role=gm&limit=50',
    );
  });

  it('appends query parameters with "&" when the base already has "?r=" (query mode)', () => {
    expect(buildApiUrl('/base/index.php?r=/api/v1', '/health')).toBe(
      '/base/index.php?r=/api/v1/health',
    );
    expect(
      buildApiUrl('/base/index.php?r=/api/v1', '/events', {
        channels: ['session:1', 'map:2'],
        since: 10,
      }),
    ).toBe('/base/index.php?r=/api/v1/events&channels=session%3A1%2Cmap%3A2&since=10');
  });

  it('encodes values and rejects malformed paths', () => {
    expect(buildApiUrl('/api/v1', '/assets', { q: 'a&b c' })).toBe('/api/v1/assets?q=a%26b+c');
    expect(() => buildApiUrl('/api/v1', 'games')).toThrow();
    expect(() => buildApiUrl('/api/v1', '/games?x=1')).toThrow();
  });
});

describe('ApiClient envelope', () => {
  it('returns data, meta, status and request id on success', async () => {
    const { api } = client(() =>
      Promise.resolve(jsonResponse({ ok: true, data: { id: '1' }, meta: { next_cursor: 'abc' } })),
    );
    const res = await api.get<{ id: string }>('/games/1');
    expect(res.data).toEqual({ id: '1' });
    expect(res.meta).toEqual({ next_cursor: 'abc' });
    expect(res.status).toBe(200);
    expect(res.requestId).toBe('req-1');
    const [url, init] = calls(api)[0] ?? [];
    expect(url).toBe('/api/v1/games/1');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('same-origin');
  });

  it('handles 204 No Content', async () => {
    const { api } = client(() => Promise.resolve(new Response(null, { status: 204 })));
    const res = await api.delete('/games/1');
    expect(res.data).toBeNull();
    expect(res.status).toBe(204);
  });

  it('throws a typed ApiError from an error envelope', async () => {
    const { api } = client(() =>
      Promise.resolve(
        jsonResponse(
          {
            ok: false,
            error: {
              code: 'validation_failed',
              message: 'Invalid',
              fields: { name: 'Required', tags: ['a', 'b'] },
            },
          },
          422,
          { 'X-Request-Id': 'req-42' },
        ),
      ),
    );
    const error = await api.post('/games', { name: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('validation_failed');
    expect(apiError.status).toBe(422);
    expect(apiError.requestId).toBe('req-42');
    expect(apiError.message).toBe('Invalid');
    expect(apiError.fields).toEqual({ name: 'Required', tags: 'a b' });
  });

  it('rejects a success response without a valid envelope', async () => {
    const { api } = client(() => Promise.resolve(new Response('<html>', { status: 200 })));
    await expect(api.get('/health', { retries: 0 })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('maps a non-JSON error page to http_error', async () => {
    const { api } = client(() => Promise.resolve(new Response('Internal error', { status: 500 })));
    await expect(api.get('/health')).rejects.toMatchObject({ code: 'http_error', status: 500 });
  });

  it('serialises JSON bodies and passes FormData through', async () => {
    const { api } = client(() => Promise.resolve(jsonResponse({ ok: true, data: null })));
    await api.post('/games', { name: 'Campagne' });
    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.png');
    await api.post('/assets', form);
    const [, jsonInit] = calls(api)[0] ?? [];
    expect(jsonInit?.body).toBe('{"name":"Campagne"}');
    expect(new Headers(jsonInit?.headers).get('Content-Type')).toBe('application/json');
    const [, formInit] = calls(api)[1] ?? [];
    expect(formInit?.body).toBe(form);
    expect(new Headers(formInit?.headers).has('Content-Type')).toBe(false);
  });
});

describe('ApiClient CSRF', () => {
  it('sends X-CSRF-Token on non-GET requests only, once known', async () => {
    const { api } = client(() => Promise.resolve(jsonResponse({ ok: true, data: null })));
    await api.post('/auth/logout');
    expect(new Headers(calls(api)[0]?.[1]?.headers).has('X-CSRF-Token')).toBe(false);

    api.setCsrfToken('tok-123');
    await api.get('/auth/me');
    await api.patch('/me', { display_name: 'A' });
    await api.delete('/games/1');
    expect(new Headers(calls(api)[1]?.[1]?.headers).has('X-CSRF-Token')).toBe(false);
    expect(new Headers(calls(api)[2]?.[1]?.headers).get('X-CSRF-Token')).toBe('tok-123');
    expect(new Headers(calls(api)[3]?.[1]?.headers).get('X-CSRF-Token')).toBe('tok-123');
  });

  it('uses the boot token', async () => {
    const { api } = client(() => Promise.resolve(jsonResponse({ ok: true, data: null })), {
      csrfToken: 'boot-token',
    });
    await api.put('/me/prefs/theme', { value: 'dark' });
    expect(new Headers(calls(api)[0]?.[1]?.headers).get('X-CSRF-Token')).toBe('boot-token');
  });
});

describe('ApiClient retries', () => {
  it('retries idempotent GETs on network errors with exponential backoff', async () => {
    let attempt = 0;
    const { api, sleep } = client(
      () => {
        attempt++;
        if (attempt < 3) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(jsonResponse({ ok: true, data: 'ok' }));
      },
      { retryDelayMs: 100 },
    );
    const res = await api.get<string>('/health');
    expect(res.data).toBe('ok');
    expect(calls(api)).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it('gives up after 2 retries', async () => {
    const { api } = client(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.get('/health')).rejects.toMatchObject({ code: 'network_error', status: 0 });
    expect(calls(api)).toHaveLength(3);
  });

  it('retries GETs on 502/504 but not on 4xx', async () => {
    let attempt = 0;
    const { api } = client(() => {
      attempt++;
      return Promise.resolve(
        attempt === 1
          ? new Response('Bad gateway', { status: 502 })
          : jsonResponse({ ok: true, data: 1 }),
      );
    });
    await expect(api.get('/health')).resolves.toMatchObject({ data: 1 });
    expect(calls(api)).toHaveLength(2);

    const notFound = client(() =>
      Promise.resolve(jsonResponse({ ok: false, error: { code: 'not_found', message: 'x' } }, 404)),
    );
    await expect(notFound.api.get('/games/9')).rejects.toMatchObject({ code: 'not_found' });
    expect(calls(notFound.api)).toHaveLength(1);
  });

  it('never retries non-idempotent methods', async () => {
    const { api } = client(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.post('/games', {})).rejects.toMatchObject({ code: 'network_error' });
    expect(calls(api)).toHaveLength(1);
  });
});

describe('ApiClient timeout and abort', () => {
  /** fetch double that never resolves until its signal aborts. */
  const hangingFetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });

  it('aborts after the timeout and reports a timeout error', async () => {
    vi.useFakeTimers();
    try {
      const { api } = client(hangingFetch, { timeoutMs: 15_000 });
      const promise = api.post('/games', {}).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(calls(api)[0]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await promise;
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a timed-out GET', async () => {
    vi.useFakeTimers();
    try {
      let attempt = 0;
      const { api } = client(
        (input, init) => {
          attempt++;
          return attempt === 1
            ? hangingFetch(input, init)
            : Promise.resolve(jsonResponse({ ok: true, data: 2 }));
        },
        { timeoutMs: 1000 },
      );
      const promise = api.get('/health');
      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toMatchObject({ data: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a caller abort without retrying', async () => {
    const controller = new AbortController();
    const { api } = client(hangingFetch);
    const promise = api.get('/health', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'aborted' });
    expect(calls(api)).toHaveLength(1);
  });
});

describe('ApiClient 401 / 503 callbacks', () => {
  it('calls onUnauthorized on 401', async () => {
    const onUnauthorized = vi.fn();
    const { api } = client(
      () =>
        Promise.resolve(
          jsonResponse({ ok: false, error: { code: 'unauthenticated', message: 'Login' } }, 401),
        ),
      { onUnauthorized },
    );
    await expect(api.get('/games')).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(api.post('/auth/login', {}, { notifyUnauthorized: false })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('calls onMaintenance on 503 with Retry-After', async () => {
    const onMaintenance = vi.fn();
    const { api } = client(
      () =>
        Promise.resolve(
          jsonResponse({ ok: false, error: { code: 'maintenance', message: 'Maintenance' } }, 503, {
            'Retry-After': '120',
          }),
        ),
      { onMaintenance },
    );
    const error = (await api.get('/health').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('maintenance');
    expect(error.retryAfter).toBe(120);
    expect(onMaintenance).toHaveBeenCalledWith(error);
    expect(calls(api)).toHaveLength(1);
  });
});

describe('ApiClient CSRF renewal', () => {
  it('refreshes the token and replays a write once after 403 csrf_invalid', async () => {
    let token = 'old';
    const sent: (string | null)[] = [];
    const api: ApiClient = new ApiClient({
      baseUrl: '/api/v1',
      csrfToken: token,
      sleep: () => Promise.resolve(),
      refreshCsrf: () => {
        token = 'new';
        api.setCsrfToken(token);
        return Promise.resolve();
      },
      fetch: ((_url: string, init?: RequestInit) => {
        const header = new Headers(init?.headers).get('X-CSRF-Token');
        sent.push(header);
        return Promise.resolve(
          header === 'new'
            ? jsonResponse({ ok: true, data: { done: true } })
            : jsonResponse({ ok: false, error: { code: 'csrf_invalid', message: '' } }, 403),
        );
      }) as unknown as typeof fetch,
    });
    const res = await api.post<{ done: boolean }>('/games', { name: 'x' });
    expect(res.data.done).toBe(true);
    expect(sent).toEqual(['old', 'new']);
  });

  it('gives up after one renewal', async () => {
    const refreshCsrf = vi.fn(() => Promise.resolve());
    const { api } = client(
      () =>
        Promise.resolve(
          jsonResponse({ ok: false, error: { code: 'csrf_invalid', message: '' } }, 403),
        ),
      { refreshCsrf },
    );
    await expect(api.post('/games')).rejects.toMatchObject({ code: 'csrf_invalid' });
    expect(refreshCsrf).toHaveBeenCalledTimes(1);
  });
});
