import { services } from '../services';
import { MapsClient } from './maps-client';
import { TemplatesClient } from './templates';

let client: MapsClient | null = null;

/** Shared maps client. */
export function mapsClient(): MapsClient {
  client ??= new MapsClient(services().api);
  return client;
}

let templates: TemplatesClient | null = null;

/** Shared map templates client. */
export function templatesClient(): TemplatesClient {
  templates ??= new TemplatesClient(services().api);
  return templates;
}
