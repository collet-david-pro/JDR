/**
 * Reactive editor UI state (simple values only — projet.md 13.2: never chunks, documents or
 * Pixi objects; arrays are $state.raw and replaced as a whole). Implements the live settings
 * read by the tools.
 */
import type {
  Ambient,
  CellValue,
  GridTheme,
  LayerDef,
  LayerId,
  TileLayerId,
  ViewMode,
  WallKind,
  WindowProps,
} from './contracts';
import type { EditorSettings } from './EditorController';
import type { HistoryState } from './history/History';
import { DEFAULT_AMBIENT } from './model/scene-values';
import { clampBrushSize } from './tools/common';
import {
  DEFAULT_OBJECT_SETTINGS as D,
  EMPTY_OBJECT_SELECTION,
  type BrushShape,
  type CellRect,
  type FogShape,
  type LightPresetId,
  type ObjectSelection,
  type OpeningKind,
  type ShapeKind,
  type ToolId,
} from './tools/types';
import type { PaletteItem } from './ui/palette';
import type { SaveStatus } from './sync/OpsQueue';

/** A token definition as listed in the Tokens panel (simple values). */
export interface TokenDefItem {
  readonly id: string;
  readonly name: string;
  readonly kind: 'pc' | 'npc' | 'monster' | 'object';
  readonly imageUrl: string | null;
  readonly sizeW: number;
  readonly sizeH: number;
}

/** One selectable object / placed token of the floor (keyboard list, projet.md 22). */
export interface SceneItem {
  readonly uid: string;
  readonly kind: 'token' | 'wall' | 'door' | 'window' | 'light';
  /** Token name, or null for objects (the UI labels them by kind and position). */
  readonly name: string | null;
  readonly x: number;
  readonly y: number;
}

/** View switches of the top bar (projet.md 14.2, ViewOptions). */
export interface ViewState {
  readonly mode: ViewMode;
  /** 'all_pcs' or the uid of a placed token (player view). */
  readonly viewer: string;
  readonly lighting: boolean;
  readonly fog: boolean;
  readonly shadows: boolean;
  /** Fog exploration from the viewers' current visibility. */
  readonly explore: boolean;
  readonly performance: 'auto' | 'on' | 'off';
}

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

  // ---- P5 object tools (EditorSettings) ----
  wallKind = $state<WallKind>(D.wallKind);
  wallThickness = $state(D.wallThickness);
  wallRoom = $state(D.wallRoom);
  openingKind = $state<OpeningKind>(D.openingKind);
  openingWidth = $state(D.openingWidth);
  windowKind = $state<WindowProps['kind']>(D.windowKind);
  lightPreset = $state<LightPresetId>(D.lightPreset);
  tokenId = $state<string | null>(D.tokenId);
  fogShape = $state<FogShape>(D.fogShape);
  fogHide = $state(D.fogHide);
  fogBrush = $state(D.fogBrush);
  /** Selected objects / placed tokens (uids). */
  objectSelection = $state.raw<ObjectSelection>(EMPTY_OBJECT_SELECTION);

  // ---- P5 scene summary for the panels (simple values, never the document) ----
  tokenDefs = $state.raw<readonly TokenDefItem[]>([]);
  sceneItems = $state.raw<readonly SceneItem[]>([]);
  /** Bumped on every object / token change: panels re-read the selected values. */
  sceneVersion = $state(0);
  ambient = $state.raw<Ambient>(DEFAULT_AMBIENT);
  view = $state.raw<ViewState>({
    mode: 'gm',
    viewer: 'all_pcs',
    lighting: true,
    fog: true,
    shadows: false,
    explore: false,
    performance: 'auto',
  });
  /** Last measured vision update (ms), from the engine stats when available. */
  visionMs = $state<number | null>(null);
  /** Number of vision timings measured by the engine (a new one after each scene change). */
  visionSamples = $state(0);
  resetFogOpen = $state(false);

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
  /** History panel shown (P4c). */
  historyOpen = $state(false);
  /** Named snapshot dialog open (Cmd/Ctrl+Shift+S, P4c). */
  snapshotOpen = $state(false);
  panMode = $state(false);

  /** Status bar. */
  cursor = $state.raw<{ readonly x: number; readonly y: number } | null>(null);
  /** Pointer position in cells (float), null outside the map. */
  cursorWorld = $state.raw<{ readonly x: number; readonly y: number } | null>(null);
  zoom = $state(1);
  fps = $state<number | null>(null);
  renderer = $state<'webgpu' | 'webgl' | null>(null);
  performanceMode = $state(false);
  notice = $state.raw<EditorNotice | null>(null);

  /** Pointer edits allowed (false while the map loads). */
  editable = $state(true);
  /** Tile blocks loading progress (requests done / total), null when loaded. */
  loading = $state.raw<{ readonly done: number; readonly total: number } | null>(null);
  /** Save indicator; null for a map that is not saved on the server. */
  save = $state.raw<SaveStatus | null>(null);

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
