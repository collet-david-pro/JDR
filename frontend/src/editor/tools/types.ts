/** Editor tool interfaces (pure logic driven by MapPointerEvent, projet.md 15.2). */
import type {
  CellRect,
  CellValue,
  Command,
  GridSpec,
  MapPointerEvent,
  MapView,
  Overlay,
  TileLayerId,
} from '../contracts';
import type { Rng } from '../util/rng';

export type ToolId =
  'select' | 'hand' | 'brush' | 'eraser' | 'fill' | 'shape' | 'pipette' | 'ruler';

export type BrushShape = 'square' | 'round';
export type ShapeKind = 'rect' | 'ellipse' | 'line';

export const BRUSH_MIN = 1;
export const BRUSH_MAX = 16;
export const FILL_LIMIT = 50_000;

/** Integer cell rectangle (defined in the contract). */
export type { CellRect } from '../contracts';

/** Non-blocking message for the UI (i18n key + params). */
export interface ToolNotice {
  readonly code: 'layer_locked' | 'no_tile' | 'fill_limit' | 'fill_nothing';
  readonly params?: Readonly<Record<string, number | string>>;
}

export interface ToolResult {
  /** undefined = leave the overlay as is, null = clear it. */
  readonly overlay?: Overlay | null;
  /** To run through History.execute(). */
  readonly command?: Command;
  /** Pipette: picked cell value (and its layer). */
  readonly picked?: CellValue;
  readonly pickedLayer?: TileLayerId;
  /** Selection tool: current selection (union of rectangles, empty = none). */
  readonly selection?: readonly CellRect[];
  readonly notice?: ToolNotice;
}

export interface Tool {
  readonly id: ToolId;
  /** Default key (projet.md 15.2). */
  readonly shortcut: string;
  onPointer(event: MapPointerEvent): ToolResult;
  /** Escape: abort the gesture in progress and drop transient state (selection, measure). */
  cancel(): ToolResult;
  /** Tool switch: abort the gesture in progress but keep its results (e.g. the selection). */
  deactivate(): ToolResult;
}

/** What tools read from the document (implemented by MapDocument). */
export interface ToolDocument extends MapView {
  readonly floor: string;
  getIndex(layer: TileLayerId, x: number, y: number): number;
}

/** Live editor settings, read at every event (the UI store implements it). */
export interface ToolSettings {
  readonly layer: TileLayerId;
  /** Tile painted by brush/fill/shapes; null = none chosen. */
  readonly tile: CellValue | null;
  readonly brushSize: number;
  readonly brushShape: BrushShape;
  /** > 1: each painted cell gets a random variant in [0, variantCount). */
  readonly variantCount: number;
  /** Random rotation (flags bits 0-1) for each painted cell. */
  readonly randomRotation: boolean;
  readonly shapeKind: ShapeKind;
  readonly shapeFilled: boolean;
}

export interface ToolContext {
  readonly doc: ToolDocument;
  readonly settings: ToolSettings;
  readonly rng: Rng;
  /** Ruler label; default `${n} ${unitLabel}` with at most one decimal. */
  readonly formatDistance?: (distanceCells: number, grid: GridSpec) => string;
}
