import { services } from '../services';
import { AssetsClient } from './assets-client';

let client: AssetsClient | null = null;

/** Shared assets client (limits cached once per page load). */
export function assetsClient(): AssetsClient {
  client ??= new AssetsClient(services().api);
  return client;
}
