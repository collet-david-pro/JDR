/**
 * Scale of a projection screen (D9). The GM wants a cell to measure `mm_per_cell` (25 mm) on the
 * physical screen: the effective `px/mm` comes from the settings (`px_per_mm`, typed or measured
 * with the on-screen ruler) or from the diagonal of the screen; the zoom of the camera follows.
 * All sizes are CSS pixels; `screen` is the size of the physical screen in CSS pixels.
 */
import { DEFAULT_MM_PER_CELL, type DisplaySettings } from './types';

export const MM_PER_INCH = 25.4;
/** Zoom bounds of the engine camera (px of screen per `cellPx`). */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
/** Length of the on-screen ruler in mm (a real ruler is held against it). */
export const RULER_MM = 100;

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

const positive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * `px_per_mm` when set, else `hypot(width, height) / (diagonal_in × 25.4)`, else null (scale
 * unknown).
 */
export function effectivePxPerMm(
  settings: Pick<DisplaySettings, 'px_per_mm' | 'diagonal_in'>,
  screen: ScreenSize | null,
): number | null {
  if (positive(settings.px_per_mm)) return settings.px_per_mm;
  if (positive(settings.diagonal_in) && screen !== null && screen.width > 0 && screen.height > 0) {
    return Math.hypot(screen.width, screen.height) / (settings.diagonal_in * MM_PER_INCH);
  }
  return null;
}

/** Size of a cell on the screen, CSS px. */
export function cellCssPx(pxPerMm: number, mmPerCell: number = DEFAULT_MM_PER_CELL): number {
  return pxPerMm * mmPerCell;
}

export interface ZoomResult {
  /** Zoom to give the camera, within the engine bounds. */
  readonly zoom: number;
  /** The zoom the scale asks for, before the bounds. */
  readonly raw: number;
  /** The scale cannot be reached: the zoom was bounded. */
  readonly outOfRange: 'low' | 'high' | null;
}

/** `zoom = cell on the screen / gridCellPx` (CameraState.zoom: px of screen per `cellPx`). */
export function zoomFor(
  gridCellPx: number,
  pxPerMm: number,
  mmPerCell: number = DEFAULT_MM_PER_CELL,
): ZoomResult {
  const raw = cellCssPx(pxPerMm, mmPerCell) / gridCellPx;
  if (!Number.isFinite(raw)) return { zoom: 1, raw, outOfRange: null };
  if (raw < MIN_ZOOM) return { zoom: MIN_ZOOM, raw, outOfRange: 'low' };
  if (raw > MAX_ZOOM) return { zoom: MAX_ZOOM, raw, outOfRange: 'high' };
  return { zoom: raw, raw, outOfRange: null };
}

/** `px_per_mm` from the length in CSS px of the on-screen ruler matched with a real one. */
export function pxPerMmFromRuler(linePx: number, mm: number = RULER_MM): number | null {
  return positive(linePx) && positive(mm) ? linePx / mm : null;
}
