import { services } from '../services';
import { MapsClient } from './maps-client';

let client: MapsClient | null = null;

/** Shared maps client. */
export function mapsClient(): MapsClient {
  client ??= new MapsClient(services().api);
  return client;
}
