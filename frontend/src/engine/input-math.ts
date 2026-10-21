/**
 * Pointer/wheel helpers (pure).
 */

import type { PointerModifiers } from '../editor/contracts';

export interface ModifierSource {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export function modifiersOf(e: ModifierSource): PointerModifiers {
  return { shift: e.shiftKey, alt: e.altKey, ctrlOrMeta: e.ctrlKey || e.metaKey };
}

/**
 * Button reported for move/leave events, from the DOM `buttons` bitmask: the held button
 * (0 primary, 1 middle, 2 secondary) or -1 when none is held.
 */
export function heldButton(buttons: number): number {
  if (buttons & 1) return 0;
  if (buttons & 4) return 1;
  if (buttons & 2) return 2;
  return -1;
}

const LINE_PX = 16;

/** Wheel delta in CSS pixels (deltaMode 0 pixel, 1 line, 2 page). */
export function wheelPixels(delta: number, deltaMode: number, pagePx: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * pagePx;
  return delta;
}

/**
 * Zoom factor of a wheel event. With Ctrl/Cmd (and trackpad pinch, which browsers report as
 * ctrl+wheel with small deltas) the zoom is more sensitive. One mouse notch (100 px) ≈ ×1.16.
 */
export function wheelZoomFactor(deltaPx: number, ctrlOrMeta: boolean): number {
  const k = ctrlOrMeta ? 0.01 : 0.0015;
  const factor = Math.exp(-deltaPx * k);
  return Math.min(2, Math.max(0.5, factor));
}

export interface PinchState {
  readonly cx: number;
  readonly cy: number;
  readonly distance: number;
}

export function pinchState(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): PinchState {
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) };
}

/** Zoom factor and pan between two pinch states (two fingers). */
export function pinchDelta(
  from: PinchState,
  to: PinchState,
): { factor: number; dx: number; dy: number } {
  const factor = from.distance > 1 && to.distance > 1 ? to.distance / from.distance : 1;
  return { factor, dx: to.cx - from.cx, dy: to.cy - from.cy };
}
