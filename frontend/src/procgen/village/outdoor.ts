/** Outdoor details: fences, well, stalls, lanterns, trees and bushes. */
import { BitGrid, bfsDistances } from '../grid';
import { poissonDisk } from '../poisson';
import type { Rng } from '../prng';
import type { VillageTheme } from '../themes/village';
import type { GenCell, GenLight } from '../types';
import { OCC_FREE, OCC_RING, OCC_ROAD, type Building } from './buildings';
import { DIRS, type Cell } from './geom';
import type { Roads } from './roads';

export interface OutdoorInput {
  W: number;
  H: number;
  theme: VillageTheme;
  decorLevel: number;
  occ: Uint8Array;
  roads: Roads;
  buildings: readonly Building[];
  /** Outside cell of each entrance door (same order as the buildings). */
  strips: readonly Cell[];
  rngFence: Rng;
  rngSpots: Rng;
  rngTrees: Rng;
}

export function placeOutdoor(i: OutdoorInput): { decor: GenCell[]; lights: GenLight[] } {
  const { W, H, theme, occ, roads } = i;
  const decor: GenCell[] = [];
  const lights: GenLight[] = [];
  const taken = new Uint8Array(W * H);
  // Cells kept free: the door strip and its two lateral neighbours.
  const reserved = new Uint8Array(W * H);
  i.buildings.forEach((b, k) => {
    const [sx, sy] = i.strips[k]!;
    const horizontalFront = b.front === 'N' || b.front === 'S';
    for (let t = -1; t <= 1; t++) {
      const x = sx + (horizontalFront ? t : 0);
      const y = sy + (horizontalFront ? 0 : t);
      if (x >= 0 && y >= 0 && x < W && y < H) reserved[y * W + x] = 1;
    }
  });
  const put = (x: number, y: number, key: string): void => {
    taken[y * W + x] = 1;
    decor.push({ x, y, key });
  };
  const usable = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < W &&
    y < H &&
    (occ[y * W + x] === OCC_FREE || occ[y * W + x] === OCC_RING) &&
    reserved[y * W + x] === 0 &&
    taken[y * W + x] === 0;

  // Fences around some rural plots: the ring of the building, open in front of the door.
  if (theme.fence_p > 0) {
    i.buildings.forEach((b) => {
      if (!i.rngFence.chance(theme.fence_p)) return;
      for (const r of b.rects) {
        for (let y = r.y - 1; y <= r.y + r.h; y++) {
          for (let x = r.x - 1; x <= r.x + r.w; x++) {
            const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
            if (inside || !usable(x, y)) continue;
            // Ring cell of this rectangle that is not a footprint cell of the same building.
            if (b.rects.some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h))
              continue;
            put(x, y, 'decor.fence');
          }
        }
      }
    });
  }

  // Well (rural: near a road; town: centre of the square) and stalls (town).
  if (roads.plaza !== null) {
    const [x0, y0, x1, y1] = roads.plaza;
    const cx = Math.floor((x0 + x1) / 2);
    const cy = Math.floor((y0 + y1) / 2);
    put(cx, cy, 'decor.well');
    if (theme.stalls && i.decorLevel > 0) {
      const wanted = Math.round(2 + i.decorLevel * 4);
      const spots: Cell[] = [];
      for (let y = y0 + 1; y < y1; y++) {
        for (let x = x0 + 1; x < x1; x++) {
          if (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1) continue;
          let inner = true;
          for (let dy = -1; dy <= 1 && inner; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (occ[(y + dy) * W + x + dx] !== OCC_ROAD) inner = false;
            }
          }
          if (inner) spots.push([x, y]);
        }
      }
      i.rngSpots.shuffle(spots);
      const stalls: Cell[] = [];
      for (const [x, y] of spots) {
        if (stalls.length >= wanted) break;
        if (stalls.some(([sx, sy]) => Math.abs(sx - x) < 2 && Math.abs(sy - y) < 2)) continue;
        stalls.push([x, y]);
        put(x, y, 'decor.stall');
      }
    }
  } else {
    const dist = bfsDistances(
      { w: W, h: H },
      () => true,
      roads.paths.flat().map((c): Cell => [c[0], c[1]]),
    );
    const spots: Cell[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = dist[y * W + x]!;
        if (d >= 4 && d <= 8 && occ[y * W + x] === OCC_FREE && usable(x, y)) spots.push([x, y]);
      }
    }
    if (spots.length > 0) {
      const [x, y] = spots[i.rngSpots.int(0, spots.length - 1)]!;
      put(x, y, 'decor.well');
    }
  }

  // Lanterns along the roads (town).
  if (theme.lanterns && i.decorLevel > 0) {
    const spots: Cell[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!usable(x, y)) continue;
        if (
          DIRS.some(
            ([dx, dy]) =>
              occ[(y + dy) * W + x + dx] === OCC_ROAD &&
              x + dx >= 0 &&
              x + dx < W &&
              y + dy >= 0 &&
              y + dy < H,
          )
        )
          spots.push([x, y]);
      }
    }
    i.rngSpots.shuffle(spots);
    const gap = 5 + (1 - i.decorLevel) * 6;
    const chosen: Cell[] = [];
    for (const [x, y] of spots) {
      if (chosen.some(([sx, sy]) => (sx - x) * (sx - x) + (sy - y) * (sy - y) < gap * gap))
        continue;
      chosen.push([x, y]);
    }
    for (const [x, y] of chosen) {
      put(x, y, 'decor.lantern');
      lights.push({ x: x + 0.5, y: y + 0.5, preset: 'lantern' });
    }
  }

  // Trees and bushes scattered off the roads and plots.
  if (i.decorLevel > 0) {
    const mask = new BitGrid(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++)
        if (occ[y * W + x] === OCC_FREE && usable(x, y)) mask.set(x, y, 1);
    }
    const spacing = 3 + (1 - i.decorLevel) * 6 + (theme.lanterns ? 2 : 0);
    const pts = poissonDisk(i.rngTrees, W, H, () => spacing, {
      mask,
      maxPoints: Math.floor((W * H * i.decorLevel) / 25),
    });
    for (const [px, py] of pts) {
      const x = Math.floor(px);
      const y = Math.floor(py);
      if (taken[y * W + x] !== 0) continue;
      put(x, y, i.rngTrees.chance(theme.tree_p) ? 'decor.tree' : 'decor.bush');
    }
  }
  return { decor, lights };
}
