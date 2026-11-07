/**
 * P14 map background calibration (pure): from the size of one cell in the image (px) or the
 * number of cells across, and an offset, the geometry of the background image; fit to the map;
 * the map size that holds the image; a new map built from an image.
 */
import type { ImageGeometry } from '../contracts-images';
import { clampImageGeometry } from '../model/image-values';

/** Largest map side, cells (MapInput::GRID_MAX). */
export const CALIBRATION_MAX_CELLS = 400;
/** Map cell size bounds, px (GameSettings::CELL_PX_MIN / MAX). */
export const MAP_CELL_PX_MIN = 16;
export const MAP_CELL_PX_MAX = 512;
/** Default size of one cell in a battlemap image, px. */
export const DEFAULT_IMAGE_CELL_PX = 70;

export type CalibrationMode = 'cell_px' | 'cells_wide';

export interface Calibration {
  readonly mode: CalibrationMode;
  /** Size of one cell in the image, px (mode cell_px). */
  readonly cellPx: number;
  /** Number of cells across the image (mode cells_wide). */
  readonly cellsWide: number;
  /** Position of the top-left corner of the image on the map, cells. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

export interface MapBounds {
  readonly width: number;
  readonly height: number;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Size of one cell in the image, px, for a calibration (null when it is not usable). */
export function imageCellPx(c: Calibration, image: PixelSize): number | null {
  const v = c.mode === 'cell_px' ? c.cellPx : c.cellsWide > 0 ? image.width / c.cellsWide : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Geometry of the background for a calibration (bounded like the server); null if invalid. */
export function calibratedGeometry(
  c: Calibration,
  image: PixelSize,
  map: MapBounds,
): ImageGeometry | null {
  const px = imageCellPx(c, image);
  if (px === null || !(image.width > 0) || !(image.height > 0)) return null;
  const x = Number.isFinite(c.offsetX) ? c.offsetX : 0;
  const y = Number.isFinite(c.offsetY) ? c.offsetY : 0;
  return clampImageGeometry(
    { x, y, w: r3(image.width / px), h: r3(image.height / px), rotation: 0 },
    map,
  );
}

/** Calibration of a geometry (inverse of calibratedGeometry, mode cell_px). */
export function calibrationOf(g: ImageGeometry, image: PixelSize): Calibration {
  const px = g.w > 0 && image.width > 0 ? image.width / g.w : DEFAULT_IMAGE_CELL_PX;
  return {
    mode: 'cell_px',
    cellPx: r3(px),
    cellsWide: r3(g.w),
    offsetX: g.x,
    offsetY: g.y,
  };
}

/** "Fit to the map": the whole image inside the map, proportions kept, at the top-left corner. */
export function fitToMap(image: PixelSize, map: MapBounds): Calibration {
  const k = Math.min(map.width / image.width, map.height / image.height);
  const w = r3(image.width * k);
  return {
    mode: 'cell_px',
    cellPx: r3(image.width / w),
    cellsWide: w,
    offsetX: 0,
    offsetY: 0,
  };
}

/** Map size (whole cells, 1-400) that holds the image placed at g. */
export function mapSizeFor(g: ImageGeometry): MapBounds {
  const side = (v: number): number =>
    Math.min(CALIBRATION_MAX_CELLS, Math.max(1, Math.ceil(v - 1e-6)));
  return { width: side(g.x + g.w), height: side(g.y + g.h) };
}

/** A new map made from an image whose cells are `cellPx` px: map size, cell size, background. */
export function mapFromImage(
  image: PixelSize,
  cellPx: number,
): { width: number; height: number; cellPx: number; geometry: ImageGeometry } | null {
  if (!(cellPx > 0) || !(image.width > 0) || !(image.height > 0)) return null;
  const w = r3(image.width / cellPx);
  const h = r3(image.height / cellPx);
  const size = mapSizeFor({ x: 0, y: 0, w, h, rotation: 0 });
  const mapCellPx = Math.min(MAP_CELL_PX_MAX, Math.max(MAP_CELL_PX_MIN, Math.round(cellPx)));
  return {
    width: size.width,
    height: size.height,
    cellPx: mapCellPx,
    geometry: clampImageGeometry({ x: 0, y: 0, w, h, rotation: 0 }, size),
  };
}
