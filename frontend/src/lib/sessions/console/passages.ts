/**
 * Passages of the console (P9a2): the stairs, portals and linked doors of the shown floor, where each one
 * leads, and the body of the change-map request that takes it. Pure. The GM does everything: nothing
 * here is sent by a player.
 */
import type {
  DoorObject,
  Link,
  MapObject,
  PlacedToken,
  PortalObject,
  StairsObject,
} from '../../../editor/contracts';
import type { MapLinks } from '../../types';
import { assignedTo, tokensOfFloor, type SessionState } from '../state';
import type { ChangeMapBody } from '../sessions-client';

export type PassageObject = StairsObject | PortalObject | DoorObject;

export interface Destination {
  readonly mapId: string;
  /** Floor uid of the target map, null = its first floor. */
  readonly floor: string | null;
  readonly x: number | null;
  readonly y: number | null;
}

export interface Passage {
  readonly uid: string;
  readonly type: 'stairs' | 'portal' | 'door';
  readonly object: PassageObject;
  /** null when the link is broken (the passage is listed but cannot be taken). */
  readonly destination: Destination | null;
  /** Map name and floor name of the destination, when known. */
  readonly mapName: string | null;
  readonly floorName: string | null;
  /** Same map (a floor change). */
  readonly sameMap: boolean;
}

/** Floor (server id) shown by the session, the first floor when none is set. */
export function shownFloor(state: SessionState): string | null {
  return state.session.current_floor_id ?? state.map?.floors[0]?.id ?? null;
}

function isPassage(o: MapObject): o is PassageObject {
  if (o.type === 'stairs' || o.type === 'portal') return true;
  return o.type === 'door' && o.props.link !== undefined && o.props.link !== null;
}

function linkOf(o: PassageObject): Link | null {
  return o.props.link ?? null;
}

/**
 * The passages of a floor, stairs first. `links` (GET /maps/{id}/links) tells which are broken and names the
 * destinations; without it, only what the objects say is used.
 */
export function passagesOf(
  state: SessionState,
  floorId: string,
  links: MapLinks | null,
): Passage[] {
  const map = state.map;
  const mapId = state.session.current_map_id;
  if (map === null || mapId === null) return [];
  const floors = map.floors;
  const order = { stairs: 0, portal: 1, door: 2 } as const;
  const out: Passage[] = [];
  for (const object of Object.values(state.objects)) {
    if (object.floor !== floorId || !isPassage(object)) continue;
    const link = linkOf(object);
    const info = links?.outgoing.find((l) => l.object_uid === object.uid) ?? null;
    let destination: Destination | null = null;
    let mapName: string | null = null;
    let floorName: string | null = null;
    if (link === null) {
      // Stairs without a link: another floor of the same map.
      const to = floors.find((f) => f.uid === (object as StairsObject).props.to_floor);
      if (to !== undefined) {
        destination = { mapId, floor: to.uid, x: null, y: null };
        floorName = to.name;
        mapName = map.name;
      }
    } else if (link.map_id !== null && link.broken !== true && info?.broken !== true) {
      const sameMap = link.map_id === mapId;
      const target = sameMap ? floors.find((f) => f.uid === link.floor) : undefined;
      if (!sameMap || link.floor === null || target !== undefined) {
        destination = { mapId: link.map_id, floor: link.floor, x: link.x, y: link.y };
        mapName = sameMap ? map.name : (info?.to.map_name ?? link.map_name ?? null);
        floorName = sameMap
          ? (target?.name ?? floors[0]?.name ?? null)
          : (info?.to.floor_name ?? null);
      }
    }
    out.push({
      uid: object.uid,
      type: object.type as 'stairs' | 'portal' | 'door',
      object,
      destination,
      mapName,
      floorName,
      sameMap: destination !== null && destination.mapId === mapId,
    });
  }
  return out.sort((a, b) => order[a.type] - order[b.type] || (a.uid < b.uid ? -1 : 1));
}

/** Centre of the source stairs. */
function stairsCentre(o: StairsObject): { x: number; y: number } {
  return { x: o.geometry.x + o.geometry.w / 2, y: o.geometry.y + o.geometry.h / 2 };
}

/**
 * Where the party arrives: the link's position, else the centre of the source stairs, else the centre of the
 * target map; always inside the target grid.
 */
export function defaultPosition(
  passage: Passage,
  grid: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const d = passage.destination;
  let p: { x: number; y: number };
  if (d !== null && d.x !== null && d.y !== null) p = { x: d.x, y: d.y };
  else if (passage.object.type === 'stairs') p = stairsCentre(passage.object);
  else p = { x: grid.width / 2, y: grid.height / 2 };
  return {
    x: Math.round(Math.min(grid.width, Math.max(0, p.x)) * 1000) / 1000,
    y: Math.round(Math.min(grid.height, Math.max(0, p.y)) * 1000) / 1000,
  };
}

export interface TokenChoice {
  readonly token: PlacedToken;
  readonly name: string;
  /** A player's character (assigned to a player). */
  readonly player: boolean;
}

/** Placed tokens of the floor that can be carried along, the players' first. */
export function carriableTokens(state: SessionState, floorId: string): TokenChoice[] {
  return tokensOfFloor(state, floorId)
    .map((token) => ({
      token,
      name: state.definitions[token.token_id]?.name ?? token.uid,
      player: assignedTo(state, token.token_id) !== null,
    }))
    .sort((a, b) => Number(b.player) - Number(a.player) || a.name.localeCompare(b.name));
}

/** Body of change-map for a passage taken to `position`, carrying `tokens`. */
export function travelBody(
  destination: Destination,
  position: { readonly x: number; readonly y: number },
  tokens: readonly string[],
): ChangeMapBody {
  return {
    map_id: destination.mapId,
    ...(destination.floor !== null ? { floor_id: destination.floor } : {}),
    focus: { x: position.x, y: position.y },
    ...(tokens.length > 0 ? { move_tokens: tokens } : {}),
  };
}
