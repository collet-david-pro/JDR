import { errorMessage } from '../errors';
import { t } from '../i18n';
import type { PlayerStatus, SessionStatus } from './types';

export function sessionStateLabel(state: SessionStatus): string {
  switch (state) {
    case 'lobby':
      return t('sessions.state.lobby');
    case 'running':
      return t('sessions.state.running');
    case 'paused':
      return t('sessions.state.paused');
    case 'ended':
      return t('sessions.state.ended');
  }
}

export function playerStatusLabel(status: PlayerStatus): string {
  switch (status) {
    case 'connected':
      return t('sessions.players.connected');
    case 'disconnected':
      return t('sessions.players.disconnected');
    case 'kicked':
      return t('sessions.players.kicked');
  }
}

/** Message of an error of a session screen (session codes are in `errors.*`). */
export function sessionProblem(error: unknown): string {
  return errorMessage(error, t);
}

/** A session that can still be joined or driven. */
export function isOpenSession(state: SessionStatus): boolean {
  return state !== 'ended';
}
