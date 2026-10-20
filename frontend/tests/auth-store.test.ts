import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/lib/api';
import type { MeResponse, User } from '../src/lib/types';
import { AuthStore, type ThemeSink } from '../src/stores/auth.svelte';

type FetchArgs = [input: string | URL | Request, init?: RequestInit];
type Handler = (url: string, init: RequestInit) => Response;

const user: User = {
  id: '7',
  email: 'ana@example.test',
  username: 'Ana',
  role: 'user',
  status: 'active',
  locale: 'fr',
  storage_quota_bytes: null,
  storage_used_bytes: 0,
  email_verified_at: null,
  last_login_at: null,
  created_at: '2026-10-20T19:35:00Z',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'rq', ...headers },
  });
}

function me(overrides: Partial<MeResponse> = {}): Response {
  const data: MeResponse = {
    user: null,
    csrf: 'csrf-anon',
    prefs: {},
    registration_mode: 'open',
    smtp_enabled: false,
    ...overrides,
  };
  return json({ ok: true, data, meta: {} });
}

function setup(handler: Handler, onUnauthorized?: () => void) {
  const fetchMock = vi.fn((input: FetchArgs[0], init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  const api = new ApiClient({
    baseUrl: '/api/v1',
    fetch: fetchMock as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
    ...(onUnauthorized ? { onUnauthorized } : {}),
  });
  const theme: ThemeSink & { values: Record<string, string> } = {
    values: { theme_scheme: 'dark', theme_style: 'modern' },
    applyRemote: vi.fn((prefs: Readonly<Record<string, unknown>>) => {
      const missing: string[] = [];
      for (const key of ['theme_scheme', 'theme_style']) {
        const v = prefs[key];
        if (typeof v === 'string') theme.values[key] = v;
        else missing.push(key);
      }
      return missing;
    }),
    setRemoteSync: vi.fn(),
    valueOf: (key: string) => theme.values[key] ?? null,
  };
  const auth = new AuthStore(api, theme);
  return { auth, api, theme, fetchMock };
}

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe('AuthStore.bootstrap', () => {
  it('loads the anonymous session and hands the CSRF token to the API client', async () => {
    const { auth, api } = setup(() => me({ registration_mode: 'invite', smtp_enabled: true }));
    expect(auth.status).toBe('loading');
    await auth.bootstrap();
    expect(auth.status).toBe('ready');
    expect(auth.user).toBeNull();
    expect(auth.registrationMode).toBe('invite');
    expect(auth.smtpEnabled).toBe(true);
    expect(api.csrfToken).toBe('csrf-anon');
  });

  it('applies the account theme and enables the synchronisation when signed in', async () => {
    const { auth, theme } = setup(() =>
      me({ user, prefs: { theme_scheme: 'light', theme_style: 'scifi' } }),
    );
    await auth.bootstrap();
    expect(auth.user?.username).toBe('Ana');
    expect(theme.values).toEqual({ theme_scheme: 'light', theme_style: 'scifi' });
    expect(theme.setRemoteSync).toHaveBeenLastCalledWith(expect.any(Function));
  });

  it('uploads the device theme when the account has none', async () => {
    const puts: string[] = [];
    const { auth } = setup((url, init) => {
      if (init.method === 'PUT') {
        puts.push(`${url} ${String(init.body)}`);
        return new Response(null, { status: 204 });
      }
      return me({ user, prefs: { theme_style: 'fantasy' } });
    });
    await auth.bootstrap();
    await Promise.resolve();
    expect(puts).toEqual(['/api/v1/me/prefs/theme_scheme {"value":"dark"}']);
  });

  it('reports a boot failure without throwing', async () => {
    const { auth } = setup(() =>
      json({ ok: false, error: { code: 'internal_error', message: 'x' } }, 500),
    );
    await auth.bootstrap();
    expect(auth.status).toBe('error');
    expect(auth.error?.code).toBe('internal_error');
    expect(auth.error?.requestId).toBe('rq');
  });
});

describe('AuthStore.login / logout', () => {
  it('sends the CSRF token, switches to the new token and refreshes the session', async () => {
    let signedIn = false;
    const { auth, api, fetchMock } = setup((url) => {
      if (url.endsWith('/auth/login')) {
        signedIn = true;
        return json({ ok: true, data: { user, csrf: 'csrf-user' }, meta: {} });
      }
      return signedIn ? me({ user, csrf: 'csrf-user' }) : me();
    });
    await auth.bootstrap();
    await auth.login({ identifier: 'Ana', password: 'correct horse battery', remember: true });

    const loginCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/login'));
    expect(header(loginCall?.[1], 'X-CSRF-Token')).toBe('csrf-anon');
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      identifier: 'Ana',
      password: 'correct horse battery',
      remember: true,
    });
    expect(auth.user?.id).toBe('7');
    expect(api.csrfToken).toBe('csrf-user');
  });

  it('does not trigger the 401 redirect on invalid credentials', async () => {
    const onUnauthorized = vi.fn();
    const { auth } = setup(
      (url) =>
        url.endsWith('/auth/login')
          ? json({ ok: false, error: { code: 'invalid_credentials', message: 'no' } }, 401)
          : me(),
      onUnauthorized,
    );
    await auth.bootstrap();
    await expect(
      auth.login({ identifier: 'x', password: 'y', remember: false }),
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(auth.user).toBeNull();
  });

  it('exposes Retry-After on 429', async () => {
    const { auth } = setup((url) =>
      url.endsWith('/auth/login')
        ? json({ ok: false, error: { code: 'rate_limited', message: 'slow' } }, 429, {
            'Retry-After': '120',
          })
        : me(),
    );
    await auth.bootstrap();
    await expect(
      auth.login({ identifier: 'x', password: 'y', remember: false }),
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 120 });
  });

  it('logs out, disables the theme synchronisation and gets a new anonymous token', async () => {
    let signedIn = true;
    const { auth, api, theme } = setup((url) => {
      if (url.endsWith('/auth/logout')) {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      return signedIn ? me({ user, csrf: 'csrf-user' }) : me({ csrf: 'csrf-new' });
    });
    await auth.bootstrap();
    await auth.logout();
    expect(auth.user).toBeNull();
    expect(api.csrfToken).toBe('csrf-new');
    expect(theme.setRemoteSync).toHaveBeenLastCalledWith(null);
  });
});

describe('AuthStore on 401', () => {
  it('forgets the user and fetches a fresh session', async () => {
    let expired = false;
    const { auth, api } = setup(() => (expired ? me({ csrf: 'csrf-2' }) : me({ user })));
    await auth.bootstrap();
    expect(auth.user).not.toBeNull();
    expired = true;
    auth.handleUnauthorized();
    expect(auth.user).toBeNull();
    await vi.waitFor(() => expect(api.csrfToken).toBe('csrf-2'));
  });
});
