/**
 * P14 map background calibration (pure): from the size of one cell in the image (px) or the
 * number of cells across, and an offset, the geometry of the background image; fit to the map;
 * the map size that holds the image; a new map built from an image.
 *
 * Mode "map size" (map_cells): the width OR the height of the map, in cells; the other side
 * follows the proportions of the image, rounded to the nearest cell (1-400). The image then
 * covers the whole map without distortion, centred: when the rounding leaves a gap, the image is
 * slightly larger than the map on one axis (at most half a cell in all, split on both edges).
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

export type CalibrationMode = 'cell_px' | 'cells_wide' | 'map_cells';
export type MapAxis = 'width' | 'height';

export interface Calibration {
  readonly mode: CalibrationMode;
  /** Size of one cell in the image, px (mode cell_px). */
  readonly cellPx: number;
  /** Number of cells across the image (mode cells_wide). */
  readonly cellsWide: number;
  /** Position of the top-left corner of the image on the map, cells. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Mode map_cells: the side given, and its length in cells (optional: other modes). */
  readonly mapAxis?: MapAxis;
  readonly mapCells?: number;
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

const side = (v: number): number => Math.min(CALIBRATION_MAX_CELLS, Math.max(1, Math.round(v)));

/**
 * Map size for "map size" mode: `cells` on the given axis (whole cells, 1-400), the other side
 * in the proportions of the image, rounded to the nearest cell (1-400). Null when not usable.
 */
export function mapSizeFromImage(image: PixelSize, axis: MapAxis, cells: number): MapBounds | null {
  if (!(image.width > 0) || !(image.height > 0) || !Number.isFinite(cells) || !(cells >= 0.5)) {
    return null;
  }
  const n = side(cells);
  return axis === 'width'
    ? { width: n, height: side((n * image.height) / image.width) }
    : { width: side((n * image.width) / image.height), height: n };
}

/** The image scaled to cover the whole map, proportions kept, centred (overflow split). */
export function coverGeometry(image: PixelSize, map: MapBounds): ImageGeometry | null {
  if (!(image.width > 0) || !(image.height > 0) || !(map.width > 0) || !(map.height > 0)) {
    return null;
  }
  const k = Math.max(map.width / image.width, map.height / image.height);
  const w = r3(image.width * k);
  const h = r3(image.height * k);
  return clampImageGeometry(
    { x: r3((map.width - w) / 2), y: r3((map.height - h) / 2), w, h, rotation: 0 },
    map,
  );
}

/** Target map of a "map size" calibration (null for the other modes or when not usable). */
export function calibrationMap(c: Calibration, image: PixelSize): MapBounds | null {
  if (c.mode !== 'map_cells') return null;
  return mapSizeFromImage(image, c.mapAxis ?? 'width', c.mapCells ?? NaN);
}

/** Size of one cell in the image, px, for a calibration (null when it is not usable). */
export function imageCellPx(c: Calibration, image: PixelSize): number | null {
  if (c.mode === 'map_cells') {
    const g = calibratedGeometry(c, image, { width: 1, height: 1 });
    return g === null ? null : image.width / g.w;
  }
  const v = c.mode === 'cell_px' ? c.cellPx : c.cellsWide > 0 ? image.width / c.cellsWide : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Geometry of the background for a calibration (bounded like the server); null if invalid. In
 * mode map_cells, `map` is ignored: the geometry is that of the target map (calibrationMap).
 */
export function calibratedGeometry(
  c: Calibration,
  image: PixelSize,
  map: MapBounds,
): ImageGeometry | null {
  if (c.mode === 'map_cells') {
    const target = calibrationMap(c, image);
    return target === null ? null : coverGeometry(image, target);
  }
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
  const up = (v: number): number =>
    Math.min(CALIBRATION_MAX_CELLS, Math.max(1, Math.ceil(v - 1e-6)));
  return { width: up(g.x + g.w), height: up(g.y + g.h) };
}

/** True when the geometry is accepted as is on a map of this size (server bounds). */
export function geometryFits(g: ImageGeometry, map: MapBounds): boolean {
  const c = clampImageGeometry(g, map);
  return c.x === g.x && c.y === g.y && c.w === g.w && c.h === g.h;
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

/** A new map made from an image and the size of the map ("map size" mode): same result shape. */
export function mapFromImageSize(
  image: PixelSize,
  axis: MapAxis,
  cells: number,
): { width: number; height: number; cellPx: number; geometry: ImageGeometry } | null {
  const size = mapSizeFromImage(image, axis, cells);
  const geometry = size === null ? null : coverGeometry(image, size);
  if (size === null || geometry === null) return null;
  // The map keeps the resolution of the image: one map cell = one image cell.
  const px = image.width / geometry.w;
  const cellPx = Math.min(MAP_CELL_PX_MAX, Math.max(MAP_CELL_PX_MIN, Math.round(px)));
  return { width: size.width, height: size.height, cellPx, geometry };
}
