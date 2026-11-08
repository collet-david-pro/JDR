/** Sessions of the dashboard / player view still open (lobby, running, paused). */
import type { Game } from '../types';
import type { SessionsClient } from './sessions-client';
import type { Session } from './types';

export interface ActiveSession {
  readonly game: Pick<Game, 'id' | 'name'>;
  readonly session: Session;
}

/** The open sessions of all the games, in one request (an error leaves the dashboard usable). */
export async function activeSessions(
  client: Pick<SessionsClient, 'active'>,
): Promise<ActiveSession[]> {
  try {
    return (await client.active()).filter((a) => a.session.state !== 'ended');
  } catch {
    return [];
  }
}
