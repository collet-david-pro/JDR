import { describe, expect, it, vi } from 'vitest';
import type { RoutingMode } from '../src/lib/boot';
import {
  Router,
  buildHref,
  compileRoute,
  internalPathFromUrl,
  normalizePath,
  readLocation,
  type ClickLike,
  type RouteDefinition,
  type RouterState,
  type WindowLike,
} from '../src/router';

type Page = string;

const routes: RouteDefinition<Page>[] = [
  { name: 'home', path: '/', component: 'Home' },
  { name: 'login', path: '/login', component: 'Login' },
  { name: 'game', path: '/games/:id', component: 'Game' },
  { name: 'editor', path: '/games/:id/maps/:mapId/edit', component: 'Editor' },
  { name: 'join', path: '/join/:code?', component: 'Join' },
  { name: 'admin', path: '/admin/*', load: () => Promise.resolve({ default: 'Admin' }) },
];

/** Minimal browser double: pushState/replaceState update the location like a browser. */
function fakeWindow(initial: string, origin = 'https://example.test') {
  const listeners = new Map<string, Set<() => void>>();
  const location = { pathname: '/', search: '', hash: '', origin };
  const setUrl = (url: string): void => {
    const parsed = new URL(url, `${origin}${location.pathname}${location.search}`);
    location.pathname = parsed.pathname;
    location.search = parsed.search;
    location.hash = parsed.hash;
  };
  setUrl(initial);
  const win: WindowLike & { fire(type: string): void; setUrl(url: string): void } = {
    location,
    history: {
      pushState: vi.fn((_data: unknown, _unused: string, url?: string | URL | null) => {
        if (url !== undefined && url !== null) setUrl(String(url));
      }),
      replaceState: vi.fn((_data: unknown, _unused: string, url?: string | URL | null) => {
        if (url !== undefined && url !== null) setUrl(String(url));
      }),
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    fire: (type) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    setUrl,
  };
  return win;
}

function makeRouter(url: string, mode: RoutingMode, basePath = '') {
  const win = fakeWindow(url);
  const router = new Router<Page>({ routes, mode, basePath, window: win });
  const states: RouterState<Page>[] = [];
  router.subscribe((s) => states.push(s));
  router.start();
  return { win, router, states };
}

function click(
  href: string,
  overrides: Partial<ClickLike> = {},
  anchorAttrs: Record<string, string> = {},
) {
  const anchor = {
    href,
    target: anchorAttrs['target'] ?? '',
    getAttribute: (name: string) => anchorAttrs[name] ?? null,
    hasAttribute: (name: string) => name in anchorAttrs,
  };
  const target = { closest: (selector: string) => (selector.startsWith('a') ? anchor : null) };
  const event = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target,
    preventDefault: vi.fn(),
    ...overrides,
  };
  return event;
}

describe('compileRoute / matching', () => {
  it('matches literal routes and the root', () => {
    const { router } = makeRouter('/', 'rewrite');
    expect(router.resolve('/')?.route.name).toBe('home');
    expect(router.resolve('/login')?.route.name).toBe('login');
    expect(router.resolve('/login/')?.route.name).toBe('login');
  });

  it('extracts and decodes parameters', () => {
    const { router } = makeRouter('/', 'rewrite');
    expect(router.resolve('/games/12')).toEqual({ route: routes[2], params: { id: '12' } });
    const editor = router.resolve('/games/12/maps/7/edit');
    expect(editor?.route.name).toBe('editor');
    expect(editor?.params).toEqual({ id: '12', mapId: '7' });
    expect(router.resolve('/games/caf%C3%A9')?.params).toEqual({ id: 'café' });
  });

  it('supports an optional last parameter', () => {
    const { router } = makeRouter('/', 'rewrite');
    expect(router.resolve('/join')?.params).toEqual({});
    expect(router.resolve('/join/ABCD-1234')?.params).toEqual({ code: 'ABCD-1234' });
    expect(router.resolve('/join/a/b')).toBeNull();
  });

  it('supports a final wildcard', () => {
    const { router } = makeRouter('/', 'rewrite');
    expect(router.resolve('/admin')?.params).toEqual({ rest: '' });
    expect(router.resolve('/admin/users/3')?.params).toEqual({ rest: 'users/3' });
  });

  it('returns null (404) for unknown paths and malformed encodings', () => {
    const { router } = makeRouter('/', 'rewrite');
    expect(router.resolve('/nope')).toBeNull();
    expect(router.resolve('/games')).toBeNull();
    expect(router.resolve('/games/%E0%A4%A')).toBeNull();
  });

  it('rejects invalid patterns', () => {
    expect(() => compileRoute('/a/:id?/b')).toThrow();
    expect(() => compileRoute('/a/*/b')).toThrow();
    expect(() => compileRoute('/a/:bad-name')).toThrow();
  });

  it('escapes literal segments', () => {
    const { regex } = compileRoute('/file.json');
    expect(regex.test('/file.json')).toBe(true);
    expect(regex.test('/fileXjson')).toBe(false);
  });

  it('normalises paths', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('//games//12/')).toBe('/games/12');
  });
});

describe('history mode (rewrite)', () => {
  it('reads the location relative to base_path', () => {
    const loc = { pathname: '/base/games/12', search: '?tab=maps', hash: '', origin: 'x' };
    const read = readLocation(loc, 'rewrite', '/base');
    expect(read.path).toBe('/games/12');
    expect(read.query.get('tab')).toBe('maps');
    expect(readLocation({ ...loc, pathname: '/base' }, 'rewrite', '/base').path).toBe('/');
    expect(readLocation({ ...loc, pathname: '/base/' }, 'rewrite', '/base').path).toBe('/');
    // A sibling folder is not the base path.
    expect(readLocation({ ...loc, pathname: '/basement' }, 'rewrite', '/base').path).toBe(
      '/basement',
    );
  });

  it('builds hrefs with base_path', () => {
    expect(buildHref('/games/12', 'rewrite', '/base')).toBe('/base/games/12');
    expect(buildHref('/', 'rewrite', '')).toBe('/');
  });

  it('resolves the initial route and navigates with pushState', () => {
    const { win, router, states } = makeRouter('/base/games/12', 'rewrite', '/base');
    expect(router.state.match?.params).toEqual({ id: '12' });
    router.navigate('/login?next=%2Fgames%2F12');
    expect(win.history.pushState).toHaveBeenCalledWith(null, '', '/base/login?next=%2Fgames%2F12');
    const last = states.at(-1);
    expect(last?.match?.route.name).toBe('login');
    expect(last?.location.query.get('next')).toBe('/games/12');
  });

  it('uses replaceState on replace navigations', () => {
    const { win, router } = makeRouter('/base/', 'rewrite', '/base');
    router.navigate('/login', { replace: true });
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/base/login');
    expect(win.history.pushState).not.toHaveBeenCalled();
  });

  it('follows popstate (back/forward)', () => {
    const { win, router } = makeRouter('/base/login', 'rewrite', '/base');
    win.setUrl('/base/games/5');
    win.fire('popstate');
    expect(router.state.match?.params).toEqual({ id: '5' });
  });

  it('publishes a null match for unknown routes (404)', () => {
    const { router } = makeRouter('/base/does/not/exist', 'rewrite', '/base');
    expect(router.state.match).toBeNull();
    expect(router.state.location.path).toBe('/does/not/exist');
  });

  it('stops notifying after unsubscribe', () => {
    const { router } = makeRouter('/', 'rewrite');
    const listener = vi.fn();
    const unsubscribe = router.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    router.navigate('/login');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('hash mode (query)', () => {
  it('reads the route from the hash', () => {
    const loc = {
      pathname: '/base/index.php',
      search: '',
      hash: '#/games/12?tab=maps',
      origin: 'x',
    };
    const read = readLocation(loc, 'query', '/base');
    expect(read.path).toBe('/games/12');
    expect(read.query.get('tab')).toBe('maps');
    expect(readLocation({ ...loc, hash: '' }, 'query', '/base').path).toBe('/');
    expect(readLocation({ ...loc, hash: '#/' }, 'query', '/base').path).toBe('/');
  });

  it('builds hash hrefs', () => {
    expect(buildHref('/games/12', 'query', '/base')).toBe('#/games/12');
  });

  it('navigates by changing the hash only', () => {
    const { win, router } = makeRouter('/base/#/login', 'query', '/base');
    expect(router.state.match?.route.name).toBe('login');
    router.navigate('/games/3');
    expect(win.history.pushState).toHaveBeenCalledWith(null, '', '#/games/3');
    expect(win.location.pathname).toBe('/base/');
    expect(router.state.match?.params).toEqual({ id: '3' });
  });

  it('follows hashchange and ignores plain in-page anchors', () => {
    const { win, router } = makeRouter('/base/#/login', 'query', '/base');
    win.setUrl('#/join/ABCD-EFGH');
    win.fire('hashchange');
    expect(router.state.match?.params).toEqual({ code: 'ABCD-EFGH' });
    win.setUrl('#main');
    win.fire('hashchange');
    expect(router.state.match?.route.name).toBe('join');
  });
});

describe('link interception', () => {
  const current = { pathname: '/base/', search: '', hash: '', origin: 'https://example.test' };

  it('accepts internal links and rejects server paths (rewrite)', () => {
    const internal = (href: string) => internalPathFromUrl(href, current, 'rewrite', '/base');
    expect(internal('https://example.test/base/games/1?x=1')).toBe('/games/1?x=1');
    expect(internal('/base/login')).toBe('/login');
    expect(internal('https://other.test/base/login')).toBeNull();
    expect(internal('/elsewhere/login')).toBeNull();
    expect(internal('/base/api/v1/health')).toBeNull();
    expect(internal('/base/assets/main-abc.js')).toBeNull();
    expect(internal('/base/install.php')).toBeNull();
    expect(internal('/base/index.php?r=/api/v1/health')).toBeNull();
    expect(internal('/base/sw.js')).toBeNull();
    expect(internal('/base/#section')).toBeNull();
  });

  it('accepts only hash routes of the current document (query)', () => {
    const loc = { ...current, pathname: '/base/index.php' };
    const internal = (href: string) => internalPathFromUrl(href, loc, 'query', '/base');
    expect(internal('#/games/2')).toBe('/games/2');
    expect(internal('https://example.test/base/index.php#/login')).toBe('/login');
    expect(internal('#section')).toBeNull();
    expect(internal('/base/install.php')).toBeNull();
  });

  it('intercepts plain left clicks on internal links', () => {
    const { router } = makeRouter('/base/', 'rewrite', '/base');
    const event = click('https://example.test/base/games/9');
    router.handleClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(router.state.match?.params).toEqual({ id: '9' });
  });

  it('lets the browser handle modified clicks, targets, downloads and external links', () => {
    const { router } = makeRouter('/base/', 'rewrite', '/base');
    const cases = [
      click('https://example.test/base/games/9', { metaKey: true }),
      click('https://example.test/base/games/9', { ctrlKey: true }),
      click('https://example.test/base/games/9', { button: 1 }),
      click('https://example.test/base/games/9', { defaultPrevented: true }),
      click('https://example.test/base/games/9', {}, { target: '_blank' }),
      click('https://example.test/base/games/9', {}, { download: '' }),
      click('https://example.test/base/games/9', {}, { rel: 'noopener external' }),
      click('https://other.test/base/games/9'),
    ];
    for (const event of cases) {
      router.handleClick(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(router.state.match?.route.name).toBe('home');
  });

  it('ignores clicks outside links', () => {
    const { router } = makeRouter('/', 'rewrite');
    const event = click('/login', { target: { closest: () => null } });
    router.handleClick(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
