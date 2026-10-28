/** Building plots along the roads: rectangular or L-shaped footprints facing the road. */
import type { Rng } from '../prng';
import type { BuildingType, VillageTheme } from '../themes/village';
import { DIRS, frontSideOf, type Cell, type Rect, type Side } from './geom';

export interface Building {
  type: BuildingType;
  /** Footprint: main rectangle first (it holds the front wall), then the optional wing. */
  rects: Rect[];
  /** Direction from the road towards the building. */
  d: Cell;
  /** Side of the main rectangle facing the road (the entrance side). */
  front: Side;
}

/** Occupancy codes of the `occ` grid. */
export const OCC_FREE = 0;
export const OCC_ROAD = 1;
export const OCC_BUILDING = 2;
export const OCC_RING = 3;

/** [along min, along max, depth min, depth max] of each type. */
const SIZES: Readonly<Record<BuildingType, readonly [number, number, number, number]>> = {
  tavern: [9, 13, 8, 10],
  forge: [6, 8, 5, 7],
  house: [5, 8, 5, 7],
  farm: [8, 12, 6, 8],
  storehouse: [6, 9, 5, 7],
  temple: [7, 9, 9, 12],
  shop: [6, 8, 5, 7],
};
const TYPE_ORDER: readonly BuildingType[] = [
  'house',
  'farm',
  'storehouse',
  'forge',
  'tavern',
  'shop',
  'temple',
];

export function placeBuildings(
  count: number,
  lShapeP: number,
  theme: VillageTheme,
  W: number,
  H: number,
  occ: Uint8Array,
  sites: readonly Cell[],
  rng: Rng,
): Building[] {
  const out: Building[] = [];
  if (sites.length === 0) return out;
  const maxTries = count * 80 + 200;
  for (let t = 0; t < maxTries && out.length < count; t++) {
    const c = sites[rng.int(0, sites.length - 1)]!;
    const d = DIRS[rng.int(0, 3)]!;
    // First non-road cell in direction d (the strip in front of the door).
    let k = 1;
    while (k <= 3) {
      const x = c[0] + d[0] * k;
      const y = c[1] + d[1] * k;
      if (x < 0 || y < 0 || x >= W || y >= H) {
        k = 99;
        break;
      }
      if (occ[y * W + x] !== OCC_ROAD) break;
      k++;
    }
    if (k > 3) continue;
    const ex = c[0] + d[0] * k;
    const ey = c[1] + d[1] * k;
    if (occ[ey * W + ex] === OCC_BUILDING) continue;
    const type: BuildingType =
      out.length === 0 && count >= 3
        ? 'tavern'
        : rng.weighted(TYPE_ORDER, (ty) => theme.type_weights[ty]);
    const [amin, amax, dmin, dmax] = SIZES[type];
    const a = rng.int(amin, amax);
    const dp = rng.int(dmin, dmax);
    // Local frame: cell(u, v) = o + u * t + v * d, row v = 0 is the front row.
    const ox = ex + d[0];
    const oy = ey + d[1];
    const tx = d[1] !== 0 ? 1 : 0;
    const ty = d[1] !== 0 ? 0 : 1;
    const u0 = -Math.floor(a / 2);
    const local: [number, number, number, number][] = [[u0, 0, a, dp]];
    if (dp >= 6 && rng.chance(lShapeP)) {
      const bw = rng.int(5, 7);
      const bd = rng.int(5, dp - 1);
      const left = rng.chance(0.5);
      local.push([left ? u0 - bw : u0 + a, dp - bd, bw, bd]);
    }
    const rects: Rect[] = local.map(([u, v, uw, vh]) => {
      const ax = ox + u * tx + v * d[0];
      const ay = oy + u * ty + v * d[1];
      const bx = ox + (u + uw - 1) * tx + (v + vh - 1) * d[0];
      const by = oy + (u + uw - 1) * ty + (v + vh - 1) * d[1];
      const x = Math.min(ax, bx);
      const y = Math.min(ay, by);
      return { x, y, w: Math.max(ax, bx) - x + 1, h: Math.max(ay, by) - y + 1 };
    });
    // The door needs at least 3 front columns with the road right behind the strip.
    let roadCols = 0;
    for (let u = u0 + 1; u <= u0 + a - 2; u++) {
      const rx = ox + u * tx - 2 * d[0];
      const ry = oy + u * ty - 2 * d[1];
      if (rx >= 0 && ry >= 0 && rx < W && ry < H && occ[ry * W + rx] === OCC_ROAD) roadCols++;
    }
    if (roadCols < 3) continue;
    let ok = true;
    for (const r of rects) {
      if (r.x < 2 || r.y < 2 || r.x + r.w > W - 2 || r.y + r.h > H - 2) ok = false;
      for (let y = r.y; ok && y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (occ[y * W + x] !== OCC_FREE) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    for (const r of rects) {
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          const i = y * W + x;
          const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
          if (inside) occ[i] = OCC_BUILDING;
          else if (occ[i] === OCC_FREE) occ[i] = OCC_RING;
        }
      }
    }
    out.push({ type, rects, d: [d[0], d[1]], front: frontSideOf(d) });
  }
  return out;
}
