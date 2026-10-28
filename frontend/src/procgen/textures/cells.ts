/** Periodic noise helpers shared by the materials. Integer lattice sizes keep the tiling seamless. */
import { fbm, simplex2D } from '../noise';
import type { Rng } from '../prng';

export type Field = (x: number, y: number) => number;

/** Pixel-space fbm in [-1, 1], periodic over `size` pixels with `cells` lattice cells. */
export function field(rng: Rng, label: string, size: number, cells: number, octaves = 4): Field {
  const n = simplex2D(rng.fork(label), { period: cells });
  const k = cells / size;
  return (x, y) => fbm(n, x * k, y * k, { octaves });
}

/** Same, stretched: `cx` cells across the tile horizontally, `cy` vertically (both integers). */
export function stretched(
  rng: Rng,
  label: string,
  size: number,
  cx: number,
  cy: number,
  octaves = 3,
): Field {
  const n = simplex2D(rng.fork(label), { period: cx });
  const kx = cx / size;
  const ky = cy / size;
  return (x, y) => fbm(n, x * kx, y * ky, { octaves });
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
/** Triangle wave in [0, 1], period 1. */
export const tri = (v: number): number => {
  const f = v - Math.floor(v);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

export interface VoronoiHit {
  /** Distance to the nearest / second nearest point, in cells. */
  f1: number;
  f2: number;
  /** Random value in [0, 1) tied to the nearest cell. */
  id: number;
}

/** Periodic Voronoi: `n` x `n` cells over the tile, one jittered point per cell. */
export function voronoi(rng: Rng, size: number, n: number): (x: number, y: number) => VoronoiHit {
  const r = rng.fork('voronoi');
  const px = new Float64Array(n * n);
  const py = new Float64Array(n * n);
  const pid = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    px[i] = r.float(0.15, 0.85);
    py[i] = r.float(0.15, 0.85);
    pid[i] = r.next();
  }
  const k = n / size;
  const hit: VoronoiHit = { f1: 9, f2: 9, id: 0 };
  return (x, y) => {
    const u = x * k;
    const v = y * k;
    const cx = Math.floor(u);
    const cy = Math.floor(v);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        const i = (((gy % n) + n) % n) * n + (((gx % n) + n) % n);
        const ex = gx + px[i]! - u;
        const ey = gy + py[i]! - v;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = pid[i]!;
        } else if (d < f2) f2 = d;
      }
    }
    hit.f1 = f1;
    hit.f2 = f2;
    hit.id = id;
    return hit;
  };
}
