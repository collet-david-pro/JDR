/**
 * Immutable replica of a session as seen by one user: the session object, the scene
 * (objects, placed tokens, ambient) and what the events change. Built from a snapshot, then
 * moved by the pure reducer (reducer.ts). Whatever is not data (fog bitmaps, tile blocks,
 * messages to read) is handed to the UI as effects, never stored here.
 */
import type { Ambient, MapObject, PlacedToken } from '../../editor/contracts';
import type { MapDetail, Token } from '../types';
import type { Session, SessionRole, SessionSnapshot } from './types';

/** The map without its content (the content lives in `objects`, `tokens`, `ambient`). */
export type MapHead = Omit<MapDetail, 'objects' | 'tokens_placed' | 'ambient'>;

export interface SessionState {
  /** Id of the user this replica belongs to. */
  readonly me: string;
  readonly role: SessionRole;
  readonly session: Session;
  readonly map: MapHead | null;
  /** Revision of the map after the last map.ops(.public) received. */
  readonly mapRevision: number | null;
  readonly ambient: MapDetail['ambient'] | Ambient | null;
  /** Objects of every floor of the map, by uid. */
  readonly objects: Readonly<Record<string, MapObject>>;
  /** Placed tokens of every floor, by uid. */
  readonly tokens: Readonly<Record<string, PlacedToken>>;
  /** Token definitions of the game, by id. */
  readonly definitions: Readonly<Record<string, Token>>;
  /** Uids of the objects revealed to the players. */
  readonly revealed: readonly string[];
  /** Highest event id applied (snapshot included): events up to it are never applied again. */
  readonly lastEventId: string;
  /** The user was kicked from the session. */
  readonly kicked: boolean;
}

export function createSessionState(snapshot: SessionSnapshot, me: string): SessionState {
  const full = snapshot.map;
  let map: MapHead | null = null;
  const objects: Record<string, MapObject> = {};
  const tokens: Record<string, PlacedToken> = {};
  if (full !== null) {
    const { objects: o, tokens_placed: t, ambient: _ambient, ...head } = full;
    map = head;
    for (const obj of o) objects[obj.uid] = obj;
    for (const tok of t) tokens[tok.uid] = tok;
  }
  const definitions: Record<string, Token> = {};
  for (const def of snapshot.tokens) definitions[def.id] = def;
  return {
    me,
    role: snapshot.session.role,
    session: snapshot.session,
    map,
    mapRevision: full?.revision ?? null,
    ambient: full?.ambient ?? null,
    objects,
    tokens,
    definitions,
    revealed: snapshot.revealed,
    lastEventId: snapshot.last_event_id,
    kicked: false,
  };
}

/** Placed tokens of a floor. */
export function tokensOfFloor(state: SessionState, floor: string): PlacedToken[] {
  return Object.values(state.tokens).filter((t) => t.floor === floor);
}

/** Objects of a floor. */
export function objectsOfFloor(state: SessionState, floor: string): MapObject[] {
  return Object.values(state.objects).filter((o) => o.floor === floor);
}

/** User id of the owner of a token definition, null when nobody is assigned. */
export function assignedTo(state: SessionState, tokenId: string): string | null {
  return state.session.assignments.find((a) => a.token_id === tokenId)?.user_id ?? null;
}

/** Placed tokens the user may move (a player: the assigned ones; the GM: all). */
export function ownTokens(state: SessionState): PlacedToken[] {
  return Object.values(state.tokens).filter(
    (t) => state.role === 'gm' || assignedTo(state, t.token_id) === state.me,
  );
}

export function sessionChannels(state: SessionState): string[] {
  const channels = [`session:${state.session.id}`];
  if (state.role === 'gm' && state.session.current_map_id !== null) {
    channels.push(`map:${state.session.current_map_id}`);
  }
  return channels;
}
