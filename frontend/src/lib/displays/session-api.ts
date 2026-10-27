/**
 * What SessionSync needs from the API, for a projection screen: the snapshot is read as is
 * (`as=display`), the session header comes from `GET /display/me` (the screen cannot read
 * `/sessions/{id}`), the presence is held by the stream and no action is ever sent.
 */
import { ApiError } from '../api';
import type { SessionApi } from '../sessions/session-sync';
import type { SessionsClient } from '../sessions/sessions-client';
import type { Session } from '../sessions/types';
import type { DeviceClient } from './device-client';
import type { DisplayMe } from './types';

/** The session header as a `Session` (what a screen knows of it: no code, no players). */
export function meToSession(me: DisplayMe): Session {
  const s = me.session;
  return {
    id: s.id,
    game_id: s.game_id,
    name: s.name,
    state: s.state,
    current_map_id: s.current_map_id,
    current_floor_id: s.current_floor_id,
    camera: s.camera,
    pause_screen: s.pause_screen,
    created_at: '',
    started_at: null,
    ended_at: null,
    players: [],
    assignments: [],
    settings: {
      fog_strict: true,
      players_blocked_by_walls: true,
      players_can_move_own_tokens: false,
      players_see_other_pcs: true,
    },
    role: 'display',
    last_event_id: me.last_event_id,
  };
}

export function displaySessionApi(
  sessions: Pick<SessionsClient, 'snapshot'>,
  device: Pick<DeviceClient, 'me'>,
): SessionApi {
  return {
    snapshot: (id, signal) => sessions.snapshot(id, signal),
    get: async (id, signal) => {
      const me = await device.me(signal);
      if (me.session.id !== id) {
        // The screen was moved to another session.
        throw new ApiError({ code: 'not_found', message: 'session moved', status: 404 });
      }
      return meToSession(me);
    },
    presence: () => Promise.resolve(),
    actions: () =>
      Promise.reject(new ApiError({ code: 'forbidden', message: 'read only', status: 403 })),
  };
}
