/** Rivers: sources in the highlands, steepest descent, breakthrough at local minima. */
import type { Rng } from '../prng';
import { DEEP, WATER, type Land } from './terrain';

const NB4: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface RiverResult {
  /** 1 on the river cells. */
  mask: Uint8Array;
  rivers: number;
  /** Rivers that end neither in water nor on the map border. */
  deadEnds: number;
}

export function carveRivers(land: Land, count: number, rng: Rng): RiverResult {
  const { w, h, elev, biome } = land;
  const mask = new Uint8Array(w * h);
  const result: RiverResult = { mask, rivers: 0, deadEnds: 0 };
  if (count <= 0) return result;
  const isWater = (i: number): boolean => biome[i]! === DEEP || biome[i]! === WATER;
  const border = (i: number): boolean => {
    const x = i % w;
    const y = (i - x) / w;
    return x === 0 || y === 0 || x === w - 1 || y === h - 1;
  };
  const cands: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!isWater(i) && elev[i]! >= land.springL) cands.push(i);
    }
  }
  rng.shuffle(cands);
  const gap = Math.max(6, Math.floor(Math.min(w, h) / (count + 1)));
  const sources: number[] = [];
  for (const c of cands) {
    if (sources.length >= count) break;
    const cx = c % w;
    const cy = (c - cx) / w;
    const far = (s: number): boolean => {
      const dx = (s % w) - cx;
      const dy = Math.floor(s / w) - cy;
      return dx * dx + dy * dy >= gap * gap;
    };
    if (sources.every(far)) sources.push(c);
  }
  const visited = new Int32Array(w * h);
  sources.forEach((src, k) => {
    const stamp = k + 1;
    const path: number[] = [src];
    visited[src] = stamp;
    let ended = false;
    for (let guard = 0; guard < w * h && !ended; guard++) {
      const cur = path[path.length - 1]!;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      let best = -1;
      for (const [dx, dy] of NB4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (visited[n] === stamp) continue;
        if (best === -1 || elev[n]! < elev[best]! || (elev[n] === elev[best] && n < best)) best = n;
      }
      let added: number[];
      if (best !== -1 && elev[best]! < elev[cur]!) {
        added = [best];
      } else {
        // Local minimum: breakthrough towards the nearest lower cell, water or border.
        const parent = new Map<number, number>([[cur, -1]]);
        const queue = [cur];
        let target = -1;
        for (let q = 0; q < queue.length && target === -1; q++) {
          const c = queue[q]!;
          const x = c % w;
          const y = (c - x) / w;
          for (const [dx, dy] of NB4) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (visited[n] === stamp || parent.has(n)) continue;
            parent.set(n, c);
            queue.push(n);
            if (elev[n]! < elev[cur]! || isWater(n) || border(n)) {
              target = n;
              break;
            }
          }
        }
        if (target === -1) break;
        added = [];
        for (let c = target; c !== cur; c = parent.get(c)!) added.unshift(c);
      }
      for (const n of added) {
        visited[n] = stamp;
        path.push(n);
      }
      const last = path[path.length - 1]!;
      if (isWater(last) || border(last)) ended = true;
    }
    if (path.length < 2) return;
    result.rivers++;
    if (!ended) result.deadEnds++;
    const wide = rng.int(1, 2) === 2;
    for (const c of path) {
      mask[c] = 1;
      if (wide && (c % w) + 1 < w) mask[c + 1] = 1;
    }
  });
  return result;
}
