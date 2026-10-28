/** Cave shape (steps 1-4): random fill, "4-5" automaton, connection of the components, smoothing. */
import { astar } from '../graph';
import { BitGrid, bfsDistances, components, floodFill } from '../grid';
import type { Rng } from '../prng';

const NB8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
const NB4: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Floor mask (1 = floor) of a random fill: the outer cells are always rock. */
export function randomFill(w: number, h: number, fill: number, rng: Rng): BitGrid {
  const g = new BitGrid(w, h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) g.set(x, y, rng.next() < fill ? 0 : 1);
  }
  return g;
}

/** "4-5" automaton: rock when >= 5 rock neighbours (8-neighbourhood, outside = rock), or rock and >= 4. */
export function automaton(start: BitGrid, iterations: number): BitGrid {
  const { w, h } = start;
  let cur = start;
  for (let it = 0; it < iterations; it++) {
    const next = new BitGrid(w, h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let rock = 0;
        for (const [dx, dy] of NB8) if (cur.get(x + dx, y + dy) === 0) rock++;
        const isRock = cur.get(x, y) === 0;
        next.set(x, y, rock >= 5 || (isRock && rock >= 4) ? 0 : 1);
      }
    }
    cur = next;
  }
  return cur;
}

/** Size of the biggest 4-connected component of floor. */
export function mainSize(mask: BitGrid): number {
  const { sizes } = components(mask, (v) => v !== 0);
  let best = 0;
  for (const s of sizes) if (s > best) best = s;
  return best;
}

/**
 * Keeps the biggest component (first in scan order on a tie); the others are linked to it by A*
 * tunnels (rock costs more than floor) or filled in. Returns the number of tunnels.
 */
export function connectComponents(mask: BitGrid, mode: 'tunnel' | 'fill'): number {
  const { w, h } = mask;
  const { labels, sizes } = components(mask, (v) => v !== 0);
  if (sizes.length <= 1) return 0;
  let main = 0;
  for (let l = 1; l < sizes.length; l++) if (sizes[l]! > sizes[main]!) main = l;
  if (mode === 'fill') {
    for (let i = 0; i < labels.length; i++)
      if (labels[i]! >= 0 && labels[i] !== main) mask.data[i] = 0;
    return 0;
  }
  const sources: [number, number][] = [];
  for (let i = 0; i < labels.length; i++)
    if (labels[i] === main) sources.push([i % w, Math.floor(i / w)]);
  const dist = bfsDistances(mask, () => true, sources);
  const best = new Int32Array(sizes.length).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!;
    if (l < 0 || l === main) continue;
    if (best[l] === -1 || dist[i]! < dist[best[l]!]!) best[l] = i;
  }
  const inMain = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i++) if (labels[i] === main) inMain[i] = 1;
  const cost = (x: number, y: number): number =>
    x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1 ? Infinity : mask.get(x, y) !== 0 ? 1 : 4;
  let tunnels = 0;
  for (let l = 0; l < sizes.length; l++) {
    if (l === main || best[l] === -1 || inMain[best[l]!] === 1) continue;
    const sx = best[l]! % w;
    const sy = Math.floor(best[l]! / w);
    // Goal: walk down the distance field to the main component.
    let gx = sx;
    let gy = sy;
    while (dist[gy * w + gx]! > 0) {
      let moved = false;
      for (const [dx, dy] of NB4) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (dist[ny * w + nx] === dist[gy * w + gx]! - 1) {
          gx = nx;
          gy = ny;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    const path = astar(w, h, cost, [sx, sy], [gx, gy]);
    if (path === null) {
      for (const [x, y] of floodFill(mask, sx, sy, (px, py) => mask.get(px, py) !== 0))
        mask.set(x, y, 0);
      continue;
    }
    for (const [x, y] of path) mask.set(x, y, 1);
    tunnels++;
    for (const [x, y] of floodFill(mask, sx, sy, (px, py) => mask.get(px, py) !== 0))
      inMain[y * w + x] = 1;
  }
  return tunnels;
}

/**
 * Smoothing: isolated rock cells (4 floor neighbours) become floor, one-cell spikes (floor cell
 * with a single floor neighbour) become rock. Protected cells are never removed. Connectivity is
 * preserved (a spike is a leaf of the floor graph).
 */
export function smooth(mask: BitGrid, passes: number, protect: Uint8Array): void {
  const { w, h } = mask;
  if (mask.count() < 9) return;
  for (let p = 0; p < passes; p++) {
    const snap = mask.clone();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let f = 0;
        for (const [dx, dy] of NB4) if (snap.get(x + dx, y + dy) !== 0) f++;
        if (snap.get(x, y) === 0) {
          if (f === 4) mask.set(x, y, 1);
        } else if (f === 1 && protect[y * w + x] === 0) {
          mask.set(x, y, 0);
        }
      }
    }
  }
}
