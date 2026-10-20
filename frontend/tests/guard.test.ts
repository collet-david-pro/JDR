import { describe, expect, it, vi } from 'vitest';
import {
  decideAccess,
  loginPath,
  requiresLogin,
  safeNext,
  type AuthSnapshot,
} from '../src/lib/guard';
import { RouteView } from '../src/lib/route-view.svelte';
import { Router, type AppLocation, type RouteDefinition, type WindowLike } from '../src/router';

function loc(path: string, query = ''): AppLocation {
  return { path, query: new URLSearchParams(query) };
}

const anonymous: AuthSnapshot = { status: 'ready', user: null };
const member: AuthSnapshot = { status: 'ready', user: { role: 'user' } };
const admin: AuthSnapshot = { status: 'ready', user: { role: 'admin' } };
const loading: AuthSnapshot = { status: 'loading', user: null };

describe('safeNext', () => {
  it('accepts application paths only', () => {
    expect(safeNext('/games/12?tab=maps')).toBe('/games/12?tab=maps');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('https://evil.test/')).toBe('/');
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext('/\\evil.test')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
    expect(safeNext('/login?next=/x')).toBe('/');
    expect(safeNext('/invite/ABC')).toBe('/');
  });
});

describe('loginPath', () => {
  it('keeps the current path and query in ?next', () => {
    expect(loginPath(loc('/profile'))).toBe('/login?next=%2Fprofile');
    expect(loginPath(loc('/games/1', 'tab=maps'))).toBe('/login?next=%2Fgames%2F1%3Ftab%3Dmaps');
    expect(loginPath(loc('/'))).toBe('/login');
  });
});

describe('decideAccess', () => {
  it('always allows public routes, even while the session loads', () => {
    expect(decideAccess('public', loading, loc('/display'))).toEqual({ kind: 'allow' });
    expect(decideAccess('public', member, loc('/reset/x'))).toEqual({ kind: 'allow' });
  });

  it('waits for the session for the other routes', () => {
    expect(decideAccess('protected', loading, loc('/'))).toEqual({ kind: 'wait' });
    expect(decideAccess('guest', loading, loc('/login'))).toEqual({ kind: 'wait' });
    expect(decideAccess(undefined, { status: 'error', user: null }, loc('/'))).toEqual({
      kind: 'wait',
    });
  });

  it('protects routes by default and redirects anonymous users to the login page', () => {
    expect(decideAccess(undefined, anonymous, loc('/library'))).toEqual({
      kind: 'redirect',
      to: '/login?next=%2Flibrary',
    });
    expect(decideAccess('protected', member, loc('/library'))).toEqual({ kind: 'allow' });
  });

  it('sends signed-in users away from guest pages, to a safe ?next', () => {
    expect(decideAccess('guest', anonymous, loc('/login'))).toEqual({ kind: 'allow' });
    expect(decideAccess('guest', member, loc('/login', 'next=%2Fprofile'))).toEqual({
      kind: 'redirect',
      to: '/profile',
    });
    expect(decideAccess('guest', member, loc('/login', 'next=https://evil.test'))).toEqual({
      kind: 'redirect',
      to: '/',
    });
  });

  it('answers 403 to non-admins on admin routes', () => {
    expect(decideAccess('admin', anonymous, loc('/admin/users'))).toEqual({
      kind: 'redirect',
      to: '/login?next=%2Fadmin%2Fusers',
    });
    expect(decideAccess('admin', member, loc('/admin'))).toEqual({ kind: 'forbidden' });
    expect(decideAccess('admin', admin, loc('/admin'))).toEqual({ kind: 'allow' });
  });

  it('tells which routes need a login after a 401', () => {
    expect(requiresLogin(undefined)).toBe(true);
    expect(requiresLogin('admin')).toBe(true);
    expect(requiresLogin('guest')).toBe(false);
    expect(requiresLogin('public')).toBe(false);
  });
});

function fakeWindow(path: string): WindowLike {
  const location = { pathname: path, search: '', hash: '', origin: 'https://x.test' };
  const set = (url: string): void => {
    const u = new URL(url, 'https://x.test');
    location.pathname = u.pathname;
    location.search = u.search;
  };
  return {
    location,
    history: {
      pushState: (_d, _t, url) => set(String(url)),
      replaceState: (_d, _t, url) => set(String(url)),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

describe('RouteView with the guard', () => {
  const adminLoad = vi.fn(() => Promise.resolve({ default: 'Admin' }));
  const routes: RouteDefinition<string>[] = [
    { name: 'home', path: '/', component: 'Home' },
    { name: 'login', path: '/login', component: 'Login', access: 'guest' },
    { name: 'admin', path: '/admin/*', load: adminLoad, access: 'admin' },
  ];

  function setup(path: string, initial: AuthSnapshot) {
    let auth = initial;
    const router = new Router<string>({
      routes,
      mode: 'rewrite',
      basePath: '',
      window: fakeWindow(path),
    });
    const view = new RouteView<string>(
      router,
      () => undefined,
      (state) => decideAccess(state.match?.route.access, auth, state.location),
    );
    view.connect();
    router.start();
    return {
      router,
      view,
      setAuth(next: AuthSnapshot) {
        auth = next;
        view.refresh();
      },
    };
  }

  it('waits, then redirects to the login page and back after sign-in', async () => {
    const { router, view, setAuth } = setup('/', loading);
    expect(view.status).toBe('loading');
    setAuth(anonymous);
    await Promise.resolve();
    expect(router.state.location.path).toBe('/login');
    expect(view.component).toBe('Login');
    setAuth(member);
    await Promise.resolve();
    expect(router.state.location.path).toBe('/');
    expect(view.component).toBe('Home');
  });

  it('shows 403 to a member on /admin without loading the admin chunk', async () => {
    adminLoad.mockClear();
    const { view, setAuth } = setup('/admin/users', loading);
    setAuth(member);
    await Promise.resolve();
    expect(view.status).toBe('forbidden');
    expect(adminLoad).not.toHaveBeenCalled();
    setAuth(admin);
    await vi.waitFor(() => expect(view.component).toBe('Admin'));
    expect(view.params).toEqual({ rest: 'users' });
  });
});
