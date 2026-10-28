/**
 * Generic declarative population (D8): decor, terrain and wall lights placed in regions from a
 * RuleSet. Reused by every generator (no dungeon dependency). Guarantees: no decor on a passage
 * cell (in front of an opening, or on the shortest path between the openings of a region), one
 * decor per cell, nothing on reserved cells, and no opening cut off from the entrance by blocking
 * decor (each blocking item keeps the free floor locally connected; a final BFS checks it).
 */
import type { LightPresetId } from '../editor/tools/types';
import { round3 } from './geometry';
import { bfsDistances, type BitGrid } from './grid';
import type { Rng } from './prng';
import { rulesFor, type RuleItem, type RuleSet } from './populate-rules';
import type { GenCell, GenLight, PackKey } from './types';

type P = readonly [number, number];

export interface PopulateRegion {
  id: number;
  kind: string;
  cells: readonly P[];
}
/** An opening (door or archway) on a cell border, from a to b (axis-aligned). */
export interface PopulateOpening {
  a: P;
  b: P;
}
export interface PopulateInput {
  floor: BitGrid;
  regions: readonly PopulateRegion[];
  doors: readonly PopulateOpening[];
  entrance: P | null;
  ruleSet: RuleSet;
  /** Multiplier of the rule densities and counts (0 = nothing at all). */
  density: number;
  rng: Rng;
  blocking: (key: PackKey) => boolean;
  /** Cells that never receive anything (stairs…). */
  reserved?: readonly P[];
  /** Light preset of the torches when the rules do not set one (default torch). */
  lightPreset?: LightPresetId;
}
export interface PopulateResult {
  decor: GenCell[];
  terrain: GenCell[];
  lights: GenLight[];
}

/** N, E, S, W: index = rotation (x90 clockwise) that turns an object's back to that side. */
const DIRS: readonly P[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
/** 8-ring in circular order (consecutive cells are 4-adjacent); even indices = N, E, S, W. */
const RING: readonly P[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Floor cells on both sides of an opening, along its length. */
export function doorFrontCells(floor: BitGrid, d: PopulateOpening): [number, number][] {
  const out: [number, number][] = [];
  const [ax, ay] = d.a;
  const [bx, by] = d.b;
  if (ay === by) {
    for (let x = Math.min(ax, bx); x < Math.max(ax, bx); x++) {
      for (const y of [ay - 1, ay]) if (floor.get(x, y) !== 0) out.push([x, y]);
    }
  } else if (ax === bx) {
    for (let y = Math.min(ay, by); y < Math.max(ay, by); y++) {
      for (const x of [ax - 1, ax]) if (floor.get(x, y) !== 0) out.push([x, y]);
    }
  }
  return out;
}

/**
 * Passage cells (1) of a floor: the cells in front of every opening, plus, in each region, the
 * shortest paths (inside the region) from its first opening to each of its other openings.
 */
export function passageCells(
  floor: BitGrid,
  regions: readonly PopulateRegion[],
  doors: readonly PopulateOpening[],
): Uint8Array {
  const { w } = floor;
  const passage = new Uint8Array(w * floor.h);
  const regionOf = new Int32Array(w * floor.h).fill(-1);
  regions.forEach((r, ri) => {
    for (const [x, y] of r.cells) if (floor.get(x, y) !== 0) regionOf[y * w + x] = ri;
  });
  // Front cells of each opening, grouped by region (in opening order).
  const byRegion: number[][][] = regions.map(() => []);
  for (const d of doors) {
    const per = new Map<number, number[]>();
    for (const [x, y] of doorFrontCells(floor, d)) {
      const i = y * w + x;
      passage[i] = 1;
      const r = regionOf[i]!;
      if (r < 0) continue;
      const list = per.get(r);
      if (list === undefined) per.set(r, [i]);
      else list.push(i);
    }
    for (let r = 0; r < regions.length; r++) {
      const list = per.get(r);
      if (list !== undefined) byRegion[r]!.push(list);
    }
  }
  const dist = new Int32Array(w * floor.h).fill(-1);
  const touched: number[] = [];
  for (let r = 0; r < regions.length; r++) {
    const openings = byRegion[r]!;
    if (openings.length < 2) continue;
    for (const i of touched) dist[i] = -1;
    touched.length = 0;
    for (const i of openings[0]!) {
      dist[i] = 0;
      touched.push(i);
    }
    for (let q = 0; q < touched.length; q++) {
      const c = touched[q]!;
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!floor.inBounds(nx, ny)) continue;
        const ni = ny * w + nx;
        if (dist[ni] !== -1 || regionOf[ni] !== r) continue;
        dist[ni] = dist[c]! + 1;
        touched.push(ni);
      }
    }
    for (let k = 1; k < openings.length; k++) {
      let cur = -1;
      for (const i of openings[k]!) {
        if (dist[i]! >= 0 && (cur < 0 || dist[i]! < dist[cur]!)) cur = i;
      }
      while (cur >= 0 && dist[cur]! > 0) {
        passage[cur] = 1;
        const cx = cur % w;
        const cy = (cur - cx) / w;
        let next = -1;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!floor.inBounds(nx, ny)) continue;
          const ni = ny * w + nx;
          if (dist[ni] === dist[cur]! - 1) {
            next = ni;
            break;
          }
        }
        cur = next;
      }
    }
  }
  return passage;
}

/** First side (N, E, S, W) of (x, y) that is not floor, or -1. */
function wallSide(floor: BitGrid, x: number, y: number): number {
  for (let d = 0; d < 4; d++) if (floor.get(x + DIRS[d]![0], y + DIRS[d]![1]) === 0) return d;
  return -1;
}

function fitsPlace(floor: BitGrid, x: number, y: number, place: RuleItem['place']): boolean {
  if (place === 'any') return true;
  const solid = (d: number): boolean => floor.get(x + DIRS[d]![0], y + DIRS[d]![1]) === 0;
  if (place === 'wall') return solid(0) || solid(1) || solid(2) || solid(3);
  if (place === 'corner') return (solid(0) || solid(2)) && (solid(1) || solid(3));
  for (const [dx, dy] of RING) if (floor.get(x + dx, y + dy) === 0) return false;
  return true;
}

export function populate(input: PopulateInput): PopulateResult {
  const { floor, regions, doors, ruleSet, rng, blocking } = input;
  const { w, h } = floor;
  const result: PopulateResult = { decor: [], terrain: [], lights: [] };
  if (!(input.density > 0)) return result;
  const passage = passageCells(floor, regions, doors);
  const reserved = new Uint8Array(w * h);
  for (const [x, y] of input.reserved ?? []) if (floor.inBounds(x, y)) reserved[y * w + x] = 1;
  if (input.entrance !== null && floor.inBounds(input.entrance[0], input.entrance[1])) {
    reserved[input.entrance[1] * w + input.entrance[0]] = 1;
  }
  const fronts: number[] = [];
  for (const d of doors) for (const [x, y] of doorFrontCells(floor, d)) fronts.push(y * w + x);
  const doorDist = bfsDistances(
    floor,
    (x, y) => floor.get(x, y) !== 0,
    fronts.map((i): [number, number] => [i % w, Math.floor(i / w)]),
  );
  const decorAt = new Uint8Array(w * h);
  const terrainAt = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  const free = (x: number, y: number): boolean => floor.get(x, y) !== 0 && blocked[y * w + x] === 0;
  /** Blocking (x, y) keeps its free 4-neighbours connected through the 8-ring. */
  const simple = (x: number, y: number): boolean => {
    const f: boolean[] = RING.map(([dx, dy]) => free(x + dx, y + dy));
    if (f.every((v) => v)) return true;
    const start = f.indexOf(false);
    let arc = 0;
    let seen = -1;
    for (let k = 1; k <= 8; k++) {
      const i = (start + k) % 8;
      if (!f[i]) continue;
      if (!f[(i + 7) % 8]) arc++;
      if (i % 2 === 0) {
        if (seen === -1) seen = arc;
        else if (seen !== arc) return false;
      }
    }
    return true;
  };
  const placed: { cell: GenCell; i: number }[] = [];

  for (const region of regions) {
    for (const item of rulesFor(ruleSet, region.kind)) {
      let n: number;
      if (item.count !== null)
        n = Math.round(rng.int(item.count[0], item.count[1]) * input.density);
      else n = Math.floor(region.cells.length * (item.density ?? 0) * input.density + rng.next());
      if (n <= 0) continue;
      const occ = item.layer === 'terrain' ? terrainAt : decorAt;
      const isBlocking = blocking(item.key);
      const cands: P[] = [];
      for (const c of region.cells) {
        const [x, y] = c;
        if (floor.get(x, y) === 0) continue;
        const i = y * w + x;
        if (passage[i] !== 0 || reserved[i] !== 0) continue;
        const dd = doorDist[i]!;
        if (dd >= 0 && dd < item.min_door_distance) continue;
        if (fitsPlace(floor, x, y, item.place)) cands.push(c);
      }
      rng.shuffle(cands);
      let done = 0;
      for (const [x, y] of cands) {
        if (done >= n) break;
        const i = y * w + x;
        if (occ[i] !== 0) continue;
        if (isBlocking && !simple(x, y)) continue;
        const cell: GenCell = { x, y, key: item.key };
        if (item.rotate === 'wall') cell.flags = Math.max(0, wallSide(floor, x, y));
        else if (item.rotate === 'random') cell.flags = rng.int(0, 3);
        occ[i] = 1;
        if (isBlocking) blocked[i] = 1;
        if (item.layer === 'terrain') result.terrain.push(cell);
        else {
          result.decor.push(cell);
          placed.push({ cell, i });
        }
        done++;
      }
    }
  }

  // Final check: every opening reachable from the entrance over free floor; undo blocking decor
  // from the last placed while it is not (the local test makes this a safety net only).
  const origin =
    input.entrance !== null && floor.get(input.entrance[0], input.entrance[1]) !== 0
      ? input.entrance
      : fronts.length > 0
        ? ([fronts[0]! % w, Math.floor(fronts[0]! / w)] as const)
        : null;
  if (origin !== null) {
    const ok = (): boolean => {
      const dist = bfsDistances(floor, free, [origin]);
      return fronts.every((i) => dist[i] !== -1);
    };
    while (!ok()) {
      let k = placed.length - 1;
      while (k >= 0 && blocked[placed[k]!.i] === 0) k--;
      if (k < 0) break;
      const [gone] = placed.splice(k, 1);
      blocked[gone!.i] = 0;
      decorAt[gone!.i] = 0;
      result.decor.splice(result.decor.indexOf(gone!.cell), 1);
    }
  }

  // Wall lights: floor cells of the regions next to a wall, on the wall edge, spaced out.
  const torches = ruleSet.torches;
  if (torches !== null) {
    const preset = torches.preset ?? input.lightPreset ?? 'torch';
    const spots: [number, number][] = [];
    for (const region of regions) {
      for (const [x, y] of region.cells) {
        if (floor.get(x, y) === 0) continue;
        const side = wallSide(floor, x, y);
        if (side < 0) continue;
        spots.push([
          round3(x + 0.5 + DIRS[side]![0] * 0.5),
          round3(y + 0.5 + DIRS[side]![1] * 0.5),
        ]);
      }
    }
    rng.shuffle(spots);
    const s = torches.spacing;
    const buckets = new Map<number, [number, number][]>();
    const bw = Math.floor(w / s) + 2;
    const bucketOf = (bx: number, by: number): number => by * bw + bx;
    for (const [x, y] of spots) {
      const bx = Math.floor(x / s);
      const by = Math.floor(y / s);
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) {
        for (let ox = -1; ox <= 1 && !near; ox++) {
          for (const [lx, ly] of buckets.get(bucketOf(bx + ox, by + oy)) ?? []) {
            if ((lx - x) * (lx - x) + (ly - y) * (ly - y) < s * s) {
              near = true;
              break;
            }
          }
        }
      }
      if (near) continue;
      const key = bucketOf(bx, by);
      const list = buckets.get(key);
      if (list === undefined) buckets.set(key, [[x, y]]);
      else list.push([x, y]);
      result.lights.push({ x, y, preset });
    }
    result.lights.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  return result;
}
