/** Regions of a cave: Poisson-disk seeds on the floor, each floor cell attached to the nearest seed. */
import { poissonDisk } from '../poisson';
import type { BitGrid } from '../grid';
import type { PopulateRegion } from '../populate';
import type { Rng } from '../prng';

const NB4: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function caveRegions(
  floor: BitGrid,
  kinds: readonly { kind: string; weight: number }[],
  rng: Rng,
): { regions: PopulateRegion[]; regionOf: Int32Array } {
  const { w, h } = floor;
  const seeds: number[] = [];
  for (const [px, py] of poissonDisk(rng.fork('seeds'), w, h, () => 6, { mask: floor })) {
    const i = Math.floor(py) * w + Math.floor(px);
    if (floor.data[i] !== 0 && !seeds.includes(i)) seeds.push(i);
  }
  if (seeds.length === 0) {
    const i = floor.data.indexOf(1);
    if (i >= 0) seeds.push(i);
  }
  const regionOf = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  seeds.forEach((i, r) => {
    regionOf[i] = r;
    queue.push(i);
  });
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]!;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [dx, dy] of NB4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (floor.data[ni] === 0 || regionOf[ni] !== -1) continue;
      regionOf[ni] = regionOf[c]!;
      queue.push(ni);
    }
  }
  const rk = rng.fork('kinds');
  const regions: PopulateRegion[] = seeds.map((_, id) => ({
    id,
    kind: rk.weighted(kinds, (k) => k.weight).kind,
    cells: [],
  }));
  const cells = regions.map((): [number, number][] => []);
  for (let i = 0; i < regionOf.length; i++) {
    if (regionOf[i]! >= 0) cells[regionOf[i]!]!.push([i % w, Math.floor(i / w)]);
  }
  return { regions: regions.map((r, id) => ({ ...r, cells: cells[id]! })), regionOf };
}
