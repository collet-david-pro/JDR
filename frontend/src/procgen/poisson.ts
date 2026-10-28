/** Variable-density Poisson-disk sampling (Bridson, no trigonometry). */
import { BitGrid } from './grid';
import type { Rng } from './prng';
import { round3 } from './geometry';

export interface PoissonOptions {
  /** Candidates per active point (default 20). */
  k?: number;
  maxPoints?: number;
  /** Only points whose cell (floor x, floor y) is allowed. */
  mask?: BitGrid | ((x: number, y: number) => boolean);
}

/**
 * Points in [0, w) x [0, h), pairwise at least max(r(p), r(q)) apart, where r = minDist(x, y)
 * (> 0). Candidates are drawn in the square [-2r, 2r]^2 and kept when their distance to the
 * parent is in [r, 2r] (squared comparison). Coordinates are rounded to 3 decimals.
 */
export function poissonDisk(
  rng: Rng,
  w: number,
  h: number,
  minDist: (x: number, y: number) => number,
  opts: PoissonOptions = {},
): [number, number][] {
  const k = opts.k ?? 20;
  const maxPoints = opts.maxPoints ?? Infinity;
  const m = opts.mask;
  const allowed = (x: number, y: number): boolean => {
    if (m === undefined) return true;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    return m instanceof BitGrid ? m.get(cx, cy) !== 0 : m(cx, cy);
  };
  // Radius range, sampled on cell centres (positive values only).
  let rmin = Infinity;
  let rmax = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = minDist(x + 0.5, y + 0.5);
      if (r > 0 && r < rmin) rmin = r;
      if (r > rmax) rmax = r;
    }
  }
  if (!(rmax > 0) || maxPoints <= 0) return [];
  const cell = rmin / Math.sqrt(2);
  const gw = Math.ceil(w / cell) + 1;
  const gh = Math.ceil(h / cell) + 1;
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: [number, number][] = [];
  const radii: number[] = [];
  const active: number[] = [];
  const reach = Math.ceil(rmax / cell) + 1;

  const fits = (x: number, y: number, r: number): boolean => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let j = Math.max(0, gy - reach); j <= Math.min(gh - 1, gy + reach); j++) {
      for (let i = Math.max(0, gx - reach); i <= Math.min(gw - 1, gx + reach); i++) {
        const q = grid[j * gw + i]!;
        if (q < 0) continue;
        const d = Math.max(r, radii[q]!);
        const dx = pts[q]![0] - x;
        const dy = pts[q]![1] - y;
        if (dx * dx + dy * dy < d * d) return false;
      }
    }
    return true;
  };
  const add = (x: number, y: number, r: number): void => {
    pts.push([x, y]);
    radii.push(r);
    grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = pts.length - 1;
    active.push(pts.length - 1);
  };

  for (let t = 0; t < 200 && pts.length === 0; t++) {
    const x = round3(rng.float(0, w));
    const y = round3(rng.float(0, h));
    if (x >= w || y >= h || !allowed(x, y)) continue;
    const r = minDist(x, y);
    if (r > 0) add(x, y, r);
  }
  while (active.length > 0 && pts.length < maxPoints) {
    const ai = rng.int(0, active.length - 1);
    const [px, py] = pts[active[ai]!]!;
    const r = radii[active[ai]!]!;
    let found = false;
    for (let t = 0; t < k; t++) {
      const x = round3(px + rng.float(-2 * r, 2 * r));
      const y = round3(py + rng.float(-2 * r, 2 * r));
      const dx = x - px;
      const dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r || d2 > 4 * r * r) continue;
      if (x < 0 || y < 0 || x >= w || y >= h || !allowed(x, y)) continue;
      const rc = minDist(x, y);
      if (!(rc > 0) || !fits(x, y, rc)) continue;
      add(x, y, rc);
      found = true;
      break;
    }
    if (!found) {
      active[ai] = active[active.length - 1]!;
      active.pop();
    }
  }
  return pts;
}
