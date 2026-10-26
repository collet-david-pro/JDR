/**
 * Displayed ambient (pure): 2 s animated transition when the map ambient changes
 * (AMBIENT_TRANSITION_MS, vision/ambient.ts), GM scaling of the darkness so the map stays
 * editable (GM_DARKNESS_SCALE), nothing when lighting is off.
 */

import type { Ambient, ViewMode } from '../../editor/contracts';
import { GM_DARKNESS_SCALE } from '../../scene/style';
import {
  AMBIENT_TRANSITION_MS,
  ambientAt,
  mixAmbient,
  type EffectiveAmbient,
} from '../../vision/ambient';

export const NEUTRAL_AMBIENT: EffectiveAmbient = Object.freeze({
  darkness: 0,
  tint: Object.freeze([1, 1, 1]) as readonly [number, number, number],
});

function sameAmbient(a: EffectiveAmbient, b: EffectiveAmbient): boolean {
  return (
    a.darkness === b.darkness &&
    a.tint[0] === b.tint[0] &&
    a.tint[1] === b.tint[1] &&
    a.tint[2] === b.tint[2]
  );
}

export class AmbientAnimator {
  private from: EffectiveAmbient = NEUTRAL_AMBIENT;
  private to: EffectiveAmbient = NEUTRAL_AMBIENT;
  private start = -Infinity;

  constructor(private readonly durationMs = AMBIENT_TRANSITION_MS) {}

  /** Map ambient target. `animate` false (first scene, reduced motion) jumps to it. */
  set(ambient: Ambient, now: number, animate: boolean): void {
    const target = ambientAt(ambient);
    if (sameAmbient(target, this.to)) return;
    this.from = animate ? this.at(now) : target;
    this.to = target;
    this.start = animate ? now : -Infinity;
  }

  /** Effective ambient of the map at time `now` (before the view adjustments). */
  at(now: number): EffectiveAmbient {
    if (!this.active(now)) return this.to;
    return mixAmbient(this.from, this.to, (now - this.start) / this.durationMs);
  }

  /** Target (end of the transition): used for the visibility rule. */
  get target(): EffectiveAmbient {
    return this.to;
  }

  active(now: number): boolean {
    return now - this.start < this.durationMs;
  }
}

/** Ambient actually applied by the renderer in a view. */
export function viewAmbient(
  ambient: EffectiveAmbient,
  mode: ViewMode,
  lighting: boolean,
): EffectiveAmbient {
  if (!lighting) return NEUTRAL_AMBIENT;
  if (mode !== 'gm') return ambient;
  const s = GM_DARKNESS_SCALE;
  return {
    darkness: ambient.darkness * s,
    tint: [
      1 - (1 - ambient.tint[0]) * s,
      1 - (1 - ambient.tint[1]) * s,
      1 - (1 - ambient.tint[2]) * s,
    ],
  };
}

/** True when the ambient changes nothing (no darkness, white tint). */
export function isNeutral(a: EffectiveAmbient): boolean {
  return a.darkness <= 1e-4 && a.tint.every((c) => c >= 0.9999);
}

/** RGB 0–1 ⇒ 0xRRGGBB. */
export function rgbToHex(rgb: readonly [number, number, number]): number {
  const c = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2]);
}
