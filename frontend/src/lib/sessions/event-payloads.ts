/**
 * Payloads of the events of the catalogue (etapes/P06 "Catalogue" and "P6c terminé").
 * `view` marks the D4 events: "gm" = complete version, "player" = filtered version; a GM client
 * ignores the "player" ones (it reads every audience).
 */
import type { FogChunkWire, MapObject, PlacedToken } from '../../editor/contracts';
import type { WireMapOp } from '../types';
import type { PauseScreen, SessionCamera, SessionStatus, WireAmbient } from './types';

export type EventView = 'gm' | 'player';

export interface ViewTag {
  readonly view?: EventView;
}

export interface SessionStatePayload {
  readonly state: SessionStatus;
  readonly current_map_id: string | number | null;
  readonly floor_id: string | number | null;
  readonly pause_screen: PauseScreen | null;
}

export interface UserPayload {
  readonly user_id: string | number;
  readonly username?: string;
}

export interface ReadyPayload {
  readonly user_id: string | number;
  readonly ready: boolean;
}

export interface AssignmentPayload {
  readonly token_id: string | number;
  readonly user_id: string | number | null;
}

export interface MapChangedPayload {
  readonly map_id: string | number;
  readonly floor_id: string | number | null;
}

export interface TokenMovedPayload extends ViewTag {
  readonly uid: string;
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
  readonly floor?: string;
}

export type TokenPayload = PlacedToken & ViewTag;

export interface TokenRemovedPayload extends ViewTag {
  readonly uid: string;
}

export interface DoorToggledPayload extends ViewTag {
  readonly uid: string;
  readonly state: 'open' | 'closed';
}

export type ObjectPayload = MapObject & ViewTag;

export interface FogUpdatedPayload extends ViewTag {
  readonly map_id: string | number;
  readonly floor_id: string | number;
  readonly op: 'reveal' | 'hide';
  readonly chunks: readonly FogChunkWire[];
}

export interface AmbientPayload {
  readonly ambient: WireAmbient;
}

export type CameraPayload = SessionCamera;

export interface NotePayload {
  readonly title: string;
  readonly body: string;
}

export interface MapOpsPayload {
  readonly map_id: string | number;
  readonly revision: number;
  readonly ops: readonly WireMapOp[];
  readonly actor?: string;
}

export interface MapOpsPublicPayload extends ViewTag {
  readonly map_id: string | number;
  readonly revision: number;
  readonly objects: { readonly upsert: readonly MapObject[]; readonly remove: readonly string[] };
  /** Tile blocks touched: [floor, cx, cy]. */
  readonly chunks: readonly (readonly [string | number, number, number])[];
  /** The map changed in a way the client cannot patch: reload the snapshot. */
  readonly reload?: boolean;
}

export interface NoticePayload {
  readonly kind: 'maintenance' | 'reload' | string;
  readonly message?: string;
}
