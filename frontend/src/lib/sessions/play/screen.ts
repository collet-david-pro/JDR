/**
 * Which screen the player sees (projet.md 18.1 p.7-8): a pure function of the session state,
 * the run phase and the preload, so the choice is testable without any component.
 */
import type { RunPhase } from '../session-run.svelte';
import type { SessionStatus } from '../types';

export type PlayScreen = 'loading' | 'error' | 'kicked' | 'ended' | 'paused' | 'lobby' | 'game';

export interface PlayScreenInput {
  readonly phase: RunPhase;
  /** Null until the first snapshot. */
  readonly status: SessionStatus | null;
  /** The session has a current map. */
  readonly hasMap: boolean;
  /** The assets of the current map are downloaded and decoded. */
  readonly preloaded: boolean;
}

export function playScreen(i: PlayScreenInput): PlayScreen {
  if (i.phase === 'kicked') return 'kicked';
  if (i.phase === 'error') return 'error';
  if (i.status === null) return 'loading';
  switch (i.status) {
    case 'ended':
      return 'ended';
    case 'paused':
      return 'paused';
    case 'lobby':
      return 'lobby';
    case 'running':
      return i.hasMap && i.preloaded ? 'game' : 'lobby';
  }
}
