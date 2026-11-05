/**
 * Links to the help. The section anchor is the one of the catalog (`mj-creer-une-map`).
 * Inside the application the link is `/aide?s=<anchor>`: it works in both routing modes
 * (in `query` mode the URL fragment already holds the route). A direct visit of
 * `/aide#<anchor>` works too in `rewrite` mode.
 */
export const HELP_PATH = '/aide';

/** SPA path of a section (for `href()`). */
export function helpPath(anchor?: string): string {
  return anchor === undefined || anchor === ''
    ? HELP_PATH
    : `${HELP_PATH}?s=${encodeURIComponent(anchor)}`;
}

/** Anchor requested by a location: `?s=`, else a plain fragment (rewrite mode). */
export function requestedAnchor(query: URLSearchParams, hash: string): string | null {
  const fromQuery = query.get('s');
  if (fromQuery !== null && /^[a-z0-9-]+$/.test(fromQuery)) return fromQuery;
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^[a-z0-9-]+$/.test(fragment) ? fragment : null;
}
