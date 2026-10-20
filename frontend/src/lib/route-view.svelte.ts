import type { RouteParams, Router, RouterState } from '../router';
import type { GuardDecision } from './guard';

export type RouteViewStatus = 'loading' | 'ready' | 'not_found' | 'error' | 'forbidden';

/** Decides whether the matched route of a state may be shown (see lib/guard.ts). */
export type RouteGuard<C> = (state: RouterState<C>) => GuardDecision;

/**
 * Turns router states into the page to display, applying the route guard before loading
 * lazy pages (an admin chunk is never fetched for a non-admin) and ignoring stale results
 * when the user navigates again before a chunk has arrived.
 */
export class RouteView<C> {
  component = $state.raw<C | null>(null);
  params = $state.raw<RouteParams>({});
  query = $state.raw<URLSearchParams>(new URLSearchParams());
  status = $state<RouteViewStatus>('loading');
  /** Incremented after each displayed navigation (focus management). */
  navigations = $state(0);

  private token = 0;
  private key: string | null = null;
  private pending = false;

  constructor(
    private readonly router: Router<C>,
    private readonly onTitle: (titleKey: string | null) => void,
    private readonly guard: RouteGuard<C> = () => ({ kind: 'allow' }),
  ) {}

  /** Subscribes to the router; returns the unsubscribe function. */
  connect(): () => void {
    return this.router.subscribe((state) => {
      void this.show(state);
    });
  }

  /** Re-evaluates the guard for the current location (call it when the session changes). */
  refresh(): void {
    void this.show(this.router.state, true);
  }

  async show(state: RouterState<C>, force = false): Promise<void> {
    const key = `${state.location.path}?${state.location.query.toString()}`;
    if (key === this.key && !force) return;

    if (state.match === null) {
      this.key = key;
      ++this.token;
      this.display(null, {}, state.location.query, 'not_found', null);
      return;
    }

    const decision = this.guard(state);
    if (decision.kind === 'wait') {
      this.key = key;
      this.pending = true;
      ++this.token;
      this.status = 'loading';
      return;
    }
    if (decision.kind === 'redirect') {
      this.key = null;
      ++this.token;
      // Outside the router notification loop.
      queueMicrotask(() => this.router.navigate(decision.to, { replace: true }));
      return;
    }
    if (decision.kind === 'forbidden') {
      this.key = key;
      ++this.token;
      this.display(null, {}, state.location.query, 'forbidden', 'pages.forbidden.title');
      return;
    }

    // Already displayed (forced refresh with an unchanged outcome): keep the page as is.
    if (key === this.key && !this.pending && this.status === 'ready') return;
    this.key = key;
    this.pending = false;
    const token = ++this.token;

    const { route, params } = state.match;
    if (route.component !== undefined) {
      this.display(route.component, params, state.location.query, 'ready', route.titleKey ?? null);
      return;
    }
    if (route.load === undefined) {
      this.display(null, {}, state.location.query, 'not_found', null);
      return;
    }
    this.status = 'loading';
    try {
      const module = await route.load();
      if (token !== this.token) return;
      this.display(module.default, params, state.location.query, 'ready', route.titleKey ?? null);
    } catch (error) {
      if (token !== this.token) return;
      console.error('[router] page load failed', error);
      this.key = null; // allow retrying the same URL
      this.display(null, {}, state.location.query, 'error', null);
    }
  }

  private display(
    component: C | null,
    params: RouteParams,
    query: URLSearchParams,
    status: RouteViewStatus,
    titleKey: string | null,
  ): void {
    this.component = component;
    this.params = params;
    this.query = query;
    this.status = status;
    this.navigations++;
    this.onTitle(status === 'not_found' ? 'pages.not_found.title' : titleKey);
  }
}
