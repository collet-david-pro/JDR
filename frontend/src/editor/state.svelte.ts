/**
 * Reactive editor UI state (simple values only — projet.md 13.2: never chunks, documents or
 * Pixi objects; arrays are $state.raw and replaced as a whole). Implements the live settings
 * read by the tools.
 */
import type { CellValue, GridTheme, LayerDef, LayerId, TileLayerId } from './contracts';
import type { EditorSettings } from './EditorController';
import type { HistoryState } from './history/History';
import { clampBrushSize } from './tools/common';
import type { BrushShape, CellRect, ShapeKind, ToolId } from './tools/types';
import type { PaletteItem } from './ui/palette';

export interface EditorNotice {
  /** Increases with every notice (lets the live region re-announce the same text). */
  readonly id: number;
  readonly text: string;
}

export class EditorUiState implements EditorSettings {
  tool = $state<ToolId>('brush');
  layer = $state<TileLayerId>('ground');
  tile = $state.raw<CellValue | null>(null);
  brushSize = $state(1);
  brushShape = $state<BrushShape>('square');
  /** Random variant option; effective only when the tile image has several frames. */
  randomVariant = $state(false);
  randomRotation = $state(false);
  shapeKind = $state<ShapeKind>('rect');
  shapeFilled = $state(true);
  selection = $state.raw<readonly CellRect[]>([]);

  history = $state.raw<HistoryState>({
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    undoSize: 0,
    redoSize: 0,
  });
  layers = $state.raw<readonly LayerDef[]>([]);
  solo = $state<LayerId | null>(null);
  palette = $state.raw<readonly PaletteItem[]>([]);
  theme = $state<GridTheme>('parchment');
  gridVisible = $state(true);
  panelsOpen = $state(true);
  helpOpen = $state(false);
  panMode = $state(false);

  /** Status bar. */
  cursor = $state.raw<{ readonly x: number; readonly y: number } | null>(null);
  zoom = $state(1);
  fps = $state<number | null>(null);
  renderer = $state<'webgpu' | 'webgl' | null>(null);
  performanceMode = $state(false);
  notice = $state.raw<EditorNotice | null>(null);

  /** Variant frames of the current tile image (1 when unknown or single image). */
  get tileFrames(): number {
    const index = this.tile?.index;
    return this.palette.find((p) => p.index === index)?.frames ?? 1;
  }

  /** ToolSettings: random variants only for multi-frame tiles. */
  get variantCount(): number {
    return this.randomVariant ? this.tileFrames : 1;
  }

  setBrushSize(size: number): void {
    this.brushSize = clampBrushSize(size);
  }
}
