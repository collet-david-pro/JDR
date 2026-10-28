/** Outdoor terrain: elevation and moisture fields, quantile thresholds and biomes. */
import { bfsDistances } from '../grid';
import { fbm, simplex2D } from '../noise';
import type { Rng } from '../prng';
import type { OutdoorTheme } from '../themes/outdoor';
import type { OutdoorParams } from './params';

export const DEEP = 0;
export const WATER = 1;
export const BEACH = 2;
export const PLAIN = 3;
export const FOREST = 4;
export const HILL = 5;
export const MOUNTAIN = 6;
export const SNOW = 7;
export const OASIS = 8;

export interface Land {
  w: number;
  h: number;
  elev: Float64Array;
  moist: Float64Array;
  biome: Uint8Array;
  /** Elevation range (5 % to 95 % quantiles), the unit of the slopes. */
  range: number;
  /** Elevation from which a river may spring (top 10 %). */
  springL: number;
  /** Moisture range (min, max), to normalise it. */
  moistMin: number;
  moistMax: number;
}

const quantile = (sorted: Float64Array, p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;

function field(rng: Rng, w: number, h: number, s: number): Float64Array {
  const period = Math.ceil(Math.max(w, h) / s) + 1;
  const noise = simplex2D(rng, { period });
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++)
      out[y * w + x] = fbm(noise, (x + 0.5) / s, (y + 0.5) / s, { octaves: 5 });
  }
  return out;
}

/** Fields and biomes. Edges between biomes are softened by a per-cell draw (ragged borders). */
export function buildLand(p: OutdoorParams, theme: OutdoorTheme, rng: Rng): Land {
  const { width: w, height: h } = p;
  const s = 24 * p.scale;
  const elev = field(rng.fork('elev'), w, h, s);
  const moist = field(rng.fork('moist'), w, h, s);
  const se = Float64Array.from(elev).sort();
  const sm = Float64Array.from(moist).sort();
  const range = Math.max(1e-6, quantile(se, 0.95) - quantile(se, 0.05));
  const soft = range * 0.05;
  const waterFrac = p.water * theme.water_factor;
  const wet = waterFrac > 0;
  const waterL = wet ? quantile(se, waterFrac) : -Infinity;
  const deepL = wet ? quantile(se, waterFrac * 0.4) : -Infinity;
  const beachL = wet ? quantile(se, Math.min(1, waterFrac + 0.05)) : -Infinity;
  const hillL = quantile(se, 0.72);
  const mountL = quantile(se, 0.88);
  const snowL = theme.snow_peaks ? quantile(se, 0.96) : Infinity;
  const forestL = p.forest > 0 ? quantile(sm, 1 - p.forest * 0.7) : Infinity;
  const jitter = rng.fork('edges');
  const biome = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const e = elev[i]! + (jitter.next() - 0.5) * soft;
    const m = moist[i]! + (jitter.next() - 0.5) * soft;
    let b: number;
    if (e < waterL) b = e < deepL ? DEEP : WATER;
    else if (e < beachL) b = BEACH;
    else if (e >= snowL) b = SNOW;
    else if (e >= mountL) b = MOUNTAIN;
    else if (e >= hillL) b = HILL;
    else if (m >= forestL) b = FOREST;
    else b = PLAIN;
    biome[i] = b;
  }
  if (theme.oasis_only) {
    // Green and trees only around the water.
    const sources: [number, number][] = [];
    for (let i = 0; i < w * h; i++)
      if (biome[i]! <= WATER) sources.push([i % w, Math.floor(i / w)]);
    const dist = bfsDistances({ w, h }, () => true, sources);
    for (let i = 0; i < w * h; i++) {
      const b = biome[i]!;
      if (b !== PLAIN && b !== FOREST) continue;
      const d = dist[i]!;
      if (b === FOREST && d >= 0 && d <= 4) continue;
      biome[i] = d >= 0 && d <= 2 ? OASIS : PLAIN;
    }
  }
  return {
    w,
    h,
    elev,
    moist,
    biome,
    range,
    springL: quantile(se, 0.9),
    moistMin: sm[0]!,
    moistMax: sm[sm.length - 1]!,
  };
}
