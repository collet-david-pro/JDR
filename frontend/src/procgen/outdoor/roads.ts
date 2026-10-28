/** Roads: A* between points of interest, bridges over narrow water, fords over wide water. */
import { astar } from '../graph';
import type { Rng } from '../prng';
import { FOREST, HILL, MOUNTAIN, SNOW, type Land } from './terrain';

/** Wetness of a cell: 0 dry, 1 shallow water (terrain), 2 deep water, 3 frozen lake (walkable). */
export type Wet = Uint8Array;

export interface Road {
  path: [number, number][];
  /** Runs of water cells crossed by a bridge (<= 3 cells) or a ford (longer). */
  bridges: [number, number][][];
  fords: [number, number][][];
}

const BRIDGE_MAX = 3;

export function buildRoads(land: Land, wet: Wet, count: number, rng: Rng): Road[] {
  const { w, h, elev, biome } = land;
  const roads: Road[] = [];
  if (count <= 0) return roads;
  const cost = new Float64Array(w * h);
  const road = new Uint8Array(w * h);
  const slope = (x: number, y: number): number => {
    const e = elev[y * w + x]!;
    let m = 0;
    if (x > 0) m = Math.max(m, Math.abs(e - elev[y * w + x - 1]!));
    if (x < w - 1) m = Math.max(m, Math.abs(e - elev[y * w + x + 1]!));
    if (y > 0) m = Math.max(m, Math.abs(e - elev[(y - 1) * w + x]!));
    if (y < h - 1) m = Math.max(m, Math.abs(e - elev[(y + 1) * w + x]!));
    return m / land.range;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (wet[i] === 2) {
        cost[i] = Infinity;
        continue;
      }
      let c = 1.5 + Math.min(6, slope(x, y) * 30);
      const b = biome[i];
      if (b === MOUNTAIN || b === SNOW) c += 3;
      else if (b === HILL || b === FOREST) c += 1;
      if (wet[i] === 1) c += 10;
      else if (wet[i] === 3) c += 1;
      cost[i] = c;
    }
  }
  const borderLand: number[] = [];
  const interior: number[] = [];
  const onBorder = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === w - 1 || y === h - 1;
  for (let i = 0; i < w * h; i++) {
    if (wet[i] !== 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (onBorder(x, y)) borderLand.push(i);
    else if (x > 2 && y > 2 && x < w - 3 && y < h - 3 && biome[i] !== MOUNTAIN && biome[i] !== SNOW)
      interior.push(i);
  }
  if (borderLand.length === 0) return roads;
  const dist = (a: number, b: number): number =>
    Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
  const roadCells: number[] = [];

  for (let k = 0; k < count; k++) {
    const r = rng.fork(`road-${k}`);
    const a = r.pick(borderLand);
    let b: number;
    if (k === 0) {
      const far = borderLand.filter((c) => dist(a, c) >= (w + h) / 2);
      if (far.length > 0) b = r.pick(far);
      else {
        b = borderLand[0]!;
        for (const c of borderLand) if (dist(a, c) > dist(a, b)) b = c;
      }
    } else if (k % 2 === 1 && interior.length > 0) {
      b = r.pick(interior);
    } else if (roadCells.length > 0) {
      b = r.pick(roadCells);
    } else {
      b = r.pick(borderLand);
    }
    if (a === b) continue;
    const roadCost = (x: number, y: number): number =>
      road[y * w + x] === 1 ? 1 : cost[y * w + x]!;
    const path = astar(w, h, roadCost, [a % w, Math.floor(a / w)], [b % w, Math.floor(b / w)]);
    if (path === null) continue;
    const out: Road = { path, bridges: [], fords: [] };
    let run: [number, number][] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      (run.length <= BRIDGE_MAX ? out.bridges : out.fords).push(run);
      run = [];
    };
    for (const [x, y] of path) {
      const i = y * w + x;
      if (wet[i] === 1) run.push([x, y]);
      else flush();
      if (road[i] === 0 && wet[i] === 0) roadCells.push(i);
      road[i] = 1;
    }
    flush();
    // The fords stop being water for the next roads.
    for (const run2 of out.fords) for (const [x, y] of run2) wet[y * w + x] = 0;
    roads.push(out);
  }
  return roads;
}
