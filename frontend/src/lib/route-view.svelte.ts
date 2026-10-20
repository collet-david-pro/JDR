import type { RouteParams, Router, RouterState } from '../router';

export type RouteViewStatus = 'loading' | 'ready' | 'not_found' | 'error';

/**
 * Turns router states into the page to display, loading lazy pages and ignoring stale
 * results when the user navigates again before a chunk has arrived.
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

  constructor(
    private readonly router: Router<C>,
    private readonly onTitle: (titleKey: string | null) => void,
  ) {}

  /** Subscribes to the router; returns the unsubscribe function. */
  connect(): () => void {
    return this.router.subscribe((state) => {
      void this.show(state);
    });
  }

  async show(state: RouterState<C>): Promise<void> {
    const key = `${state.location.path}?${state.location.query.toString()}`;
    if (key === this.key) return;
    this.key = key;
    const token = ++this.token;

    if (state.match === null) {
      this.display(null, {}, state.location.query, 'not_found', null);
      return;
    }
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
