/**
 * Square grid geometry in screen space (pure). Lines are drawn as screen-space rectangles of
 * constant thickness whatever the zoom, snapped to device pixels, faded out when cells get
 * small on screen.
 */

import type { CameraState, GridSpec } from '../editor/contracts';
import { worldToScreen, type Viewport } from './camera';

/** Below this cell size (CSS px) grid lines are hidden. */
export const GRID_HIDE_BELOW_PX = 6;
/** From this cell size (CSS px) grid lines are at full strength. */
export const GRID_FULL_FROM_PX = 16;
/** Line thickness, CSS px. */
export const GRID_LINE_PX = 1;
/** Map border thickness, CSS px. */
export const GRID_BORDER_PX = 2;

/** 0..1 strength of the grid lines for a cell size in CSS px (smoothstep). */
export function gridFade(cellScreenPx: number): number {
  if (!(cellScreenPx > GRID_HIDE_BELOW_PX)) return 0;
  if (cellScreenPx >= GRID_FULL_FROM_PX) return 1;
  const t = (cellScreenPx - GRID_HIDE_BELOW_PX) / (GRID_FULL_FROM_PX - GRID_HIDE_BELOW_PX);
  return t * t * (3 - 2 * t);
}

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Map rectangle on screen (CSS px, not clipped). */
export function mapScreenRect(camera: CameraState, viewport: Viewport, grid: GridSpec): ScreenRect {
  const a = worldToScreen(camera, viewport, grid.cellPx, 0, 0);
  const b = worldToScreen(camera, viewport, grid.cellPx, grid.width, grid.height);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Intersection of two screen rectangles. */
export function intersectRect(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Rounds a CSS coordinate to the device pixel grid. */
export function snap(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

export interface GridLines {
  /** Screen x of the inner vertical lines (snapped), clipped to the viewport. */
  readonly xs: number[];
  /** Screen y of the inner horizontal lines (snapped). */
  readonly ys: number[];
  /** Visible part of the map (lines span this rectangle). */
  readonly clip: ScreenRect | null;
  /** 0..1 strength. */
  readonly fade: number;
  /** Cell index of the first line of `xs` / `ys`. */
  readonly xStart?: number;
  readonly yStart?: number;
}

/** Hard cap on the number of lines per axis (safety; the fade hides them long before). */
export const GRID_MAX_LINES = 2000;

/** Inner grid lines (the outer edge is the border) visible in the viewport. */
export function computeGridLines(
  camera: CameraState,
  viewport: Viewport,
  grid: GridSpec,
  dpr: number,
): GridLines {
  const cell = grid.cellPx * camera.zoom;
  const fade = gridFade(cell);
  const map = mapScreenRect(camera, viewport, grid);
  const clip = intersectRect(map, { x: 0, y: 0, w: viewport.width, h: viewport.height });
  if (fade === 0 || clip === null) return { xs: [], ys: [], clip, fade };
  const xs: number[] = [];
  const ys: number[] = [];
  const i0 = Math.max(1, Math.ceil((clip.x - map.x) / cell));
  const i1 = Math.min(grid.width - 1, Math.floor((clip.x + clip.w - map.x) / cell));
  for (let i = i0; i <= i1 && xs.length < GRID_MAX_LINES; i++) xs.push(snap(map.x + i * cell, dpr));
  const j0 = Math.max(1, Math.ceil((clip.y - map.y) / cell));
  const j1 = Math.min(grid.height - 1, Math.floor((clip.y + clip.h - map.y) / cell));
  for (let j = j0; j <= j1 && ys.length < GRID_MAX_LINES; j++) ys.push(snap(map.y + j * cell, dpr));
  return { xs, ys, clip, fade, xStart: i0, yStart: j0 };
}

/** Grid drawing style: full lines, dots or small crosses at the intersections. */
export type GridStyle = 'lines' | 'dots' | 'crosses';

/** Above this number of intersections, dots / crosses fall back to lines (cost bound). */
export const GRID_MAX_MARKS = 40000;

/** Rectangle (same unit as the inputs) to fill. */
export interface GridRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface GridStrokeInput {
  readonly style: GridStyle;
  /** Left / top pixel of each vertical / horizontal line (thickness `th`). */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** Cell index of the first line of `xs` / `ys` (for the major lines). */
  readonly xStart: number;
  readonly yStart: number;
  readonly th: number;
  /** Area the lines span. */
  readonly clip: GridRect;
  /** Every Nth line is strong (style `lines`), 0 = none. */
  readonly major: number;
}

export interface GridStrokes {
  /** Rectangles at the base strength. */
  readonly base: GridRect[];
  /** Thicker rectangles of the major lines, drawn with a stronger alpha. */
  readonly strong: GridRect[];
}

/** Rectangles that draw the grid in the given style (pure, shared by the scene and the export). */
export function gridStrokes(input: GridStrokeInput): GridStrokes {
  const { xs, ys, th, clip } = input;
  const base: GridRect[] = [];
  const strong: GridRect[] = [];
  const marks = input.style !== 'lines' && xs.length * ys.length <= GRID_MAX_MARKS;
  if (!marks) {
    xs.forEach((x, k) => {
      base.push({ x, y: clip.y, w: th, h: clip.h });
      if (input.major > 0 && (input.xStart + k) % input.major === 0) {
        strong.push({ x: x - Math.ceil(th / 2), y: clip.y, w: th * 2, h: clip.h });
      }
    });
    ys.forEach((y, k) => {
      base.push({ x: clip.x, y, w: clip.w, h: th });
      if (input.major > 0 && (input.yStart + k) % input.major === 0) {
        strong.push({ x: clip.x, y: y - Math.ceil(th / 2), w: clip.w, h: th * 2 });
      }
    });
    return { base, strong };
  }
  const dot = th * 3;
  const arm = th * 5;
  for (const x of xs) {
    for (const y of ys) {
      const cx = x + th / 2;
      const cy = y + th / 2;
      if (input.style === 'dots') {
        base.push({ x: cx - dot / 2, y: cy - dot / 2, w: dot, h: dot });
      } else {
        base.push({ x: cx - arm, y, w: arm * 2 + 0, h: th }, { x, y: cy - arm, w: th, h: arm * 2 });
      }
    }
  }
  return { base, strong };
}
