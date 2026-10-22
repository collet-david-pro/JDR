/**
 * Pure drawing plan of the PNG export, derived from the engine's own rules so that the export
 * matches the preview (projet.md 23 P4):
 * - cell transform: engine/cell-transform.ts (mirrors applied to the image first, then the
 *   clockwise quarter turns; each image axis stretched to the cell);
 * - variants: horizontal strips of N square frames (variantFrameCount / variantFrame);
 * - missing images: the engine's 2×2 checkerboard (white / #b4b4b4, nearest filtering) tinted
 *   with fallbackColor(index, variant);
 * - grid: engine/grid-lines.ts (inner lines only, constant thickness rounded to the pixel
 *   grid, faded at small cell sizes, theme colour and alpha; the map border lies outside the
 *   map and is not exported). The export behaves like a preview whose device pixel ratio is
 *   L = max(1, round(ppc / cellPx)) at zoom ppc / (cellPx × L): lines are L pixels thick.
 */
import type { CellRect, GridSpec } from '../editor/contracts';
import { decodeFlags, variantFrame, variantFrameCount } from '../engine/cell-transform';
import { fallbackColor } from '../engine/fallback-color';
import { gridFade } from '../engine/grid-lines';
import type { GridThemeDef } from '../engine/grid-themes';
import { cellEdge } from './dimensions';

/** Affine transform (canvas setTransform order: a, b, c, d, e, f). */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface CellDraw {
  /** Destination rectangle in image pixels (integer edges). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Transform placing the image centred on the origin, then drawn at (-dw/2, -dh/2, dw, dh). */
  readonly transform: Affine;
  readonly dw: number;
  readonly dh: number;
  /** True when the transform is a plain translation (fast path: drawImage at x, y, w, h). */
  readonly identity: boolean;
}

const COS = [1, 0, -1, 0];
const SIN = [0, 1, 0, -1];

/**
 * Placement of cell (col, row) of the extent at `ppc` pixels per cell, image coordinates
 * relative to the extent origin.
 */
export function cellDraw(col: number, row: number, ppc: number, flags: number): CellDraw {
  const x = cellEdge(col, ppc);
  const y = cellEdge(row, ppc);
  const w = cellEdge(col + 1, ppc) - x;
  const h = cellEdge(row + 1, ppc) - y;
  const f = decodeFlags(flags);
  const q = f.quarterTurns;
  const sx = f.mirrorH ? -1 : 1;
  const sy = f.mirrorV ? -1 : 1;
  const cos = COS[q]!;
  const sin = SIN[q]!;
  // Odd quarter turns swap the axes: draw w×h rotated from h×w.
  const swap = (q & 1) === 1;
  return {
    x,
    y,
    w,
    h,
    dw: swap ? h : w,
    dh: swap ? w : h,
    transform: {
      a: cos * sx,
      b: sin * sx,
      c: -sin * sy,
      d: cos * sy,
      e: x + w / 2,
      f: y + h / 2,
    },
    identity: flags === 0 || (q === 0 && !f.mirrorH && !f.mirrorV),
  };
}

/** Maps a point of the drawn image (u, v in 0..1 across the frame) to image pixels. */
export function mapImagePoint(draw: CellDraw, u: number, v: number): { x: number; y: number } {
  const lx = (u - 0.5) * draw.dw;
  const ly = (v - 0.5) * draw.dh;
  const t = draw.transform;
  return { x: t.a * lx + t.c * ly + t.e, y: t.b * lx + t.d * ly + t.f };
}

export interface FrameRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/** Source rectangle of a variant in an image (whole image when it is not a strip). */
export function frameRect(width: number, height: number, variant: number): FrameRect {
  const frames = variantFrameCount(width, height);
  if (frames <= 1) return { sx: 0, sy: 0, sw: width, sh: height };
  const f = variantFrame(variant, frames);
  return { sx: f * height, sy: 0, sw: height, sh: height };
}

/** RGBA bytes of the 2×2 fallback tile of a palette index / variant (tinted checkerboard). */
export function fallbackTilePixels(index: number, variant: number): Uint8ClampedArray {
  const tint = fallbackColor(index, variant);
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  const grey = 0xb4 / 255;
  const light = [r, g, b, 255];
  const dark = [Math.round(r * grey), Math.round(g * grey), Math.round(b * grey), 255];
  // (0,0) light, (1,0) dark, (0,1) dark, (1,1) light.
  return Uint8ClampedArray.from([...light, ...dark, ...dark, ...light]);
}

export interface GridLinePlan {
  /** CSS colour with alpha. */
  readonly color: string;
  readonly alpha: number;
  readonly thickness: number;
  /** Left / top pixel of each line (image coordinates relative to the extent). */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/** Grid lines of the extent (null when invisible at this scale). */
export function gridLinePlan(
  extent: CellRect,
  grid: GridSpec,
  ppc: number,
  theme: GridThemeDef,
): GridLinePlan | null {
  const thickness = Math.max(1, Math.round(ppc / grid.cellPx));
  const fade = gridFade(ppc / thickness);
  const alpha = theme.lineAlpha * fade;
  if (alpha <= 0) return null;
  const half = Math.round(thickness / 2);
  const xs: number[] = [];
  const ys: number[] = [];
  // Inner lines of the map (1..width-1) that fall inside or on the edges of the extent.
  for (let i = Math.max(1, extent.x); i <= Math.min(grid.width - 1, extent.x + extent.w); i++) {
    xs.push(cellEdge(i - extent.x, ppc) - half);
  }
  for (let j = Math.max(1, extent.y); j <= Math.min(grid.height - 1, extent.y + extent.h); j++) {
    ys.push(cellEdge(j - extent.y, ppc) - half);
  }
  const c = theme.line;
  return {
    color: `rgb(${(c >> 16) & 0xff} ${(c >> 8) & 0xff} ${c & 0xff})`,
    alpha,
    thickness,
    xs,
    ys,
  };
}
