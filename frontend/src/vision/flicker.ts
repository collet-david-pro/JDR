/**
 * Deterministic light flicker (projet.md 14.2): smoothed 1D value noise seeded by the object uid.
 * Same uid and time ⇒ same factor on every client (and none in the PNG export: mean intensity).
 */
import type { LightFlicker } from '../editor/contracts';

/** 32-bit FNV-1a hash of a string. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pseudo-random value in [0, 1) of an integer lattice point. */
function lattice(seed: number, i: number): number {
  let h = Math.imul(seed ^ Math.imul(i, 0x27d4eb2d), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Smoothed value noise in [0, 1). */
export function valueNoise(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  const a = lattice(seed, i);
  const b = lattice(seed, i + 1);
  return a + (b - a) * s;
}

/** Intensity multiplier in [1 − amp, 1] at time `ms` (1 when type 'none' or amp 0). */
export function flickerFactor(flicker: LightFlicker, seed: number, ms: number): number {
  const amp = Math.min(1, Math.max(0, flicker.amp));
  if (flicker.type === 'none' || amp === 0) return 1;
  const speed = Math.min(10, Math.max(0.1, flicker.speed));
  const t = (ms / 1000) * speed;
  let v: number;
  if (flicker.type === 'pulse') {
    // Slow breathing: smooth triangle wave with a little noise.
    const phase = (t + lattice(seed, 0)) % 1;
    v = 0.85 * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)) + 0.15 * valueNoise(seed, t * 3);
  } else {
    // Torch: two octaves of value noise.
    v = 0.65 * valueNoise(seed, t * 4) + 0.35 * valueNoise(seed ^ 0x9e3779b9, t * 11);
  }
  return 1 - amp * v;
}

/** Flicker of a token light (P3 boolean flag). */
export const TOKEN_FLICKER: LightFlicker = Object.freeze({ type: 'torch', amp: 0.15, speed: 1 });
export const NO_FLICKER: LightFlicker = Object.freeze({ type: 'none', amp: 0, speed: 1 });
