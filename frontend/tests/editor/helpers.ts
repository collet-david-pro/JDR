import type {
  GridSpec,
  MapPointerEvent,
  PaletteEntry,
  TileLayerId,
} from '../../src/editor/contracts';
import { MapDocument } from '../../src/editor/model/MapDocument';
import {
  DEFAULT_OBJECT_SETTINGS,
  type ToolContext,
  type ToolSettings,
} from '../../src/editor/tools/types';
import { createRng } from '../../src/editor/util/rng';
import { TILE_LAYERS } from '../../src/formats/chunk-codec';

export function grid(width: number, height: number): GridSpec {
  return { width, height, cellPx: 70, unitLabel: 'ft', unitPerCell: 5 };
}

export function palette(size: number): (PaletteEntry | null)[] {
  const p: (PaletteEntry | null)[] = [null];
  for (let i = 1; i < size; i++) p.push({ assetId: `a${i}`, url: null, name: `tile ${i}` });
  return p;
}

export function makeDoc(width = 64, height = 64, paletteSize = 8): MapDocument {
  return new MapDocument({ grid: grid(width, height), palette: palette(paletteSize) });
}

/** Full comparable state of a document. */
export function snapshot(doc: MapDocument): unknown {
  const chunks: Record<string, string> = {};
  for (const layer of TILE_LAYERS) {
    for (const key of [...doc.chunkKeys(layer)].sort()) {
      const cells = doc.chunkCells(layer, key)!;
      chunks[`${layer}/${key}`] = Buffer.from(
        cells.buffer,
        cells.byteOffset,
        cells.byteLength,
      ).toString('base64');
    }
  }
  return { chunks, layers: doc.layers, theme: doc.theme, palette: doc.palette };
}

export function ev(
  type: MapPointerEvent['type'],
  x: number,
  y: number,
  mods: Partial<MapPointerEvent['mods']> = {},
  button = 0,
): MapPointerEvent {
  return {
    type,
    cell: { x: Math.floor(x), y: Math.floor(y) },
    world: { x, y },
    button,
    mods: { shift: false, alt: false, ctrlOrMeta: false, ...mods },
  };
}

export type MutableSettings = { -readonly [K in keyof ToolSettings]: ToolSettings[K] };

export function settings(overrides: Partial<ToolSettings> = {}): MutableSettings {
  return {
    layer: 'ground' as TileLayerId,
    tile: { index: 1, variant: 0, flags: 0 },
    brushSize: 1,
    brushShape: 'square',
    variantCount: 1,
    randomRotation: false,
    shapeKind: 'rect',
    shapeFilled: true,
    ...DEFAULT_OBJECT_SETTINGS,
    ...overrides,
  };
}

export function context(doc: MapDocument, s: MutableSettings = settings(), seed = 1): ToolContext {
  return { doc, settings: s, rng: createRng(seed) };
}
