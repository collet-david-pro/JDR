/**
 * Reactive editor UI state (simple values only — projet.md 13.2: never chunks or Pixi objects).
 * Implements the live settings read by the tools.
 */
import type { CellValue, TileLayerId } from './contracts';
import type { HistoryState } from './history/History';
import { clampBrushSize } from './tools/common';
import type { BrushShape, CellRect, ShapeKind, ToolId } from './tools/types';
import type { EditorSettings } from './EditorController';

export class EditorUiState implements EditorSettings {
  tool = $state<ToolId>('brush');
  layer = $state<TileLayerId>('ground');
  /** Replaced as a whole ($state.raw: no deep proxy). */
  tile = $state.raw<CellValue | null>(null);
  brushSize = $state(1);
  brushShape = $state<BrushShape>('square');
  variantCount = $state(1);
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

  setBrushSize(size: number): void {
    this.brushSize = clampBrushSize(size);
  }
}
