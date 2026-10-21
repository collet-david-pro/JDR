import { services } from '../services';
import { GamesClient } from './games-client';

let client: GamesClient | null = null;

/** Shared games client. */
export function gamesClient(): GamesClient {
  client ??= new GamesClient(services().api);
  return client;
}
