/**
 * Session API types (etapes/P06 "CONTRAT": "Objet séance", endpoints, actions, snapshot,
 * preload). Identifiers are strings, dates ISO 8601 UTC strings, coordinates in cells.
 */
import type { Ambient, FogChunkWire } from '../../editor/contracts';
import type { MapDetail, MapAmbient, Token } from '../types';

export type SessionStatus = 'lobby' | 'running' | 'paused' | 'ended';
export type SessionRole = 'gm' | 'player';
export type PlayerStatus = 'connected' | 'disconnected' | 'kicked';

export interface SessionPlayer {
  readonly user_id: string;
  readonly username: string;
  readonly status: PlayerStatus;
  readonly ready: boolean;
}

export interface SessionAssignment {
  readonly token_id: string;
  readonly user_id: string;
}

export interface SessionSettings {
  readonly fog_strict: boolean;
  readonly players_blocked_by_walls: boolean;
  readonly players_can_move_own_tokens: boolean;
  readonly players_see_other_pcs: boolean;
}

export interface SessionCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly floor_id: string | null;
  readonly follow: boolean;
}

export interface PauseScreen {
  readonly asset_id: string | null;
  readonly text: string | null;
}

/** "Objet séance" (the code is only given to the GM / co-GMs). */
export interface Session {
  readonly id: string;
  readonly game_id: string;
  readonly name: string;
  readonly code?: string;
  readonly state: SessionStatus;
  readonly current_map_id: string | null;
  readonly current_floor_id: string | null;
  readonly camera: SessionCamera | null;
  readonly pause_screen: PauseScreen | null;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly players: readonly SessionPlayer[];
  readonly assignments: readonly SessionAssignment[];
  readonly settings: SessionSettings;
  readonly role: SessionRole;
  readonly last_event_id: string;
}

/** POST /games/{id}/sessions */
export interface SessionInput {
  readonly name?: string;
  readonly map_id?: string;
  readonly floor_id?: string;
}

/** PATCH /sessions/{id} */
export interface SessionPatch {
  readonly name?: string;
  readonly pause_screen?: PauseScreen | null;
}

export interface SessionList {
  readonly items: readonly Session[];
  readonly nextCursor: string | null;
}

/** POST /sessions/join */
export interface JoinResult {
  readonly session_id: string;
  readonly game_id: string;
}

export interface PreloadAsset {
  readonly id: string;
  readonly url: string;
  readonly bytes: number;
  readonly kind: string;
}

/** GET /sessions/{id}/preload */
export interface Preload {
  readonly map_id: string;
  readonly floor_id: string | null;
  readonly assets: readonly PreloadAsset[];
  readonly total_bytes: number;
}

/** GET /sessions/{id}/snapshot (a player gets map = null in the lobby and once ended). */
export interface SessionSnapshot {
  readonly session: Session;
  readonly map: MapDetail | null;
  /** Definitions of the placed tokens (filtered for a player). */
  readonly tokens: readonly Token[];
  /** Fog of the current floor (the one given by `floor`). */
  readonly fog: { readonly floor: string | null; readonly chunks: readonly FogChunkWire[] };
  /** Uids of the revealed objects. */
  readonly revealed: readonly string[];
  readonly last_event_id: string;
}

// ---- Actions (POST /sessions/{id}/actions) -----------------------------------------------

export type SessionAction =
  | {
      readonly type: 'token.move';
      readonly uid: string;
      readonly x: number;
      readonly y: number;
      readonly rotation?: number;
    }
  | { readonly type: 'door.toggle'; readonly uid: string; readonly state?: 'open' | 'closed' }
  | { readonly type: 'reveal'; readonly kind: 'object' | 'token'; readonly uid: string }
  | {
      readonly type: 'fog.reveal' | 'fog.hide';
      readonly floor: string;
      readonly chunks: readonly FogChunkWire[];
    }
  | {
      readonly type: 'camera.set';
      readonly x: number;
      readonly y: number;
      readonly zoom: number;
      readonly floor_id?: string;
      readonly follow?: boolean;
    }
  | { readonly type: 'ambient.set'; readonly ambient: Partial<MapAmbient> }
  | { readonly type: 'note.show'; readonly title: string; readonly body: string }
  | { readonly type: 'light.toggle'; readonly uid: string; readonly enabled?: boolean };

export type SessionActionType = SessionAction['type'];

/** A refused token.move: the token was brought back to `position` (D8). */
export interface ActionBlocked {
  readonly index: number;
  readonly ok: false;
  readonly error: 'blocked_by_wall';
  readonly position: { readonly x: number; readonly y: number };
}

/** An applied action; the extra members depend on the action (etapes/P06 "P6c terminé"). */
export interface ActionApplied {
  readonly index: number;
  readonly ok: true;
  readonly uid?: string;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly state?: 'open' | 'closed';
  readonly enabled?: boolean;
  readonly kind?: 'object' | 'token';
  /** fog.reveal of a player: number of bits refused (outside the vision, D9). */
  readonly rejected_bits?: number;
  readonly camera?: unknown;
  readonly ambient?: unknown;
}

export type ActionResult = ActionApplied | ActionBlocked;

export interface ActionsRequest {
  readonly client_op_id?: string;
  readonly actions: readonly SessionAction[];
}

export interface ActionsResponse {
  readonly results: readonly ActionResult[];
  readonly last_event_id: string;
}

/** Loose ambient of the wire (`tint` may be null in a map detail). */
export type WireAmbient = MapAmbient | Ambient;
