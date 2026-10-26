import type { StorageLike } from './deps';
import type { TransportMode } from './types';

const MODES: readonly TransportMode[] = ['sse', 'longpoll', 'poll'];

/** Order of preference: the first is the best. */
export const MODE_LADDER: readonly TransportMode[] = MODES;

/** Mode retained for a server, memorised in localStorage (projet.md 10.3, rule 3). */
export class ModeMemory {
  private readonly key: string;

  constructor(
    private readonly storage: StorageLike | null,
    serverKey: string,
  ) {
    this.key = `jdr.sync.mode:${serverKey}`;
  }

  read(): TransportMode | null {
    try {
      const value = this.storage?.getItem(this.key) ?? null;
      return (MODES as readonly (string | null)[]).includes(value)
        ? (value as TransportMode)
        : null;
    } catch {
      return null;
    }
  }

  write(mode: TransportMode): void {
    try {
      this.storage?.setItem(this.key, mode);
    } catch {
      // Storage unavailable (private window, quota): the mode is simply not remembered.
    }
  }
}
