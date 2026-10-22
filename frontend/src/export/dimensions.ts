/**
 * PNG export: extent and output size (projet.md 17, 2.8). Pure functions, shared by the dialog
 * (live size) and the renderer.
 *
 * Cell edges are snapped to whole pixels: cell column c of the extent covers the pixels
 * [round(c × ppc), round((c + 1) × ppc)), so non-integer pixels per cell (target width/height)
 * never leave seams between tiles; the image is round(w × ppc) × round(h × ppc).
 */
import type { CellRect, GridSpec } from '../editor/contracts';

export type ExtentKind = 'map' | 'selection' | 'view';

/** 'factor' ×1/×2/×4 · 'cell' px per cell · 'width' / 'height' target · 'custom' free scale. */
export type ResolutionMode = 'factor' | 'cell' | 'width' | 'height' | 'custom';

export interface ResolutionInput {
  readonly mode: ResolutionMode;
  readonly factor: number;
  readonly cellPx: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

export const EXPORT_LIMITS = Object.freeze({
  /** Warning from this size (Mpx). */
  warnMegapixels: 100,
  /** Hard cap (Mpx), adjustable here. */
  maxMegapixels: 400,
  /** Advised maximum side for image viewers. */
  viewerMaxSide: 65_535,
  /** PNG limit (2^31 − 1). */
  pngMaxSide: 0x7fffffff,
  minPxPerCell: 1,
  maxPxPerCell: 2048,
  minScale: 0.01,
  maxScale: 32,
});

export const RESOLUTION_FACTORS: readonly number[] = [1, 2, 4];

/** Clamps a rectangle to the map; null when empty / outside. */
export function clampToMap(rect: CellRect, grid: GridSpec): CellRect | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(grid.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(grid.height, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Cells to export for a kind of extent (null when that extent is not available). */
export function resolveExtent(
  kind: ExtentKind,
  grid: GridSpec,
  selection: CellRect | null,
  viewport: CellRect | null,
): CellRect | null {
  if (kind === 'map') return clampToMap({ x: 0, y: 0, w: grid.width, h: grid.height }, grid);
  const rect = kind === 'selection' ? selection : viewport;
  return rect === null ? null : clampToMap(rect, grid);
}

/** Pixels per cell for a resolution choice (NaN when the input is not usable). */
export function pixelsPerCell(res: ResolutionInput, extent: CellRect, baseCellPx: number): number {
  switch (res.mode) {
    case 'factor':
      return baseCellPx * res.factor;
    case 'cell':
      return res.cellPx;
    case 'width':
      return res.width / extent.w;
    case 'height':
      return res.height / extent.h;
    case 'custom':
      return baseCellPx * res.scale;
  }
}

/** Pixel offset of cell edge `i` (relative to the extent origin). */
export function cellEdge(i: number, ppc: number): number {
  return Math.round(i * ppc);
}

export function outputSize(extent: CellRect, ppc: number): { width: number; height: number } {
  return { width: cellEdge(extent.w, ppc), height: cellEdge(extent.h, ppc) };
}

export type SizeError = 'invalid' | 'too_small' | 'too_large' | 'png_limit';
export type SizeWarning = 'large' | 'viewer_limit';

export interface SizeReport {
  readonly pxPerCell: number;
  readonly width: number;
  readonly height: number;
  readonly megapixels: number;
  readonly error: SizeError | null;
  readonly warnings: readonly SizeWarning[];
}

/** Final size with the caps (projet.md 17): ≥ 100 Mpx warning, > 400 Mpx refused. */
export function sizeReport(
  res: ResolutionInput,
  extent: CellRect,
  baseCellPx: number,
  maxMegapixels: number = EXPORT_LIMITS.maxMegapixels,
): SizeReport {
  const ppc = pixelsPerCell(res, extent, baseCellPx);
  const bad = (error: SizeError, width = 0, height = 0): SizeReport => ({
    pxPerCell: ppc,
    width,
    height,
    megapixels: (width * height) / 1e6,
    error,
    warnings: [],
  });
  if (!Number.isFinite(ppc) || ppc <= 0) return bad('invalid');
  if (
    res.mode === 'custom' &&
    !(res.scale >= EXPORT_LIMITS.minScale && res.scale <= EXPORT_LIMITS.maxScale)
  ) {
    return bad('invalid');
  }
  const { width, height } = outputSize(extent, ppc);
  if (ppc < EXPORT_LIMITS.minPxPerCell || width < 1 || height < 1) {
    return bad('too_small', width, height);
  }
  if (ppc > EXPORT_LIMITS.maxPxPerCell) return bad('too_large', width, height);
  if (width > EXPORT_LIMITS.pngMaxSide || height > EXPORT_LIMITS.pngMaxSide) {
    return bad('png_limit', width, height);
  }
  const megapixels = (width * height) / 1e6;
  if (megapixels > maxMegapixels) return bad('too_large', width, height);
  const warnings: SizeWarning[] = [];
  if (megapixels >= EXPORT_LIMITS.warnMegapixels) warnings.push('large');
  if (width > EXPORT_LIMITS.viewerMaxSide || height > EXPORT_LIMITS.viewerMaxSide) {
    warnings.push('viewer_limit');
  }
  return { pxPerCell: ppc, width, height, megapixels, error: null, warnings };
}

/** File name base from the map name (no path separators / control characters). */
export function safeFileName(name: string, fallback = 'map'): string {
  const cleaned = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return cleaned === '' ? fallback : cleaned;
}
