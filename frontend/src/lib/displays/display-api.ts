/**
 * API of a projection screen: its own ApiClient (every request carries `as=display`; a 401 means
 * the screen is no longer paired, never a redirection to the login page) and the clients built
 * on it. The SyncClient is separate from the user's one: its own Web Locks lock and
 * BroadcastChannel (`jdr-sync-display`) and its own `serverKey`, so that a GM testing the screen
 * in his browser does not share his GM stream with the screen tab.
 */
import { ApiClient, type ApiClientOptions } from '../api';
import { MapsClient } from '../maps/maps-client';
import { createSyncClient, type SyncClient, type SyncClientOptions } from '../realtime';
import { SessionsClient } from '../sessions/sessions-client';
import type { MeResponse } from '../types';
import { DeviceClient } from './device-client';

export const DISPLAY_SYNC_NAME = 'jdr-sync-display';

export interface DisplayApiOptions {
  /** `boot.apiBase`. */
  readonly baseUrl: string;
  /** Anonymous CSRF token of the boot configuration. */
  readonly csrfToken: string | null;
  /** The screen is unknown or revoked (401 on any request). */
  readonly onUnpaired: () => void;
  /** Injectable for tests. */
  readonly fetch?: typeof fetch;
  readonly api?: Partial<ApiClientOptions>;
  readonly sync?: Partial<SyncClientOptions>;
}

export interface DisplayApi {
  readonly api: ApiClient;
  readonly device: DeviceClient;
  readonly sessions: SessionsClient;
  readonly maps: MapsClient;
  readonly sync: SyncClient;
}

export function createDisplayApi(o: DisplayApiOptions): DisplayApi {
  // `api` is read by refreshCsrf only when a request is made, long after the construction.
  const api: ApiClient = new ApiClient({
    baseUrl: o.baseUrl,
    csrfToken: o.csrfToken,
    defaultQuery: { as: 'display' },
    onUnauthorized: () => o.onUnpaired(),
    // The anonymous CSRF token is renewed by GET /auth/me, like the application does.
    refreshCsrf: async () => {
      const { data } = await api.get<MeResponse>('/auth/me', { notifyUnauthorized: false });
      api.setCsrfToken(data.csrf);
    },
    ...(o.fetch === undefined ? {} : { fetch: o.fetch }),
    ...o.api,
  });
  const sync = createSyncClient({
    url: (path, query) => api.url(path, query),
    serverKey: `${o.baseUrl}#display`,
    name: DISPLAY_SYNC_NAME,
    ...(o.fetch === undefined ? {} : { fetch: o.fetch }),
    ...o.sync,
  });
  return {
    api,
    device: new DeviceClient(api),
    sessions: new SessionsClient(api),
    maps: new MapsClient(api),
    sync,
  };
}
