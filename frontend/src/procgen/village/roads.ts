/** Village ground and roads: a winding main road across the map, branches and a town square. */
import { astar } from '../graph';
import type { NoiseFn } from '../noise';
import type { Rng } from '../prng';
import type { VillageTheme } from '../themes/village';
import type { Cell } from './geom';

export interface Roads {
  /** 1 = road cell (plaza included). */
  road: Uint8Array;
  /** Road centre lines (main first), used as building sites. */
  paths: Cell[][];
  entrance: Cell;
  exit: Cell;
  /** Plaza rectangle (x0, y0, x1, y1 inclusive) or null. */
  plaza: [number, number, number, number] | null;
  cells: number;
}

export function buildRoads(
  W: number,
  H: number,
  theme: VillageTheme,
  noise: NoiseFn,
  rng: Rng,
): Roads {
  const road = new Uint8Array(W * H);
  const lo = Math.floor((theme.road_width - 1) / 2);
  const hi = theme.road_width - 1 - lo;
  const stamp = (cx: number, cy: number): void => {
    for (let dy = -lo; dy <= hi; dy++) {
      for (let dx = -lo; dx <= hi; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) road[y * W + x] = 1;
      }
    }
  };
  const margin = Math.max(6, Math.floor(Math.min(W, H) * 0.2));
  const horizontal = rng.chance(0.5);
  const len = horizontal ? W : H; // along the main road
  const cross = horizontal ? H : W;
  const c0 = rng.int(Math.floor(cross * 0.35), Math.floor(cross * 0.65));
  const c1 = rng.int(Math.floor(cross * 0.35), Math.floor(cross * 0.65));
  const at = (a: number, c: number): Cell => (horizontal ? [a, c] : [c, a]);
  const noiseCost = (x: number, y: number): number => 1 + 1.5 * (noise(x * 0.15, y * 0.15) + 1);
  const inMargin = (x: number, y: number): boolean => {
    const c = horizontal ? y : x;
    return c >= margin && c < cross - margin;
  };
  const main = astar(
    W,
    H,
    (x, y) => (inMargin(x, y) ? noiseCost(x, y) : Infinity),
    at(0, c0),
    at(len - 1, c1),
  ) ?? [at(0, c0), at(len - 1, c1)];
  const paths: Cell[][] = [main];
  for (const [x, y] of main) stamp(x, y);

  // Branches: perpendicular to the main road, possibly dead ends.
  const size = Math.min(W, H);
  const maxBranches = Math.min(3, Math.floor(size / 25));
  const branches = rng.int(Math.min(1, maxBranches), maxBranches);
  for (let b = 0; b < branches; b++) {
    const from = main[rng.int(Math.floor(main.length * 0.2), Math.floor(main.length * 0.8))]!;
    const up = rng.chance(0.5);
    const along = horizontal ? from[0] : from[1];
    const lat = Math.min(Math.max(along + rng.int(-8, 8), margin), len - 1 - margin);
    const goal: Cell = horizontal ? [lat, up ? 0 : H - 1] : [up ? 0 : W - 1, lat];
    const alongMargin = (x: number, y: number): boolean => {
      const a = horizontal ? x : y;
      return a >= margin && a < len - margin;
    };
    const path = astar(
      W,
      H,
      (x, y) => {
        if (x === from[0] && y === from[1]) return 1;
        if (x === goal[0] && y === goal[1]) return 1;
        if (!alongMargin(x, y)) return Infinity;
        return road[y * W + x] !== 0 ? 4 : noiseCost(x, y);
      },
      [from[0], from[1]],
      goal,
    );
    if (path === null) continue;
    const keep = Math.max(
      8,
      Math.floor(path.length * (rng.chance(0.5) ? 1 : rng.float(0.55, 0.95))),
    );
    const kept = path.slice(0, keep);
    for (const [x, y] of kept) stamp(x, y);
    paths.push(kept);
  }

  // Central square (town).
  let plaza: Roads['plaza'] = null;
  if (theme.plaza !== null) {
    const [px, py] = main[Math.floor(main.length / 2)]!;
    const half = 4;
    const x0 = Math.max(1, px - half);
    const y0 = Math.max(1, py - half);
    const x1 = Math.min(W - 2, px + half);
    const y1 = Math.min(H - 2, py + half);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) road[y * W + x] = 1;
    plaza = [x0, y0, x1, y1];
  }
  let cells = 0;
  for (let i = 0; i < road.length; i++) cells += road[i]!;
  return { road, paths, entrance: main[0]!, exit: main[main.length - 1]!, plaza, cells };
}
