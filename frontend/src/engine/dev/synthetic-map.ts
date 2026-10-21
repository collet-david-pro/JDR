/**
 * Minimal in-memory MapView for the engine demo and benchmarks (development only; the real
 * document model is src/editor/model, lot B).
 */

import {
  CHUNK_SIZE,
  type ChunkKey,
  type ChunksChangedEvent,
  type CellValue,
  type GridSpec,
  type GridTheme,
  type LayerDef,
  type MapView,
  type PaletteEntry,
  type TileLayerId,
} from '../../editor/contracts';
import { chunkKey } from '../chunk-math';

const EMPTY: CellValue = { index: 0, variant: 0, flags: 0 };

export class SyntheticMap implements MapView {
  grid: GridSpec;
  layers: LayerDef[] = [
    { id: 'ground', kind: 'tiles', visible: true, locked: false, opacity: 1 },
    { id: 'terrain', kind: 'tiles', visible: true, locked: false, opacity: 1 },
    { id: 'decor', kind: 'tiles', visible: true, locked: false, opacity: 1 },
    { id: 'walls', kind: 'objects', visible: true, locked: false, opacity: 1 },
  ];
  palette: (PaletteEntry | null)[];
  theme: GridTheme = 'parchment';
  /** Not maintained by the demo (nothing reads it). */
  revision = 0;

  private readonly chunks = new Map<TileLayerId, Map<ChunkKey, Uint16Array>>();
  private readonly chunkListeners = new Set<(e: ChunksChangedEvent) => void>();
  private readonly metaListeners = new Set<() => void>();

  constructor(width: number, height: number, cellPx: number, palette: (PaletteEntry | null)[]) {
    this.grid = { width, height, cellPx, unitLabel: 'ft', unitPerCell: 5 };
    this.palette = palette;
    for (const layer of ['ground', 'terrain', 'decor'] as const) this.chunks.set(layer, new Map());
  }

  getCell(layer: TileLayerId, x: number, y: number): CellValue {
    const data = this.chunks.get(layer)?.get(chunkKey(Math.floor(x / 32), Math.floor(y / 32)));
    if (data === undefined) return EMPTY;
    const i = ((y & 31) * CHUNK_SIZE + (x & 31)) * 4;
    return { index: data[i] ?? 0, variant: data[i + 1] ?? 0, flags: data[i + 2] ?? 0 };
  }

  chunkKeys(layer: TileLayerId): readonly ChunkKey[] {
    return [...(this.chunks.get(layer)?.keys() ?? [])];
  }

  chunkCells(layer: TileLayerId, key: ChunkKey): Uint16Array | null {
    return this.chunks.get(layer)?.get(key) ?? null;
  }

  onChunksChanged(listener: (event: ChunksChangedEvent) => void): () => void {
    this.chunkListeners.add(listener);
    return () => this.chunkListeners.delete(listener);
  }

  onMetaChanged(listener: () => void): () => void {
    this.metaListeners.add(listener);
    return () => this.metaListeners.delete(listener);
  }

  /** Writes cells without notifying (bulk fill), returns the touched chunk keys. */
  write(
    layer: TileLayerId,
    cells: Iterable<readonly [number, number, number, number, number]>,
  ): ChunkKey[] {
    const layerMap = this.chunks.get(layer);
    if (layerMap === undefined) return [];
    const touched = new Set<ChunkKey>();
    for (const [x, y, index, variant, flags] of cells) {
      if (x < 0 || y < 0 || x >= this.grid.width || y >= this.grid.height) continue;
      const key = chunkKey(Math.floor(x / 32), Math.floor(y / 32));
      let data = layerMap.get(key);
      if (data === undefined) {
        data = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * 4);
        layerMap.set(key, data);
      }
      const i = ((y & 31) * CHUNK_SIZE + (x & 31)) * 4;
      data[i] = index;
      data[i + 1] = variant;
      data[i + 2] = flags;
      touched.add(key);
    }
    for (const key of touched) {
      const data = layerMap.get(key);
      if (data !== undefined && data.every((v) => v === 0)) layerMap.delete(key);
    }
    return [...touched];
  }

  /** Writes cells and notifies listeners. */
  set(
    layer: TileLayerId,
    cells: Iterable<readonly [number, number, number, number, number]>,
  ): void {
    const keys = this.write(layer, cells);
    if (keys.length === 0) return;
    for (const l of this.chunkListeners) l({ layer, keys });
  }

  setLayers(layers: LayerDef[]): void {
    this.layers = layers;
    for (const l of this.metaListeners) l();
  }
}

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fills the three tile layers entirely: ground with palette indices [1, groundCount],
 * terrain and decor with the following ones, random variants and flags.
 */
export function fillSynthetic(map: SyntheticMap, groundCount: number, otherCount: number): void {
  const random = rng(42);
  const { width, height } = map.grid;
  const layers: [TileLayerId, number, number][] = [
    ['ground', 1, groundCount],
    ['terrain', 1 + groundCount, otherCount],
    ['decor', 1 + groundCount + otherCount, otherCount],
  ];
  for (const [layer, first, count] of layers) {
    const cells: [number, number, number, number, number][] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = first + Math.floor(random() * count);
        cells.push([x, y, index, Math.floor(random() * 4), Math.floor(random() * 16)]);
      }
    }
    map.write(layer, cells);
  }
}
