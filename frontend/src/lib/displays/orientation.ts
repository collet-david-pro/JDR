/**
 * Rotation and mirror of a projection screen (D8): a CSS transform of a container. At 90 and
 * 270 degrees the container is as wide as the window is high (and the reverse): after the
 * rotation it fills the window.
 *
 * The container is `position: fixed; left: 50%; top: 50%` with the returned `width` / `height`
 * and `transform` (its own centre is put on the centre of the window, then the mirror is applied
 * on the screen, after the rotation).
 */
import type { Rotation } from './types';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface OrientationSettings {
  readonly rotation: Rotation;
  readonly mirror: boolean;
}

export interface Orientation {
  /** CSS transform of the container. */
  readonly transform: string;
  /** Size of the render area, CSS px (what the engine sees, rotation applied). */
  readonly width: number;
  readonly height: number;
}

export function orientation(viewport: Viewport, settings: OrientationSettings): Orientation {
  const swapped = settings.rotation === 90 || settings.rotation === 270;
  const parts = ['translate(-50%, -50%)'];
  if (settings.mirror) parts.push('scaleX(-1)');
  if (settings.rotation !== 0) parts.push(`rotate(${settings.rotation}deg)`);
  return {
    transform: parts.join(' '),
    width: swapped ? viewport.height : viewport.width,
    height: swapped ? viewport.width : viewport.height,
  };
}
