/**
 * Light sources of the scene (pure): light objects (following a token when asked) and token
 * lights (definition light or light_override), their flickering level, animation need, the
 * radial profile used by the lightmap and the lights casting shadows. projet.md 14.2.
 *
 * Profile (P3 convention, etapes/P05-vision.md): full intensity up to `radius`, linear fade
 * to 0 at `dim_radius`.
 */

import type {
  LightCone,
  LightFlicker,
  MapObject,
  PlacedToken,
  TokenDefView,
  TokenLightDef,
  ViewMode,
} from '../../editor/contracts';
import { NO_FLICKER, TOKEN_FLICKER, flickerFactor, hashSeed } from '../../vision/flicker';
import { lightPosition, parseColor } from './object-geometry';
import { lightIncluded, tokenShown } from './view-rules';

export interface LightSource {
  /** Object uid, or `token:<uid>` for a token light. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Bright radius (cells). */
  readonly radius: number;
  /** Outer radius (cells), ≥ radius, > 0. */
  readonly dim: number;
  readonly color: number;
  /** 0–1 */
  readonly intensity: number;
  readonly flicker: LightFlicker;
  readonly cone: LightCone | null;
  readonly seed: number;
}

export const TOKEN_LIGHT_PREFIX = 'token:';

function tokenLight(token: PlacedToken, def: TokenDefView | null): TokenLightDef | null {
  return token.light_override ?? def?.light ?? null;
}

/** Lights of the view, light objects first (scene order), then token lights. */
export function collectLights(
  objects: readonly MapObject[],
  tokens: readonly PlacedToken[],
  token: (uid: string) => PlacedToken | undefined,
  tokenDef: (id: string) => TokenDefView | null,
  mode: ViewMode,
): LightSource[] {
  const out: LightSource[] = [];
  for (const obj of objects) {
    if (obj.type !== 'light' || !lightIncluded(obj, mode)) continue;
    const p = obj.props;
    const [x, y] = lightPosition(obj, token);
    out.push({
      id: obj.uid,
      x,
      y,
      radius: Math.min(p.radius, p.dim_radius),
      dim: p.dim_radius,
      color: parseColor(p.color) ?? 0xffffff,
      intensity: clamp01(p.intensity),
      flicker: p.flicker,
      cone: p.cone,
      seed: hashSeed(obj.uid),
    });
  }
  for (const t of tokens) {
    if (!tokenShown(t, mode)) continue;
    const light = tokenLight(t, tokenDef(t.token_id));
    if (light === null || !(light.dim_radius > 0) || !(light.intensity > 0)) continue;
    out.push({
      id: TOKEN_LIGHT_PREFIX + t.uid,
      x: t.x,
      y: t.y,
      radius: Math.min(light.radius, light.dim_radius),
      dim: light.dim_radius,
      color: parseColor(light.color) ?? 0xffffff,
      intensity: clamp01(light.intensity),
      flicker: light.flicker ? TOKEN_FLICKER : NO_FLICKER,
      cone: null,
      seed: hashSeed(t.uid),
    });
  }
  return out;
}

export function isFlickering(light: LightSource): boolean {
  return light.flicker.type !== 'none' && light.flicker.amp > 0;
}

/** Mean of flickerFactor (frozen animations, performance mode). */
export function meanFlicker(flicker: LightFlicker): number {
  if (flicker.type === 'none' || !(flicker.amp > 0)) return 1;
  return 1 - Math.min(1, flicker.amp) * 0.5;
}

/** Light level (intensity × flicker) at time `ms`; `frozen` uses the mean flicker. */
export function lightLevel(light: LightSource, ms: number, frozen: boolean): number {
  const f = frozen ? meanFlicker(light.flicker) : flickerFactor(light.flicker, light.seed, ms);
  return light.intensity * f;
}

/** 0xRRGGBB colour scaled by a level (additive contribution of the light). */
export function scaledColor(color: number, level: number): number {
  const k = clamp01(level);
  const r = Math.round(((color >> 16) & 255) * k);
  const g = Math.round(((color >> 8) & 255) * k);
  const b = Math.round((color & 255) * k);
  return (r << 16) | (g << 8) | b;
}

export interface WorldRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function circleIntersectsRect(x: number, y: number, r: number, rect: WorldRect): boolean {
  const cx = Math.min(Math.max(x, rect.x0), rect.x1);
  const cy = Math.min(Math.max(y, rect.y0), rect.y1);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** Lights whose outer circle touches the rectangle. */
export function lightsInRect(lights: readonly LightSource[], rect: WorldRect): LightSource[] {
  return lights.filter((l) => circleIntersectsRect(l.x, l.y, l.dim, rect));
}

/**
 * Continuous animation is needed only for flickering lights in view, with lighting on and
 * animations not frozen (performance mode / reduced motion).
 */
export function needsFlickerFrames(
  lights: readonly LightSource[],
  rect: WorldRect,
  options: { readonly lighting: boolean; readonly frozen: boolean },
): boolean {
  if (!options.lighting || options.frozen) return false;
  return lights.some((l) => isFlickering(l) && circleIntersectsRect(l.x, l.y, l.dim, rect));
}

/**
 * The `count` lights nearest to a point (distance to their outer circle, then to the centre):
 * the shadow casters (14.2: the 8 lights nearest to the screen).
 */
export function nearestLights(
  lights: readonly LightSource[],
  x: number,
  y: number,
  count: number,
): LightSource[] {
  if (count <= 0) return [];
  return lights
    .map((l) => {
      const d = Math.hypot(l.x - x, l.y - y);
      return { l, edge: Math.max(0, d - l.dim), d };
    })
    .sort((a, b) => a.edge - b.edge || a.d - b.d || (a.l.id < b.l.id ? -1 : 1))
    .slice(0, count)
    .map((e) => e.l);
}

/** Radial profiles are pre-rendered for these many radius/dim ratios (+1). */
export const PROFILE_STEPS = 16;

/** Index of the pre-rendered profile closest to radius / dim. */
export function profileIndex(radius: number, dim: number): number {
  if (!(dim > 0)) return 0;
  return Math.round(clamp01(radius / dim) * PROFILE_STEPS);
}

/** Profile value at distance ratio t = distance / dim (1 inside the bright radius). */
export function profileValue(ratio: number, t: number): number {
  if (t >= 1) return 0;
  if (t <= ratio) return 1;
  return (1 - t) / (1 - ratio);
}

/**
 * Triangle fan of a star-shaped polygon around (cx, cy): positions (world px), uvs (on the
 * square texture spanning the outer circle) and indices.
 */
export function fanGeometry(
  polygon: Float32Array,
  cx: number,
  cy: number,
  dim: number,
  cellPx: number,
): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } | null {
  const n = Math.floor(polygon.length / 2);
  if (n < 3 || !(dim > 0)) return null;
  const positions = new Float32Array((n + 1) * 2);
  const uvs = new Float32Array((n + 1) * 2);
  positions[0] = cx * cellPx;
  positions[1] = cy * cellPx;
  uvs[0] = 0.5;
  uvs[1] = 0.5;
  const k = 1 / (2 * dim);
  for (let i = 0; i < n; i++) {
    const x = polygon[i * 2]!;
    const y = polygon[i * 2 + 1]!;
    positions[(i + 1) * 2] = x * cellPx;
    positions[(i + 1) * 2 + 1] = y * cellPx;
    uvs[(i + 1) * 2] = 0.5 + (x - cx) * k;
    uvs[(i + 1) * 2 + 1] = 0.5 + (y - cy) * k;
  }
  const indices = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    indices[i * 3] = 0;
    indices[i * 3 + 1] = i + 1;
    indices[i * 3 + 2] = ((i + 1) % n) + 1;
  }
  return { positions, uvs, indices };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
