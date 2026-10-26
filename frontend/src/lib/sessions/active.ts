/** Sessions of the dashboard / player view still open (lobby, running, paused). */
import type { Game } from '../types';
import type { SessionsClient } from './sessions-client';
import type { Session } from './types';

export interface ActiveSession {
  readonly game: Pick<Game, 'id' | 'name'>;
  readonly session: Session;
}

/** Most games listed at once (one request each). */
export const MAX_GAMES_LISTED = 12;

/**
 * The open session of each game (errors of one game are ignored: the dashboard stays usable).
 */
export async function activeSessions(
  client: Pick<SessionsClient, 'list'>,
  games: readonly Pick<Game, 'id' | 'name'>[],
): Promise<ActiveSession[]> {
  const unique = [...new Map(games.map((g) => [g.id, g])).values()].slice(0, MAX_GAMES_LISTED);
  const found = await Promise.all(
    unique.map(async (game): Promise<ActiveSession[]> => {
      try {
        const page = await client.list(game.id, { limit: 5 });
        return page.items.filter((s) => s.state !== 'ended').map((session) => ({ game, session }));
      } catch {
        return [];
      }
    }),
  );
  return found.flat();
}
