/**
 * Map snapshot sent to the export worker (structured-clone friendly; chunk arrays are
 * transferred) and the export options. Built on the main thread from the editor's MapView.
 */
import {
  CHUNK_SIZE,
  type CellRect,
  type ChunkKey,
  type GridSpec,
  type GridTheme,
  type MapView,
  type TileLayerId,
} from '../editor/contracts';
import type { PrintOptions } from './print-layout';

export interface SnapshotLayer {
  readonly id: TileLayerId;
  readonly opacity: number;
  /** Chunks intersecting the extent: [key, 32×32×4 cells (index, variant, flags, 0)]. */
  readonly chunks: readonly (readonly [ChunkKey, Uint16Array])[];
}

export interface SnapshotPaletteEntry {
  readonly index: number;
  readonly name: string;
  /** Absolute URL, or null when the asset has no usable image. */
  readonly url: string | null;
}

export interface MapSnapshot {
  readonly grid: Pick<GridSpec, 'width' | 'height' | 'cellPx'>;
  readonly theme: GridTheme;
  /** Bottom → top, only the exported tile layers. */
  readonly layers: readonly SnapshotLayer[];
  /** Palette entries used by the exported cells. */
  readonly palette: readonly SnapshotPaletteEntry[];
}

export interface ExportOptions {
  readonly extent: CellRect;
  readonly pxPerCell: number;
  readonly grid: boolean;
  readonly transparent: boolean;
  /** Print density / pages; null = screen export. */
  readonly print: PrintOptions | null;
  /** File name base (no extension). */
  readonly baseName: string;
  /** PNG text chunks. */
  readonly title: string;
  readonly software: string;
}

export const TILE_LAYERS: readonly TileLayerId[] = ['ground', 'terrain', 'decor'];

function chunkRange(extent: CellRect): { cx0: number; cy0: number; cx1: number; cy1: number } {
  return {
    cx0: Math.floor(extent.x / CHUNK_SIZE),
    cy0: Math.floor(extent.y / CHUNK_SIZE),
    cx1: Math.floor((extent.x + extent.w - 1) / CHUNK_SIZE),
    cy1: Math.floor((extent.y + extent.h - 1) / CHUNK_SIZE),
  };
}

function inRange(key: ChunkKey, r: ReturnType<typeof chunkRange>): boolean {
  const [cx, cy] = key.split(':').map(Number) as [number, number];
  return cx >= r.cx0 && cx <= r.cx1 && cy >= r.cy0 && cy <= r.cy1;
}

/** Tile layers drawn by default: visible tile layers of the map, bottom → top. */
export function defaultLayers(view: MapView): TileLayerId[] {
  return view.layers
    .filter((l) => l.kind === 'tiles' && l.visible && l.opacity > 0)
    .map((l) => l.id as TileLayerId)
    .filter((id) => TILE_LAYERS.includes(id));
}

/** Palette indices used by `layers` inside `extent`. */
export function usedIndices(
  view: MapView,
  extent: CellRect,
  layers: readonly TileLayerId[],
): Set<number> {
  const used = new Set<number>();
  const range = chunkRange(extent);
  for (const layer of layers) {
    for (const key of view.chunkKeys(layer)) {
      if (!inRange(key, range)) continue;
      const cells = view.chunkCells(layer, key);
      if (cells === null) continue;
      const [cx, cy] = key.split(':').map(Number) as [number, number];
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const index = cells[i * 4]!;
        if (index === 0) continue;
        const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
        const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        if (x >= extent.x && x < extent.x + extent.w && y >= extent.y && y < extent.y + extent.h) {
          used.add(index);
        }
      }
    }
  }
  return used;
}

export interface MissingAsset {
  readonly index: number;
  readonly name: string;
}

/** Used palette entries without an image (drawn with the fallback texture, warned before). */
export function missingAssets(
  view: MapView,
  extent: CellRect,
  layers: readonly TileLayerId[],
): MissingAsset[] {
  const missing: MissingAsset[] = [];
  for (const index of [...usedIndices(view, extent, layers)].sort((a, b) => a - b)) {
    const entry = view.palette[index] ?? null;
    if (entry === null || !entry.url) missing.push({ index, name: entry?.name ?? `#${index}` });
  }
  return missing;
}

function absoluteUrl(url: string, base: string | undefined): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * Copy of the exported part of the map. `transfer` lists the chunk buffers (posting the snapshot
 * with them leaves the editor's document untouched: they are copies).
 */
export function buildSnapshot(
  view: MapView,
  extent: CellRect,
  layers: readonly TileLayerId[],
  baseUrl?: string,
): { snapshot: MapSnapshot; transfer: ArrayBuffer[] } {
  const range = chunkRange(extent);
  const transfer: ArrayBuffer[] = [];
  const order = view.layers.map((l) => l.id);
  const snapshotLayers: SnapshotLayer[] = [...layers]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((id) => {
      const def = view.layers.find((l) => l.id === id);
      const chunks: (readonly [ChunkKey, Uint16Array])[] = [];
      for (const key of view.chunkKeys(id)) {
        if (!inRange(key, range)) continue;
        const cells = view.chunkCells(id, key);
        if (cells === null) continue;
        const copy = cells.slice();
        transfer.push(copy.buffer);
        chunks.push([key, copy]);
      }
      return { id, opacity: Math.min(1, Math.max(0, def?.opacity ?? 1)), chunks };
    });
  const palette: SnapshotPaletteEntry[] = [...usedIndices(view, extent, layers)]
    .sort((a, b) => a - b)
    .map((index) => {
      const entry = view.palette[index] ?? null;
      return {
        index,
        name: entry?.name ?? `#${index}`,
        url: entry?.url ? absoluteUrl(entry.url, baseUrl) : null,
      };
    });
  return {
    snapshot: {
      grid: { width: view.grid.width, height: view.grid.height, cellPx: view.grid.cellPx },
      theme: view.theme,
      layers: snapshotLayers,
      palette,
    },
    transfer,
  };
}
