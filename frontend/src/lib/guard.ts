/**
 * Route guard (pure logic, used by RouteView): decides whether a route can be shown for
 * the current authentication state.
 */

import type { AppLocation, RouteAccess } from '../router';

export type AuthStatus = 'loading' | 'ready' | 'error';

export interface AuthSnapshot {
  readonly status: AuthStatus;
  readonly user: { readonly role: string } | null;
}

export type GuardDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'redirect'; readonly to: string }
  | { readonly kind: 'forbidden' };

const ALLOW: GuardDecision = { kind: 'allow' };
const WAIT: GuardDecision = { kind: 'wait' };
const FORBIDDEN: GuardDecision = { kind: 'forbidden' };

const GUEST_PATHS = ['/login', '/register', '/invite'];

/**
 * Sanitises a `next` parameter: only same-application paths are accepted (no scheme, no
 * protocol-relative "//host", no backslash tricks, no guest pages); otherwise "/".
 */
export function safeNext(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '/';
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) return '/';
  const path = value.split(/[?#]/, 1)[0] ?? '/';
  if (GUEST_PATHS.some((guest) => path === guest || path.startsWith(`${guest}/`))) return '/';
  return value;
}

/** Path + query of a location ("/games/1?tab=maps"). */
export function locationToPath(location: AppLocation): string {
  const query = location.query.toString();
  return query === '' ? location.path : `${location.path}?${query}`;
}

/** Login URL that brings the user back to `location` afterwards. */
export function loginPath(location: AppLocation): string {
  const next = locationToPath(location);
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}

export function decideAccess(
  access: RouteAccess | undefined,
  auth: AuthSnapshot,
  location: AppLocation,
): GuardDecision {
  const rule = access ?? 'protected';
  if (rule === 'public') return ALLOW;
  if (auth.status !== 'ready') return WAIT;
  const user = auth.user;
  switch (rule) {
    case 'guest':
      return user === null ? ALLOW : { kind: 'redirect', to: safeNext(location.query.get('next')) };
    case 'protected':
      return user === null ? { kind: 'redirect', to: loginPath(location) } : ALLOW;
    case 'admin':
      if (user === null) return { kind: 'redirect', to: loginPath(location) };
      return user.role === 'admin' ? ALLOW : FORBIDDEN;
  }
}

/** Whether a 401 on this route must send the user to the login page. */
export function requiresLogin(access: RouteAccess | undefined): boolean {
  const rule = access ?? 'protected';
  return rule === 'protected' || rule === 'admin';
}
