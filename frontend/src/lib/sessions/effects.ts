/**
 * What the reducer asks the UI / the orchestrator to do (no network call in the reducer).
 */
import type { FogChunkWire } from '../../editor/contracts';

export type ReloadReason =
  'started' | 'resumed' | 'map_changed' | 'map_reload' | 'unknown_token' | 'assignment' | 'gone';

export type SessionEffect =
  /** Fetch GET /sessions/{id}/snapshot again and rebuild the state (SessionSync does it). */
  | { readonly kind: 'reload.snapshot'; readonly reason: ReloadReason }
  /** A new map: players read GET /sessions/{id}/preload again (and tell they are ready). */
  | { readonly kind: 'reload.preload' }
  /** Tile blocks to fetch again through GET /maps/{id}/chunks (the engine does it). */
  | {
      readonly kind: 'reload.chunks';
      readonly mapId: string;
      readonly chunks: readonly {
        readonly floor: string;
        readonly cx: number;
        readonly cy: number;
      }[];
    }
  /** Fog bits to add (reveal) or remove (hide): the engine decodes and applies them. */
  | {
      readonly kind: 'fog';
      readonly mapId: string;
      readonly floorId: string;
      readonly op: 'reveal' | 'hide';
      readonly chunks: readonly FogChunkWire[];
    }
  /** note.read_aloud: show the text to read. */
  | {
      readonly kind: 'read_aloud';
      readonly eventId: string;
      readonly title: string;
      readonly body: string;
    }
  /** The user was kicked: leave the session screens. */
  | { readonly kind: 'kicked' }
  /** server.notice (maintenance / reload). */
  | { readonly kind: 'notice'; readonly notice: string; readonly message: string };

export const NO_EFFECTS: readonly SessionEffect[] = Object.freeze([]);
