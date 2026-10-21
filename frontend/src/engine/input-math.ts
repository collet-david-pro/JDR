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

/** What a wheel event does: mouse wheel zoom, pinch / Ctrl+wheel zoom, or a pan. */
export type WheelIntent = 'zoom' | 'pinch' | 'pan' | 'pan-shift';

export interface WheelSample {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  /** ms (Event.timeStamp). */
  readonly timeStamp: number;
}

/** Events closer than this belong to the same gesture (same device). */
export const WHEEL_GESTURE_GAP_MS = 150;
/** A mouse notch scrolls at least this many pixels (Chrome/Edge 100–120, Safari ≥ 53). */
const MOUSE_NOTCH_MIN_PX = 50;

/**
 * Tells a mouse wheel from a trackpad (projet.md 15.2: two-finger scroll pans, pinch zooms):
 * - Ctrl/Cmd + wheel, which is also how browsers report a trackpad pinch ⇒ 'pinch';
 * - Shift + wheel ⇒ 'pan-shift' (vertical wheel pans horizontally);
 * - line/page deltas (deltaMode ≠ 0), or large integer vertical-only pixel deltas ⇒ mouse ⇒ 'zoom';
 * - horizontal component, fractional or small pixel deltas ⇒ trackpad ⇒ 'pan'.
 * The device is remembered for the rest of a gesture so that small inertia deltas at the end of
 * a mouse flick (or a large trackpad swipe) do not flip the behaviour.
 */
export class WheelClassifier {
  private lastAt = -Infinity;
  private device: 'mouse' | 'trackpad' = 'mouse';

  classify(e: WheelSample): WheelIntent {
    const sameGesture = e.timeStamp - this.lastAt < WHEEL_GESTURE_GAP_MS;
    this.lastAt = e.timeStamp;
    if (e.ctrlKey || e.metaKey) return 'pinch';
    const trackpadHint = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
    if (!sameGesture) {
      this.device =
        e.deltaMode !== 0
          ? 'mouse'
          : trackpadHint || Math.abs(e.deltaY) < MOUSE_NOTCH_MIN_PX
            ? 'trackpad'
            : 'mouse';
    } else if (trackpadHint) {
      this.device = 'trackpad';
    }
    if (e.shiftKey) return this.device === 'trackpad' ? 'pan' : 'pan-shift';
    return this.device === 'trackpad' ? 'pan' : 'zoom';
  }
}
