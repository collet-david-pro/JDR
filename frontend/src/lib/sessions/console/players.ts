/** Pure helpers of the console "Players" panel and of the player lists. */
import type { Token } from '../../types';
import type { SessionPlayer } from '../types';
import { assignedTo, type SessionState } from '../state';

export interface PlayerRow {
  readonly player: SessionPlayer;
  /** Token definitions assigned to this player. */
  readonly tokens: readonly Token[];
}

/** Players (not kicked first by name) with their assigned token definitions. */
export function playerRows(state: SessionState): PlayerRow[] {
  const defs = Object.values(state.definitions);
  return [...state.session.players]
    .sort((a, b) => {
      const ka = a.status === 'kicked' ? 1 : 0;
      const kb = b.status === 'kicked' ? 1 : 0;
      return ka - kb || a.username.localeCompare(b.username);
    })
    .map((player) => ({
      player,
      tokens: defs.filter((d) => assignedTo(state, d.id) === player.user_id),
    }));
}

/** Definitions nobody is assigned to (player characters first, then by name). */
export function unassignedTokens(state: SessionState): Token[] {
  return Object.values(state.definitions)
    .filter((d) => assignedTo(state, d.id) === null)
    .sort(
      (a, b) => Number(b.kind === 'pc') - Number(a.kind === 'pc') || a.name.localeCompare(b.name),
    );
}

/** Players who can receive a token (everybody but the kicked ones). */
export function assignablePlayers(state: SessionState): SessionPlayer[] {
  return state.session.players.filter((p) => p.status !== 'kicked');
}

/** How many players are connected and ready. */
export function readiness(state: SessionState): { connected: number; ready: number } {
  const active = state.session.players.filter((p) => p.status === 'connected');
  return { connected: active.length, ready: active.filter((p) => p.ready).length };
}
