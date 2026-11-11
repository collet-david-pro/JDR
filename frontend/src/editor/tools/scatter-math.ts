/**
 * Pure maths of the object brush: draws positions, rotations and scales of scattered objects along
 * a stroke from an injectable seeded generator. No document access.
 */
import type { Point } from './raster';
import type { Rng } from '../util/rng';

export interface ScatterOptions {
  /** Objects per square cell of brush area (0.05 – 4). */
  readonly density: number;
  /** Minimal distance between two objects of the stroke, in cells (0 = none). */
  readonly spacing: number;
  /** Brush radius in cells. */
  readonly radius: number;
  readonly randomRotation: boolean;
  /** Random scale variation: factor in [1 - v, 1 + v] (0 = off). */
  readonly scaleVariation: number;
}

export const SCATTER_DENSITY_MIN = 0.05;
export const SCATTER_DENSITY_MAX = 4;
export const SCATTER_RADIUS_MIN = 0.5;
export const SCATTER_RADIUS_MAX = 16;
export const SCATTER_SPACING_MAX = 8;
export const SCATTER_SCALE_VAR_MAX = 0.6;
/** Safety cap on the objects created by one stroke. */
export const SCATTER_STROKE_MAX = 500;
/** Distance between two sampling points along the stroke, in cells. */
export const SCATTER_STEP = 0.25;

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Options clamped to their valid ranges. */
export function normalizeScatter(o: ScatterOptions): ScatterOptions {
  return {
    density: clamp(o.density, SCATTER_DENSITY_MIN, SCATTER_DENSITY_MAX),
    spacing: clamp(o.spacing, 0, SCATTER_SPACING_MAX),
    radius: clamp(o.radius, SCATTER_RADIUS_MIN, SCATTER_RADIUS_MAX),
    randomRotation: o.randomRotation,
    scaleVariation: clamp(o.scaleVariation, 0, SCATTER_SCALE_VAR_MAX),
  };
}

export interface ScatterItem {
  readonly x: number;
  readonly y: number;
  /** Degrees, [0, 360). */
  readonly rotation: number;
  /** Size factor (1 = native size). */
  readonly scale: number;
  /** Index drawn in the asset list (when `assetCount` > 0). */
  readonly asset: number;
}

/**
 * Items scattered along the segment `from` → `to` (world coordinates, cells). `placed` holds the
 * positions already used by the stroke (minimal spacing); the new positions are appended to it.
 * `budget` is the number of items still allowed.
 */
export function scatterAlong(
  from: Point,
  to: Point,
  options: ScatterOptions,
  placed: Point[],
  rng: Rng,
  assetCount: number,
  budget: number = SCATTER_STROKE_MAX,
  bounds?: { readonly width: number; readonly height: number },
): ScatterItem[] {
  const o = normalizeScatter(options);
  const out: ScatterItem[] = [];
  if (assetCount <= 0 || budget <= 0) return out;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(len / SCATTER_STEP));
  const stepLen = len === 0 ? SCATTER_STEP : len / steps;
  // Expected number of items per sample: density × swept area (step length × brush diameter).
  const perSample = o.density * stepLen * 2 * o.radius;
  const first = len === 0 ? 0 : 1;
  for (let i = first; i <= steps; i++) {
    if (len === 0 && i > 0) break;
    const t = len === 0 ? 0 : i / steps;
    const cx = from[0] + (to[0] - from[0]) * t;
    const cy = from[1] + (to[1] - from[1]) * t;
    let n = Math.floor(perSample);
    if (rng.next() < perSample - n) n += 1;
    for (let k = 0; k < n; k++) {
      if (out.length >= budget) return out;
      // Uniform point in the disc.
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * o.radius;
      const x = r3(cx + Math.cos(a) * d);
      const y = r3(cy + Math.sin(a) * d);
      if (bounds !== undefined && (x < 0 || y < 0 || x > bounds.width || y > bounds.height)) {
        continue;
      }
      if (o.spacing > 0 && placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < o.spacing)) continue;
      const rotation = o.randomRotation ? r3(rng.next() * 360) % 360 : 0;
      const scale =
        o.scaleVariation > 0 ? r3(1 - o.scaleVariation + rng.next() * 2 * o.scaleVariation) : 1;
      const asset = assetCount > 1 ? rng.int(assetCount) : 0;
      placed.push([x, y]);
      out.push({ x, y, rotation, scale, asset });
    }
  }
  return out;
}
