/**
 * Base texture pack (D3/D4): GET /procgen/pack, cached in memory for the page session.
 * The server answers {version, assets: {key: {asset_id, url (signed), name}}}; deleted assets
 * are absent (apply.ts / bind.ts then fall back to another key of the same family).
 * Signed URLs expire: call `clearPackCache()` to force a new request (e.g. after a long idle).
 */
import type { ApiClient } from '../api';
import type { PackAsset } from '../../procgen/bind';
import type { PackKey } from '../../procgen/types';

export interface Pack {
  version: number | string;
  assets: Record<PackKey, PackAsset>;
}

interface PackWire {
  version: number | string;
  assets: Record<string, { asset_id: string; url: string | null; name: string }> | null;
}

let cached: { api: ApiClient; promise: Promise<Pack> } | null = null;

/** Forgets the cached pack (next `loadPack` calls the API again). */
export function clearPackCache(): void {
  cached = null;
}

/** Loads the pack once per page session (concurrent calls share one request; failures are not cached). */
export function loadPack(api: Pick<ApiClient, 'get'>): Promise<Pack> {
  if (cached !== null && cached.api === (api as ApiClient)) return cached.promise;
  const promise = (async (): Promise<Pack> => {
    const { data } = await api.get<PackWire>('/procgen/pack');
    const assets: Record<PackKey, PackAsset> = {};
    for (const [key, a] of Object.entries(data.assets ?? {})) {
      assets[key] = { asset_id: String(a.asset_id), url: a.url ?? null, name: a.name };
    }
    return { version: data.version, assets };
  })();
  const entry = { api: api as ApiClient, promise };
  cached = entry;
  promise.catch(() => {
    if (cached === entry) cached = null;
  });
  return promise;
}
