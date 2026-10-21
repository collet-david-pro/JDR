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
  return { xs, ys, clip, fade };
}
