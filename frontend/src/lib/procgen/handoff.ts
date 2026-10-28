/**
 * Hand-off of a generation to a NEW map: the "Générer" dialog creates the map
 * (POST /games/{id}/maps), `stashGeneration(mapId, payload)`, navigates to the editor, and the
 * editor calls `takeGeneration(mapId)` on mount and applies it. Module memory, single use.
 */
import type { GenResult } from '../../procgen/types';

export interface GenerationHandoff {
  result: GenResult;
  /** Params as sent to the generator (stored in maps.generation by the caller). */
  params: Record<string, unknown>;
  fingerprint?: string;
}

const stash = new Map<string, GenerationHandoff>();

export function stashGeneration(mapId: string, payload: GenerationHandoff): void {
  stash.set(mapId, payload);
}

/** Returns the stashed generation of this map once, then forgets it. */
export function takeGeneration(mapId: string): GenerationHandoff | null {
  const payload = stash.get(mapId) ?? null;
  stash.delete(mapId);
  return payload;
}
