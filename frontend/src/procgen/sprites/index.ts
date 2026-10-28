/** Placeholder decor sprites (D3): top-down pictograms drawn by our own code, no third-party image. */
import { Canvas } from './raster';
import { DRAWERS } from './draw';

export const SPRITE_KEYS: readonly string[] = Object.freeze(
  Object.keys(DRAWERS).map((k) => 'decor.' + k),
);

/** RGBA, transparent background. Throws on an unknown key. */
export function renderSprite(key: string, size = 256): Uint8ClampedArray {
  const draw = key.startsWith('decor.') ? DRAWERS[key.slice(6)] : undefined;
  if (!draw) throw new Error('Unknown sprite key: ' + key);
  if (!Number.isInteger(size) || size < 16 || size > 2048) throw new RangeError('Bad sprite size');
  const c = new Canvas(size);
  draw(c);
  return c.data;
}
