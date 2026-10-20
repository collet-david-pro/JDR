import type { PageComponent } from './page';
import type { ApiClient } from './api';
import type { BootConfig } from './boot';
import type { Router } from '../router';
import type { AuthStore } from '../stores/auth.svelte';

/** Application-wide singletons, created once by main.ts. */
export interface Services {
  readonly boot: BootConfig;
  readonly api: ApiClient;
  readonly router: Router<PageComponent>;
  readonly auth: AuthStore;
}

let current: Services | null = null;

export function setServices(services: Services): void {
  current = services;
}

export function services(): Services {
  if (current === null) throw new Error('Services are not initialised (main.ts)');
  return current;
}

/** href of an SPA path for the current routing mode (use in templates). */
export function href(path: string): string {
  return services().router.href(path);
}
