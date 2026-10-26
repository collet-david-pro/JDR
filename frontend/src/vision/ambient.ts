/**
 * Ambient light (projet.md 14.2): effective darkness and tint, day/night curve, 2 s transition.
 * Pure functions shared by the engine and the PNG export.
 *
 * Scene colour = base × ((1 − darkness) + lightmap), then multiplied by the tint colour
 * blended with white: tintFactor = 1 − (1 − tint) × TINT_STRENGTH × darkness. A tint of
 * "#000000" means "no tint" (server default) and is treated as white.
 */
import type { Ambient } from '../editor/contracts';

export interface EffectiveAmbient {
  /** 0–1 */
  readonly darkness: number;
  /** RGB 0–1, already blended with white (multiply the scene by it). */
  readonly tint: readonly [number, number, number];
}

/** How strongly a tint colours the darkness (0 = never, 1 = fully at darkness 1). */
export const TINT_STRENGTH = 0.6;
/** Duration of the transition when the GM changes time_of_day or darkness. */
export const AMBIENT_TRANSITION_MS = 2000;

/** Key frames of the day/night curve: [hour, darkness, tint]. Linear between frames, cyclic. */
export const DAY_CURVE: readonly (readonly [number, number, string])[] = [
  [0, 0.9, '#1a2244'],
  [4.5, 0.85, '#1a2244'],
  [6, 0.45, '#ff9a5c'],
  [7.5, 0.1, '#ffd9a8'],
  [12, 0, '#000000'],
  [17, 0.1, '#ffd9a8'],
  [19, 0.45, '#ff7a4c'],
  [20.5, 0.8, '#1a2244'],
  [24, 0.9, '#1a2244'],
];

export function parseHex(color: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (m === null) return [0, 0, 0];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function isNoTint(rgb: readonly number[]): boolean {
  return rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0;
}

/** Darkness and raw tint (RGB 0–1, black = none) at an hour of the day. */
export function dayCurve(hour: number): { darkness: number; tint: [number, number, number] } {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < DAY_CURVE.length; i++) {
    const [h1, d1, t1] = DAY_CURVE[i]!;
    if (h > h1) continue;
    const [h0, d0, t0] = DAY_CURVE[i - 1]!;
    const k = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
    const a = parseHex(t0);
    const b = parseHex(t1);
    // "No tint" frames fade through white, not black.
    const ca = isNoTint(a) ? [1, 1, 1] : a;
    const cb = isNoTint(b) ? [1, 1, 1] : b;
    const tint: [number, number, number] = [
      ca[0]! + (cb[0]! - ca[0]!) * k,
      ca[1]! + (cb[1]! - ca[1]!) * k,
      ca[2]! + (cb[2]! - ca[2]!) * k,
    ];
    return { darkness: d0 + (d1 - d0) * k, tint };
  }
  return { darkness: DAY_CURVE[0]![1], tint: parseHex(DAY_CURVE[0]![2]) };
}

/** Effective ambient of a map (time_of_day overrides darkness and tint). */
export function ambientAt(ambient: Ambient): EffectiveAmbient {
  let darkness: number;
  let raw: readonly number[];
  if (ambient.time_of_day !== null) {
    const c = dayCurve(ambient.time_of_day);
    darkness = c.darkness;
    raw = c.tint;
  } else {
    darkness = clamp01(ambient.darkness);
    const t = parseHex(ambient.tint);
    raw = isNoTint(t) ? [1, 1, 1] : t;
  }
  const s = TINT_STRENGTH * darkness;
  return {
    darkness,
    tint: [1 - (1 - raw[0]!) * s, 1 - (1 - raw[1]!) * s, 1 - (1 - raw[2]!) * s],
  };
}

/** Interpolates two effective ambients (k = 0 → a, 1 → b), smoothstep eased. */
export function mixAmbient(a: EffectiveAmbient, b: EffectiveAmbient, k: number): EffectiveAmbient {
  const t = clamp01(k);
  const e = t * t * (3 - 2 * t);
  return {
    darkness: a.darkness + (b.darkness - a.darkness) * e,
    tint: [
      a.tint[0] + (b.tint[0] - a.tint[0]) * e,
      a.tint[1] + (b.tint[1] - a.tint[1]) * e,
      a.tint[2] + (b.tint[2] - a.tint[2]) * e,
    ],
  };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
