/**
 * Pure maths of the symmetry / repeat options of the tile brush: mirrors a set of cells around
 * the centre of the map (or a chosen axis) and repeats it with a step in cells. No document access.
 */
import type { Point } from './raster';

export type SymmetryAxes = 'none' | 'vertical' | 'horizontal' | 'both';

export const SYMMETRY_AXES: readonly SymmetryAxes[] = ['none', 'vertical', 'horizontal', 'both'];
/** Maximum number of repeated copies (besides the original). */
export const REPEAT_MAX = 16;
/** Maximum repeat step, in cells. */
export const REPEAT_STEP_MAX = 256;

export interface SymmetrySpec {
  /** `vertical` mirrors left/right (vertical axis), `horizontal` top/bottom. */
  readonly axes: SymmetryAxes;
  /** Axis position in cells (cell edge coordinates, steps of 0.5); null = centre of the map. */
  readonly axisX: number | null;
  readonly axisY: number | null;
  /** Step of the repetition in cells (0 on both = no repeat). */
  readonly repeatStepX: number;
  readonly repeatStepY: number;
  /** Number of copies besides the original (0 = no repeat). */
  readonly repeatCount: number;
}

export const NO_SYMMETRY: SymmetrySpec = Object.freeze({
  axes: 'none',
  axisX: null,
  axisY: null,
  repeatStepX: 0,
  repeatStepY: 0,
  repeatCount: 0,
});

/** True when the spec changes nothing. */
export function isIdentity(spec: SymmetrySpec): boolean {
  return spec.axes === 'none' && !hasRepeat(spec);
}

function hasRepeat(spec: SymmetrySpec): boolean {
  return spec.repeatCount > 0 && (spec.repeatStepX !== 0 || spec.repeatStepY !== 0);
}

const halfStep = (v: number): number => Math.round(v * 2) / 2;
const int = (v: number, max: number): number =>
  Number.isFinite(v) ? Math.max(-max, Math.min(max, Math.round(v))) : 0;

/** Mirrored cell coordinate around an axis located at `axis` (cell edge coordinates). */
export function mirrorCoord(c: number, axis: number): number {
  return Math.round(2 * halfStep(axis) - c - 1);
}

/**
 * Cells with their mirrored and repeated copies, inside the map, without duplicates (the original
 * cells come first). Repeats apply to the original and mirrored cells.
 */
export function symmetricCells(
  cells: readonly Point[],
  spec: SymmetrySpec,
  width: number,
  height: number,
): Point[] {
  if (isIdentity(spec))
    return cells.filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height);
  const ax = spec.axisX ?? width / 2;
  const ay = spec.axisY ?? height / 2;
  const mx = spec.axes === 'vertical' || spec.axes === 'both';
  const my = spec.axes === 'horizontal' || spec.axes === 'both';
  const sx = int(spec.repeatStepX, REPEAT_STEP_MAX);
  const sy = int(spec.repeatStepY, REPEAT_STEP_MAX);
  const copies = hasRepeat(spec)
    ? Math.min(REPEAT_MAX, Math.max(0, Math.floor(spec.repeatCount)))
    : 0;
  const seen = new Set<number>();
  const out: Point[] = [];
  const add = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const key = y * width + x;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([x, y]);
  };
  for (const [x, y] of cells) {
    const xs = mx ? [x, mirrorCoord(x, ax)] : [x];
    const ys = my ? [y, mirrorCoord(y, ay)] : [y];
    for (const px of xs) {
      for (const py of ys) {
        for (let k = 0; k <= copies; k++) add(px + k * sx, py + k * sy);
      }
    }
  }
  return out;
}
