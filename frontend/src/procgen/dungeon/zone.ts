/** Zone mode of the dungeon (D11): size, openings and helpers (never used without `ctx.zone`). */
import type { PopulateOpening } from '../populate';
import { zoneOpenings, type GenZone } from '../zone';
import type { DungeonParams } from './params';

export const ZONE_MIN = 8;
export const ZONE_MAX = 400;

export interface ZoneSetup {
  /** Parameters adapted to the zone (size, room count, room_min, corridor). */
  p: DungeonParams;
  W: number;
  H: number;
  /** Openings kept (border cells, sorted by y then x). */
  openings: [number, number][];
}

/** Validates the zone size and adapts the parameters; throws `zone_too_small` out of 8-400. */
export function setupZone(p: DungeonParams, zone: GenZone): ZoneSetup {
  const { width: W, height: H } = zone;
  const ok = (v: number): boolean => Number.isInteger(v) && v >= ZONE_MIN && v <= ZONE_MAX;
  if (!ok(W) || !ok(H)) throw new Error('zone_too_small');
  const openings = zoneOpenings(zone, W, H);
  const small = Math.min(W, H);
  const roomMin = Math.max(3, Math.min(p.room_min, Math.floor((small - 2) / 2) - 2, small - 4));
  const adapted: DungeonParams = {
    ...p,
    width: W,
    height: H,
    rooms: Math.max(1, Math.min(p.rooms, Math.floor((W * H) / 25))),
    room_min: roomMin,
    room_max: Math.max(p.room_max, roomMin),
    corridor: small < 16 ? 1 : p.corridor,
  };
  return { p: adapted, W, H, openings };
}

/** Doors passed to the population: the outer edge of each opening cell (both for a corner). */
export function openingDoors(
  openings: readonly (readonly [number, number])[],
  W: number,
  H: number,
): PopulateOpening[] {
  const out: PopulateOpening[] = [];
  for (const [x, y] of openings) {
    if (y === 0) out.push({ a: [x, 0], b: [x + 1, 0] });
    if (y === H - 1) out.push({ a: [x, H], b: [x + 1, H] });
    if (x === 0) out.push({ a: [0, y], b: [0, y + 1] });
    if (x === W - 1) out.push({ a: [W, y], b: [W, y + 1] });
  }
  return out;
}
