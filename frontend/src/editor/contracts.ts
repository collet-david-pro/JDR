/**
 * P4a contract between the editor core (src/editor, src/formats: pure TypeScript, no Pixi)
 * and the scene engine (src/engine: Pixi). Changing it requires updating both sides.
 *
 * Coordinates are in cells (projet.md 12.1): origin top-left, Y down. Chunks are 32×32 cells (12.2).
 */

export const CHUNK_SIZE = 32;

/** Tile layers stored in chunks (12.2 header byte: 0 ground, 1 terrain, 2 decor). */
export type TileLayerId = 'ground' | 'terrain' | 'decor';
export type ObjectLayerId = 'walls' | 'props' | 'lighting' | 'labels' | 'gm';
export type LayerId = TileLayerId | ObjectLayerId;

export interface LayerDef {
  readonly id: LayerId;
  readonly kind: 'tiles' | 'objects';
  readonly visible: boolean;
  readonly locked: boolean;
  /** 0..1 */
  readonly opacity: number;
  readonly gmOnly?: boolean;
}

/** Palette entry; index 0 is always null (empty cell). */
export interface PaletteEntry {
  readonly assetId: string;
  /** Signed URL of the full image, resolved by the host page. */
  readonly url: string | null;
  readonly name: string;
}

/** One cell value. flags: bits 0-1 rotation ×90°, bit 2 mirror H, bit 3 mirror V (12.2). */
export interface CellValue {
  readonly index: number;
  readonly variant: number;
  readonly flags: number;
}

/** [x, y, palette_index, variant, flags] — the wire format of the tiles.set op (11.4). */
export type TileCell = readonly [
  x: number,
  y: number,
  index: number,
  variant: number,
  flags: number,
];

export type GridTheme = 'parchment' | 'slate' | 'blueprint' | 'dark' | 'light';

export interface GridSpec {
  readonly width: number;
  readonly height: number;
  /** Pixels per cell at zoom 1. */
  readonly cellPx: number;
  readonly unitLabel: string;
  readonly unitPerCell: number;
}

/** Chunk key "cx:cy". */
export type ChunkKey = `${number}:${number}`;

export interface ChunksChangedEvent {
  readonly layer: TileLayerId;
  readonly keys: readonly ChunkKey[];
}

/**
 * Read side of the in-memory map document, as seen by the engine.
 * Implemented by the editor core (src/editor/model).
 */
export interface MapView {
  readonly grid: GridSpec;
  readonly layers: readonly LayerDef[];
  readonly palette: readonly (PaletteEntry | null)[];
  getCell(layer: TileLayerId, x: number, y: number): CellValue;
  /** Non-empty chunks of a layer. */
  chunkKeys(layer: TileLayerId): readonly ChunkKey[];
  /** 32×32 cells, row-major, 4 values per cell: index, variant, flags, 0. Null when empty. */
  chunkCells(layer: TileLayerId, key: ChunkKey): Uint16Array | null;
  /** Returns an unsubscribe function. */
  onChunksChanged(listener: (event: ChunksChangedEvent) => void): () => void;
  onMetaChanged(listener: () => void): () => void;
}

/** Transient drawing drawn by the engine above everything (tool previews, selection, ruler). */
export type Overlay =
  | {
      readonly kind: 'cells';
      readonly cells: readonly (readonly [number, number])[];
      readonly erase?: boolean;
    }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | {
      readonly kind: 'selection';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | {
      readonly kind: 'ruler';
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
      readonly label: string;
    };

export interface PointerModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrlOrMeta: boolean;
}

/** Pointer event translated by the engine into map coordinates. */
export interface MapPointerEvent {
  readonly type: 'down' | 'move' | 'up' | 'leave';
  /** Integer cell under the pointer (may be outside the map). */
  readonly cell: { readonly x: number; readonly y: number };
  /** Position in cells (float). */
  readonly world: { readonly x: number; readonly y: number };
  /** 0 primary, 1 middle, 2 secondary. */
  readonly button: number;
  readonly mods: PointerModifiers;
}

export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Engine API used by the editor page (implemented in src/engine/SceneEngine.ts). */
export interface SceneEngineApi {
  setMap(view: MapView): void;
  setGridTheme(theme: GridTheme): void;
  setGridVisible(visible: boolean): void;
  setOverlay(overlay: Overlay | null): void;
  /** When true, primary-button drags pan the view (hand tool / space held). */
  setPanMode(enabled: boolean): void;
  readonly camera: {
    get(): CameraState;
    set(state: Partial<CameraState>): void;
    fit(): void;
    zoomBy(factor: number, aroundScreen?: { x: number; y: number }): void;
  };
  onPointer(listener: (event: MapPointerEvent) => void): () => void;
  onCamera(listener: (state: CameraState) => void): () => void;
  onFps(listener: (fps: number) => void): () => void;
  /** 'webgpu' | 'webgl' once initialised. */
  readonly renderer: 'webgpu' | 'webgl';
  destroy(): void;
}

/** Edit operation (subset of projet.md 11.4 used in P4a). */
export type MapOp =
  | {
      readonly type: 'tiles.set';
      readonly floor: string;
      readonly layer: TileLayerId;
      readonly cells: readonly TileCell[];
    }
  | { readonly type: 'palette.add'; readonly index: number; readonly asset_id: string }
  | {
      readonly type: 'map.meta';
      readonly layers?: readonly LayerDef[];
      readonly theme?: GridTheme;
    };

/** Undoable command (15.1). inverseOps are recomputed against the current state on undo. */
export interface Command {
  readonly label: string;
  readonly ops: readonly MapOp[];
  readonly inverseOps: readonly MapOp[];
  readonly mergeKey?: string;
}
