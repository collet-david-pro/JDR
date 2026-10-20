import type { Component } from 'svelte';
import type { RouteParams } from '../router';

/** Props received by every page component. */
export interface PageProps {
  readonly params: RouteParams;
  readonly query: URLSearchParams;
}

export type PageComponent = Component<PageProps>;
