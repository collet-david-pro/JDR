/**
 * 2D noises in pure JS (no trigonometry). Both are exactly periodic: f(x + P, y) === f(x, y)
 * and f(x, y + P) === f(x, y) (for x, y whose sum with P is exact in floating point).
 * Lattice tables are shuffled by an Rng.
 */
import type { Rng } from './prng';

export type NoiseFn = (x: number, y: number) => number;
export interface NoiseOptions {
  /** Lattice period (integer >= 1, default 256). */
  period?: number;
}

function makePerm(rng: Rng, p: number): Int32Array {
  const perm = new Int32Array(p);
  for (let i = 0; i < p; i++) perm[i] = i;
  for (let i = p - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  return perm;
}

function periodOf(o: NoiseOptions | undefined): number {
  const p = o?.period ?? 256;
  if (!Number.isInteger(p) || p < 1) throw new RangeError('noise period must be an integer >= 1');
  return p;
}

const wrap = (i: number, p: number): number => ((i % p) + p) % p;

/** Value noise, smooth (quintic fade), output in [-1, 1]. */
export function valueNoise2D(rng: Rng, opts?: NoiseOptions): NoiseFn {
  const P = periodOf(opts);
  const perm = makePerm(rng, P);
  const vals = new Float64Array(P);
  for (let i = 0; i < P; i++) vals[i] = rng.float(-1, 1);
  const at = (ix: number, iy: number): number =>
    vals[perm[(perm[wrap(ix, P)]! + wrap(iy, P)) % P]!]!;
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const u = fade(x - x0);
    const v = fade(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    const top = a + (b - a) * u;
    const bottom = c + (d - c) * u;
    return top + (bottom - top) * v;
  };
}

const GRAD: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0, 1],
  [0, -1],
];
const G2 = 0.21132486540518713; // (3 - sqrt(3)) / 6

/**
 * Simplex noise on the sheared lattice: the input (x, y) is taken directly in skewed
 * coordinates (the Kuhn triangulation of the unit squares), so the period is exactly P along
 * both axes. The pattern is slightly sheared compared with the isotropic version.
 * Output in [-1, 1].
 */
export function simplex2D(rng: Rng, opts?: NoiseOptions): NoiseFn {
  const P = periodOf(opts);
  const perm = makePerm(rng, P);
  const gi = new Uint8Array(P);
  for (let i = 0; i < P; i++) gi[i] = rng.int(0, 11);
  const grad = (ix: number, iy: number): readonly [number, number] =>
    GRAD[gi[(perm[wrap(ix, P)]! + wrap(iy, P)) % P]!]!;
  const corner = (ix: number, iy: number, dx: number, dy: number): number => {
    let t = 0.5 - dx * dx - dy * dy;
    if (t <= 0) return 0;
    t *= t;
    const g = grad(ix, iy);
    return t * t * (g[0] * dx + g[1] * dy);
  };
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fu = x - i;
    const fv = y - j;
    const t0 = (fu + fv) * G2;
    const x0 = fu - t0;
    const y0 = fv - t0;
    const i1 = fu > fv ? 1 : 0;
    const j1 = 1 - i1;
    const n =
      corner(i, j, x0, y0) +
      corner(i + i1, j + j1, x0 - i1 + G2, y0 - j1 + G2) +
      corner(i + 1, j + 1, x0 - 1 + 2 * G2, y0 - 1 + 2 * G2);
    return Math.max(-1, Math.min(1, 70 * n));
  };
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
}

/** Fractal sum of a noise, normalised by the total amplitude: output stays in [-1, 1]. */
export function fbm(noise: NoiseFn, x: number, y: number, opts: FbmOptions = {}): number {
  const octaves = opts.octaves ?? 5;
  const lacunarity = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  let sum = 0;
  let amp = 1;
  let total = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    total += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return total > 0 ? sum / total : 0;
}
