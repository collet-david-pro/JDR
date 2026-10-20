/**
 * Minimal SPA router (projet.md sections 6.1 and 13.1).
 *
 * - `rewrite` routing mode: History API, clean URLs under base_path ("/base/games/12").
 * - `query` routing mode (no mod_rewrite): hash routing ("/base/#/games/12").
 * - Patterns: literal segments, `:param`, optional trailing `:param?`, and a final `*`
 *   (rest of the path, exposed as params.rest, possibly empty).
 * - Internal <a href> clicks are intercepted; unknown paths produce a `null` match (404).
 *
 * The router does not know Svelte: the component type is a generic parameter and changes
 * are published to subscribers (see App.svelte).
 */

import type { RoutingMode } from './lib/boot';

export type RouteParams = Readonly<Record<string, string>>;

export interface RouteDefinition<C> {
  readonly name: string;
  readonly path: string;
  /** Core pages: bundled in the initial chunk. */
  readonly component?: C;
  /** Pages of later phases: loaded on demand with a dynamic import(). */
  readonly load?: () => Promise<{ default: C }>;
  /** i18n key of the document title. */
  readonly titleKey?: string;
}

export interface AppLocation {
  /** Normalised path relative to base_path, always starting with "/". */
  readonly path: string;
  readonly query: URLSearchParams;
}

export interface RouteMatch<C> {
  readonly route: RouteDefinition<C>;
  readonly params: RouteParams;
}

export interface RouterState<C> {
  readonly location: AppLocation;
  /** null when no route matches (404). */
  readonly match: RouteMatch<C> | null;
}

interface CompiledRoute<C> {
  readonly def: RouteDefinition<C>;
  readonly regex: RegExp;
  readonly keys: readonly string[];
}

/** Paths under base_path that belong to the server, never to the SPA. */
const SERVER_PATH_PREFIXES = ['/api/', '/assets/'];
const SERVER_FILES = new Set(['/index.php', '/install.php', '/update.php', '/cron.php', '/sw.js']);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileRoute(path: string): { regex: RegExp; keys: string[] } {
  const segments = path.split('/').filter((s) => s !== '');
  const keys: string[] = [];
  let body = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '*') {
      if (!last) throw new Error(`Route "${path}": "*" must be the last segment`);
      keys.push('rest');
      body += '(?:/(.*))?';
    } else if (segment.startsWith(':')) {
      const optional = segment.endsWith('?');
      const name = segment.slice(1, optional ? -1 : undefined);
      if (!/^\w+$/.test(name)) throw new Error(`Route "${path}": invalid parameter "${segment}"`);
      if (optional && !last)
        throw new Error(`Route "${path}": only the last parameter may be optional`);
      keys.push(name);
      body += optional ? '(?:/([^/]+))?' : '/([^/]+)';
    } else {
      body += `/${escapeRegex(segment)}`;
    }
  });
  return { regex: new RegExp(`^${body === '' ? '/' : body}$`), keys };
}

/** Removes duplicate and trailing slashes; always returns a path starting with "/". */
export function normalizePath(path: string): string {
  const cleaned = `/${path}`.replace(/\/{2,}/g, '/');
  return cleaned.length > 1 ? cleaned.replace(/\/+$/, '') : cleaned;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function matchRoutes<C>(
  routes: readonly CompiledRoute<C>[],
  path: string,
): RouteMatch<C> | null {
  const normalized = normalizePath(path);
  for (const route of routes) {
    const result = route.regex.exec(normalized);
    if (result === null) continue;
    const params: Record<string, string> = {};
    let valid = true;
    route.keys.forEach((key, i) => {
      const raw = result[i + 1];
      if (raw === undefined) {
        if (key === 'rest') params[key] = '';
        return;
      }
      const decoded = safeDecode(raw);
      if (decoded === null) valid = false;
      else params[key] = decoded;
    });
    if (valid) return { route: route.def, params };
  }
  return null;
}

/** Splits "/path?query" into an AppLocation. */
function splitPathAndQuery(value: string): AppLocation {
  const index = value.indexOf('?');
  const path = index === -1 ? value : value.slice(0, index);
  const query = index === -1 ? '' : value.slice(index + 1);
  return { path: normalizePath(path), query: new URLSearchParams(query) };
}

export interface LocationLike {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly origin: string;
}

/** Reads the SPA location from the browser location, according to the routing mode. */
export function readLocation(loc: LocationLike, mode: RoutingMode, basePath: string): AppLocation {
  if (mode === 'query') {
    const hash = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash;
    return splitPathAndQuery(hash === '' ? '/' : hash);
  }
  let path = loc.pathname;
  if (basePath !== '' && (path === basePath || path.startsWith(`${basePath}/`))) {
    path = path.slice(basePath.length);
  }
  return { path: normalizePath(path), query: new URLSearchParams(loc.search) };
}

/** Builds the href of an SPA path ("/games/12?tab=maps") for the routing mode. */
export function buildHref(path: string, mode: RoutingMode, basePath: string): string {
  const target = path.startsWith('/') ? path : `/${path}`;
  return mode === 'query' ? `#${target}` : `${basePath}${target}`;
}

/**
 * Returns the SPA path ("/games/12?x=1") targeted by an absolute URL, or null when the URL
 * leaves the SPA (other origin, outside base_path, API, build files, PHP entry points...).
 */
export function internalPathFromUrl(
  href: string,
  current: LocationLike,
  mode: RoutingMode,
  basePath: string,
): string | null {
  let url: URL;
  try {
    url = new URL(href, `${current.origin}${current.pathname}`);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;

  if (mode === 'query') {
    if (url.pathname !== current.pathname || url.search !== current.search) return null;
    if (!url.hash.startsWith('#/')) return null;
    return url.hash.slice(1);
  }

  const { pathname } = url;
  if (basePath !== '' && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  const relative = normalizePath(pathname.slice(basePath.length));
  if (SERVER_FILES.has(relative)) return null;
  if (SERVER_PATH_PREFIXES.some((prefix) => `${relative}/`.startsWith(prefix))) return null;
  if (url.hash !== '' && url.pathname === current.pathname && url.search === current.search) {
    return null; // in-page anchor
  }
  return relative + url.search;
}

export interface ClickLike {
  readonly defaultPrevented: boolean;
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly target: unknown;
  preventDefault(): void;
}

interface AnchorLike {
  readonly href: string;
  readonly target: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

function findAnchor(target: unknown): AnchorLike | null {
  if (typeof target !== 'object' || target === null) return null;
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== 'function') return null;
  const anchor: unknown = closest.call(target, 'a[href]');
  if (typeof anchor !== 'object' || anchor === null) return null;
  const candidate = anchor as Partial<AnchorLike>;
  // SVG <a> elements expose href as an SVGAnimatedString: let the browser handle them.
  if (typeof candidate.href !== 'string' || typeof candidate.hasAttribute !== 'function')
    return null;
  return anchor as AnchorLike;
}

export interface WindowLike {
  readonly location: LocationLike;
  readonly history: Pick<History, 'pushState' | 'replaceState'>;
  addEventListener(type: 'popstate' | 'hashchange', listener: () => void): void;
  removeEventListener(type: 'popstate' | 'hashchange', listener: () => void): void;
  scrollTo?(x: number, y: number): void;
}

export interface DocumentLike {
  addEventListener(type: 'click', listener: (event: ClickLike) => void): void;
  removeEventListener(type: 'click', listener: (event: ClickLike) => void): void;
}

export interface RouterOptions<C> {
  readonly routes: readonly RouteDefinition<C>[];
  readonly mode: RoutingMode;
  readonly basePath: string;
  readonly window: WindowLike;
  readonly document?: DocumentLike;
}

export interface NavigateOptions {
  readonly replace?: boolean;
}

export type RouterListener<C> = (state: RouterState<C>) => void;

export class Router<C> {
  readonly mode: RoutingMode;
  readonly basePath: string;
  private readonly compiled: CompiledRoute<C>[];
  private readonly win: WindowLike;
  private readonly doc: DocumentLike | undefined;
  private readonly listeners = new Set<RouterListener<C>>();
  private currentState: RouterState<C>;
  private started = false;

  constructor(options: RouterOptions<C>) {
    this.mode = options.mode;
    this.basePath = options.basePath;
    this.win = options.window;
    this.doc = options.document;
    this.compiled = options.routes.map((def) => ({ def, ...compileRoute(def.path) }));
    this.currentState = this.computeState();
  }

  get state(): RouterState<C> {
    return this.currentState;
  }

  /** Resolves a path without navigating. */
  resolve(path: string): RouteMatch<C> | null {
    return matchRoutes(this.compiled, splitPathAndQuery(path).path);
  }

  href(path: string): string {
    return buildHref(path, this.mode, this.basePath);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.win.addEventListener('popstate', this.onLocationChange);
    if (this.mode === 'query') this.win.addEventListener('hashchange', this.onLocationChange);
    this.doc?.addEventListener('click', this.handleClick);
    this.update();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.win.removeEventListener('popstate', this.onLocationChange);
    this.win.removeEventListener('hashchange', this.onLocationChange);
    this.doc?.removeEventListener('click', this.handleClick);
  }

  subscribe(listener: RouterListener<C>): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  navigate(path: string, options: NavigateOptions = {}): void {
    const url = this.href(path);
    if (options.replace === true) this.win.history.replaceState(null, '', url);
    else this.win.history.pushState(null, '', url);
    this.update();
    this.win.scrollTo?.(0, 0);
  }

  /** Document click handler: turns internal link clicks into SPA navigations. */
  readonly handleClick = (event: ClickLike): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = findAnchor(event.target);
    if (anchor === null) return;
    if (anchor.target !== '' && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    const rel = anchor.getAttribute('rel') ?? '';
    if (rel.split(/\s+/).includes('external')) return;
    const path = internalPathFromUrl(anchor.href, this.win.location, this.mode, this.basePath);
    if (path === null) return;
    event.preventDefault();
    this.navigate(path);
  };

  private readonly onLocationChange = (): void => {
    // Query mode: a plain in-page anchor ("#section") is not an SPA route; keep the page.
    const hash = this.win.location.hash;
    if (this.mode === 'query' && hash !== '' && hash !== '#' && !hash.startsWith('#/')) return;
    this.update();
  };

  private computeState(): RouterState<C> {
    const location = readLocation(this.win.location, this.mode, this.basePath);
    return { location, match: matchRoutes(this.compiled, location.path) };
  }

  private update(): void {
    this.currentState = this.computeState();
    for (const listener of this.listeners) listener(this.currentState);
  }
}
