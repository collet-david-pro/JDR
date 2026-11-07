/**
 * World-aligned textures (P14-textures): a palette entry with a `repeat` N covers N × N cells
 * of the map; the cell at world position (x, y) shows the portion (x mod N, y mod N) of the image,
 * so a seamless texture paints a continuous floor. Rotation, mirror and variant of the cell are
 * ignored for such entries. Pure helpers shared by the engine, the export and the thumbnail.
 */

/** Largest accepted repeat (cells per side); mirrored by the server (MapInput::MAX_REPEAT). */
export const MAX_TEXTURE_REPEAT = 64;

/** Integer repeat in 1..MAX_TEXTURE_REPEAT (NaN ⇒ 1). */
export function clampRepeat(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_TEXTURE_REPEAT, Math.max(1, Math.round(value)));
}

/** Default repeat of an image: native width over the cell size, at least 1. */
export function defaultRepeat(width: number, cellPx: number): number {
  if (!(width > 0) || !(cellPx > 0)) return 1;
  return clampRepeat(width / cellPx);
}

/** Position of a world cell inside the N × N block (always 0..N-1, also for negative cells). */
export function repeatSlot(world: number, repeat: number): number {
  const n = Math.max(1, Math.trunc(repeat));
  return ((Math.trunc(world) % n) + n) % n;
}

export interface TileRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/**
 * Source rectangle (image pixels) shown by the world cell (wx, wy) for an image of
 * width × height covering `repeat` × `repeat` cells. Edges are rounded so neighbours tile
 * exactly with no gap or overlap.
 */
export function textureCellRect(
  width: number,
  height: number,
  repeat: number,
  wx: number,
  wy: number,
): TileRect {
  const n = Math.max(1, Math.trunc(repeat));
  const col = repeatSlot(wx, n);
  const row = repeatSlot(wy, n);
  const sx = Math.round((col * width) / n);
  const sy = Math.round((row * height) / n);
  return {
    sx,
    sy,
    sw: Math.max(1, Math.round(((col + 1) * width) / n) - sx),
    sh: Math.max(1, Math.round(((row + 1) * height) / n) - sy),
  };
}
