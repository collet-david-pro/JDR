/**
 * Cell value ⇒ sprite placement (pure). projet.md 12.2 flags: bits 0-1 rotation ×90°
 * (clockwise, Y down), bit 2 mirror H, bit 3 mirror V. Mirrors are applied to the image
 * first, then the rotation.
 *
 * Variants (proposal, see the P4a report): an image whose width is an exact multiple N ≥ 2
 * of its height is a horizontal strip of N square frames; variant v shows frame v mod N.
 * Any other image ignores the variant.
 */

export const FLAG_ROTATION_MASK = 0b0011;
export const FLAG_MIRROR_H = 0b0100;
export const FLAG_MIRROR_V = 0b1000;

export interface CellFlags {
  /** Quarter turns clockwise, 0..3. */
  readonly quarterTurns: number;
  readonly mirrorH: boolean;
  readonly mirrorV: boolean;
}

export function decodeFlags(flags: number): CellFlags {
  return {
    quarterTurns: flags & FLAG_ROTATION_MASK,
    mirrorH: (flags & FLAG_MIRROR_H) !== 0,
    mirrorV: (flags & FLAG_MIRROR_V) !== 0,
  };
}

export function encodeFlags(f: CellFlags): number {
  return (f.quarterTurns & 3) | (f.mirrorH ? FLAG_MIRROR_H : 0) | (f.mirrorV ? FLAG_MIRROR_V : 0);
}

/** Parameters of a centre-anchored sprite/particle covering exactly one cell. */
export interface CellSprite {
  /** Centre, in pixels of the chunk (zoom 1). */
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Radians. */
  readonly rotation: number;
}

/**
 * Sprite covering cell (lx, ly) of a chunk (local cell coordinates 0..31) with a frame of
 * `frameW` × `frameH` pixels. Each image axis is stretched to the cell size, so the result
 * covers the cell whatever the rotation.
 */
export function cellSprite(
  lx: number,
  ly: number,
  cellPx: number,
  frameW: number,
  frameH: number,
  flags: number,
): CellSprite {
  const f = decodeFlags(flags);
  const sx = cellPx / Math.max(1e-6, frameW);
  const sy = cellPx / Math.max(1e-6, frameH);
  return {
    x: (lx + 0.5) * cellPx,
    y: (ly + 0.5) * cellPx,
    scaleX: f.mirrorH ? -sx : sx,
    scaleY: f.mirrorV ? -sy : sy,
    rotation: (f.quarterTurns * Math.PI) / 2,
  };
}

/** Number of variant frames of an image (see module comment). */
export function variantFrameCount(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const w = Math.round(width);
  const h = Math.round(height);
  if (w < 2 * h || w % h !== 0) return 1;
  return w / h;
}

export function variantFrame(variant: number, frames: number): number {
  if (frames <= 1) return 0;
  const v = Math.max(0, Math.floor(variant));
  return v % frames;
}
