import type { ApiClient, QueryParams } from './api';

export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

export type PageFetcher<T> = (cursor: string | null) => Promise<Page<T>>;

/** Fetcher of a cursor-paginated endpoint (projet.md 9.1: ?cursor=&limit=, meta.next_cursor). */
export function cursorFetcher<T>(
  api: ApiClient,
  path: string,
  query: () => QueryParams = () => ({}),
): PageFetcher<T> {
  return async (cursor) => {
    const response = await api.get<T[]>(path, { query: { ...query(), cursor } });
    const next = response.meta['next_cursor'];
    return {
      items: Array.isArray(response.data) ? response.data : [],
      next: typeof next === 'string' && next !== '' ? next : null,
    };
  };
}

/** List loaded page by page ("load more"), ignoring stale responses after a reload. */
export class CursorList<T> {
  items = $state.raw<readonly T[]>([]);
  next = $state<string | null>(null);
  loading = $state(false);
  loaded = $state(false);
  error = $state.raw<unknown>(null);

  private token = 0;

  constructor(private readonly fetcher: PageFetcher<T>) {}

  get hasMore(): boolean {
    return this.next !== null;
  }

  /** Loads the first page again (new filters, after a change). */
  async reload(): Promise<void> {
    const token = ++this.token;
    this.loading = true;
    this.error = null;
    try {
      const page = await this.fetcher(null);
      if (token !== this.token) return;
      this.items = page.items;
      this.next = page.next;
      this.loaded = true;
    } catch (error) {
      if (token === this.token) this.error = error;
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  /** Appends the next page. */
  async more(): Promise<void> {
    if (this.next === null || this.loading) return;
    const token = this.token;
    this.loading = true;
    this.error = null;
    try {
      const page = await this.fetcher(this.next);
      if (token !== this.token) return;
      this.items = [...this.items, ...page.items];
      this.next = page.next;
    } catch (error) {
      if (token === this.token) this.error = error;
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  /** Replaces the items matching `predicate` (after an update). */
  replace(predicate: (item: T) => boolean, item: T): void {
    this.items = this.items.map((current) => (predicate(current) ? item : current));
  }

  remove(predicate: (item: T) => boolean): void {
    this.items = this.items.filter((item) => !predicate(item));
  }

  prepend(item: T): void {
    this.items = [item, ...this.items];
  }
}
