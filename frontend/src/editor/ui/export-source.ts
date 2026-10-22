/**
 * What the editor hands to the PNG export dialog (contract P4c lot 2 ⇄ lot 3, `ExportSource`):
 * the extent of the selection and of the visible area, in cells, clamped to the map.
 */
import type { CameraState, CellRect, GridSpec } from '../contracts';

/** Entries of the "Exporter" menu. */
export type ExportKind = 'json' | 'zip' | 'png';

function clampRect(
  grid: GridSpec,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CellRect | null {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(grid.width, Math.ceil(x1));
  const bottom = Math.min(grid.height, Math.ceil(y1));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Bounding rectangle of the selected rectangles (null without selection). */
export function selectionBounds(grid: GridSpec, rects: readonly CellRect[]): CellRect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return clampRect(grid, x0, y0, x1, y1);
}

/**
 * Cells visible in a viewport of `size` CSS pixels (camera: cell at the centre, zoom = screen
 * pixels per cellPx), partially visible cells included; null when nothing of the map shows.
 */
export function viewportCellRect(
  grid: GridSpec,
  camera: CameraState,
  size: { readonly width: number; readonly height: number },
): CellRect | null {
  const scale = grid.cellPx * camera.zoom;
  if (!(scale > 0) || size.width <= 0 || size.height <= 0) return null;
  const halfW = size.width / scale / 2;
  const halfH = size.height / scale / 2;
  return clampRect(grid, camera.x - halfW, camera.y - halfH, camera.x + halfW, camera.y + halfH);
}

/** Saves a Blob as a file (object URL + temporary link). */
export function downloadBlob(blob: Blob, fileName: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
