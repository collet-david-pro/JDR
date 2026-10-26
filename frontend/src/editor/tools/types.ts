/** Editor tool interfaces (pure logic driven by MapPointerEvent, projet.md 15.2). */
import type {
  CellRect,
  CellValue,
  Command,
  GridSpec,
  MapPointerEvent,
  MapView,
  Overlay,
  SceneView,
  TileLayerId,
  TokenDefView,
  WallKind,
  WindowProps,
} from '../contracts';
import type { VisionCore } from '../../vision/index';
import type { Rng } from '../util/rng';

export type ToolId =
  | 'select'
  | 'hand'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'shape'
  | 'wall'
  | 'door'
  | 'light'
  | 'token'
  | 'fog'
  | 'pipette'
  | 'ruler';

/** P5 object tool options. */
export type OpeningKind = 'door' | 'window';
export type FogShape = 'brush' | 'rect' | 'room';
export type LightPresetId = 'torch' | 'lantern' | 'candle' | 'campfire' | 'magic';

/** Selected objects and placed tokens (uids). */
export interface ObjectSelection {
  readonly objects: readonly string[];
  readonly tokens: readonly string[];
}

export const EMPTY_OBJECT_SELECTION: ObjectSelection = Object.freeze({
  objects: Object.freeze([]),
  tokens: Object.freeze([]),
});

/** Keyboard actions forwarded to the active tool (Enter, Delete). */
export type ToolAction = 'confirm' | 'delete';

export type BrushShape = 'square' | 'round';
export type ShapeKind = 'rect' | 'ellipse' | 'line';

export const BRUSH_MIN = 1;
export const BRUSH_MAX = 16;
export const FILL_LIMIT = 50_000;

/** Integer cell rectangle (defined in the contract). */
export type { CellRect } from '../contracts';

/** Non-blocking message for the UI (i18n key + params). */
export interface ToolNotice {
  readonly code:
    | 'layer_locked'
    | 'no_tile'
    | 'fill_limit'
    | 'fill_nothing'
    | 'no_wall'
    | 'no_token'
    | 'room_open'
    | 'object_locked'
    | 'wall_limit'
    | 'invalid';
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
  /** P5: selected objects / placed tokens. */
  readonly objectSelection?: ObjectSelection;
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
  /** Enter (finish the wall), Delete (remove the selection). */
  onAction?(action: ToolAction): ToolResult;
}

/** What tools read from the document (implemented by MapDocument). */
export interface ToolDocument extends MapView, SceneView {
  readonly floor: string;
  getIndex(layer: TileLayerId, x: number, y: number): number;
  /** Token definitions of the game (token tool). */
  tokenDefs(): readonly TokenDefView[];
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
  // ---- P5 object tools ----
  readonly wallKind: WallKind;
  /** Cells, 0.05–2. */
  readonly wallThickness: number;
  /** Wall tool draws a closed rectangle of walls ("room"). */
  readonly wallRoom: boolean;
  readonly openingKind: OpeningKind;
  /** Door / window width in cells (0.1–20). */
  readonly openingWidth: number;
  readonly windowKind: WindowProps['kind'];
  readonly lightPreset: LightPresetId;
  /** Token definition placed by the token tool (null: none chosen). */
  readonly tokenId: string | null;
  readonly fogShape: FogShape;
  /** Fog tool hides instead of revealing (Alt inverts it). */
  readonly fogHide: boolean;
  /** Fog brush radius in cells. */
  readonly fogBrush: number;
}

/** Defaults of the P5 tool settings. */
export const DEFAULT_OBJECT_SETTINGS = Object.freeze({
  wallKind: 'stone' as WallKind,
  wallThickness: 0.2,
  wallRoom: false,
  openingKind: 'door' as OpeningKind,
  openingWidth: 1,
  windowKind: 'glass' as WindowProps['kind'],
  lightPreset: 'torch' as LightPresetId,
  tokenId: null as string | null,
  fogShape: 'brush' as FogShape,
  fogHide: false,
  fogBrush: 1.5,
});

export const FOG_BRUSH_MIN = 0.5;
export const FOG_BRUSH_MAX = 10;
/** Pointer tolerance of the object tools, in screen pixels. */
export const HIT_TOLERANCE_PX = 8;
/** Two presses within this delay and distance make a double click. */
export const DOUBLE_CLICK_MS = 400;
export const DOUBLE_CLICK_PX = 6;

export interface ToolContext {
  readonly doc: ToolDocument;
  readonly settings: ToolSettings;
  readonly rng: Rng;
  /** Ruler label; default `${n} ${unitLabel}` with at most one decimal. */
  readonly formatDistance?: (distanceCells: number, grid: GridSpec) => string;
  /** P5: cells per screen pixel at the current zoom (default 1 / cellPx). */
  readonly pixelSize?: () => number;
  /** P5: clock of the double click (default Date.now). */
  readonly now?: () => number;
  /** P5: uid of a new object / placed token (default: random 21 characters). */
  readonly newUid?: () => string;
  /** P5: vision core with the current scene (fog "room" fill). */
  readonly visionCore?: () => VisionCore;
}
