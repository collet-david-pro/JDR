/**
 * P4a contract between the editor core (src/editor, src/formats: pure TypeScript, no Pixi)
 * and the scene engine (src/engine: Pixi). Changing it requires updating both sides.
 *
 * Coordinates are in cells (projet.md 12.1): origin top-left, Y down. Chunks are 32×32 cells (12.2).
 *
 * Revision 2 (P4a lot C): Overlay `selection` carries `rects[]`; `palette.add` may carry
 * `autotile`; MapView exposes `theme` and `revision`; precisions from the engine (lot A) below.
 *
 * Revision 3 (P5, etapes/P05-vision.md): objects (wall, door, window, light), placed tokens,
 * fog and ambient are read through a separate `SceneView` (MapView is unchanged); new ops,
 * overlays and engine methods (setScene, setView, onVisibility, performance mode), required
 * since the P5 integration.
 */

export const CHUNK_SIZE = 32;

/** Tile layers stored in chunks (12.2 header byte: 0 ground, 1 terrain, 2 decor). */
export type TileLayerId = 'ground' | 'terrain' | 'decor';
export type ObjectLayerId = 'walls' | 'props' | 'lighting' | 'labels' | 'gm';
export type LayerId = TileLayerId | ObjectLayerId;

/** Layer of the stack. `MapView.layers` is ordered bottom → top (index 0 is drawn first). */
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
  /** Reserved for auto-tiling (projet.md 15.2); ignored in P4a. */
  readonly autotile?: string | null;
}

/**
 * One cell value. flags: bits 0-1 rotation ×90° (clockwise), bit 2 mirror H, bit 3 mirror V
 * (12.2). variant: an image whose width is an exact multiple N ≥ 2 of its height is a strip of
 * N square frames and shows frame `variant mod N`; any other image ignores the variant.
 */
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

/** Integer cell rectangle (origin cell, size ≥ 1). */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
  /** Bottom → top. */
  readonly layers: readonly LayerDef[];
  /** Grid theme saved with the map (map.meta); the engine applies it on setMap / meta change. */
  readonly theme: GridTheme;
  /** Local change counter, incremented by every mutation (not the server revision). */
  readonly revision: number;
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

/**
 * Transient drawing drawn by the engine above everything (tool previews, selection, ruler).
 * All coordinates are in cells (world); the ruler ends are floats (cell centres when snapped).
 */
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
  /** Union of rectangles (Shift adds), drawn with marching-ants outlines. */
  | { readonly kind: 'selection'; readonly rects: readonly CellRect[] }
  | {
      readonly kind: 'ruler';
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
      readonly label: string;
    }
  // ---- P5 (revision 3) ----
  /** Several overlays drawn together, in order. */
  | { readonly kind: 'group'; readonly items: readonly Overlay[] }
  /**
   * Selected objects / placed tokens (outline + handles: wall vertices, door ends, light radius
   * handle, token centre). The engine reads their geometry from the SceneView.
   */
  | {
      readonly kind: 'objects';
      readonly objects: readonly string[];
      readonly tokens: readonly string[];
    }
  /** Wall tool preview: the polyline being drawn; `cursor` is the rubber-band end. */
  | {
      readonly kind: 'polyline';
      readonly points: readonly Point[];
      readonly closed: boolean;
      readonly cursor?: Point;
    }
  /** Door / window tool preview on a wall (`valid` false = red: no wall under the pointer). */
  | {
      readonly kind: 'segment';
      readonly a: Point;
      readonly b: Point;
      readonly valid: boolean;
    }
  /** Light tool preview (bright radius, outer dim radius). */
  | {
      readonly kind: 'light';
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly dimRadius: number;
    }
  /** Snap indicator (wall end / middle, grid point). */
  | { readonly kind: 'snap'; readonly x: number; readonly y: number }
  /** Rectangle drag in cells (float), e.g. lasso / fog rectangle. */
  | {
      readonly kind: 'area';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly erase?: boolean;
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
  /** 0 primary, 1 middle, 2 secondary; -1 when no button is held (hover move, leave). */
  readonly button: number;
  readonly mods: PointerModifiers;
}

/**
 * x, y: the cell coordinates (float) shown at the centre of the viewport; zoom: screen pixels
 * per cellPx (1 = 100 %), clamped to 0.05–8.
 */
export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Engine API used by the editor page (implemented in src/engine/SceneEngine.ts). */
export interface SceneEngineApi {
  /** Shows a map (applies its theme) and fits it in the viewport. */
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

  // ---- P5 (revision 3) ----
  /**
   * Objects, placed tokens, fog and ambient of the shown floor. Call after setMap (same
   * document); null removes them. The engine subscribes to SceneView.onSceneChanged.
   */
  setScene(scene: SceneView | null): void;
  /** View mode and render switches (merged with the current options). */
  setView(options: Partial<ViewOptions>): void;
  /**
   * Current visibility of `ViewOptions.viewers` (player / display modes, or `explore` in GM
   * mode), emitted after each recomputation (at most every 100 ms). Used for fog exploration.
   */
  onVisibility(listener: (scene: VisibleScene) => void): () => void;
  /** 'auto' (default: < 30 fps for 3 s) or forced on / off (projet.md 14.1). */
  setPerformanceMode(mode: 'auto' | boolean): void;
  readonly performanceMode: boolean;
}

/** Edit operation (subset of projet.md 11.4 used in P4a). */
export type MapOp =
  | {
      readonly type: 'tiles.set';
      readonly floor: string;
      readonly layer: TileLayerId;
      readonly cells: readonly TileCell[];
    }
  | {
      readonly type: 'palette.add';
      readonly index: number;
      readonly asset_id: string;
      readonly autotile?: string | null;
    }
  | {
      readonly type: 'map.meta';
      readonly layers?: readonly LayerDef[];
      readonly theme?: GridTheme;
      /** P5: partial ambient (merged by the server, like the document). */
      readonly ambient?: Partial<Omit<Ambient, 'weather'>> & { readonly weather?: Weather };
    }
  // ---- P5 (revision 3): wire format = editor format (snake_case keys) ----
  /** `object.rev` is ignored (the server starts at 1). */
  | { readonly type: 'object.add'; readonly object: MapObject }
  | {
      readonly type: 'object.update';
      readonly uid: string;
      /** Revision the edit is based on (see SceneView rev rule). */
      readonly rev: number;
      readonly patch: ObjectPatch;
    }
  | { readonly type: 'object.remove'; readonly uid: string }
  /** `token.rev` is ignored (the server starts at 1). */
  | { readonly type: 'maptoken.add'; readonly token: PlacedToken }
  | {
      readonly type: 'maptoken.update';
      readonly uid: string;
      readonly rev: number;
      readonly patch: PlacedTokenPatch;
    }
  | { readonly type: 'maptoken.remove'; readonly uid: string }
  /**
   * GM fog edit (P5 extension of 11.4). `chunks`: [cx, cy, base64 of the raw-deflate 2 048-byte
   * bitmap (12.3)]. reveal = bitwise OR; hide = clears the bits set in the bitmap (AND NOT).
   */
  | {
      readonly type: 'fog.reveal' | 'fog.hide';
      readonly floor: string;
      readonly chunks: readonly FogChunkWire[];
    };

/** Undoable command (15.1). inverseOps are recomputed against the current state on undo. */
export interface Command {
  readonly label: string;
  readonly ops: readonly MapOp[];
  readonly inverseOps: readonly MapOp[];
  readonly mergeKey?: string;
}

// =============================================================================================
// P5 (revision 3): objects, placed tokens, fog, ambient, vision (projet.md 12.1, 12.3, 12.4, 14.2)
// Coordinates in cells (floats, at most 3 decimals on the wire). Angles in degrees, 0 = +X
// (east), clockwise on screen (Y down).
// =============================================================================================

export type Point = readonly [x: number, y: number];

export type ObjectVisibility = 'all' | 'gm' | 'hidden_until_revealed';

/** Object types of P5 (12.4); the other types arrive with P9 and are refused until then. */
export type MapObjectType = 'wall' | 'door' | 'window' | 'light';

export type WallKind = 'stone' | 'brick' | 'wood' | 'metal' | 'natural' | 'invisible';

export interface WallProps {
  readonly kind: WallKind;
  /** 0.05–2 cells. */
  readonly thickness: number;
  readonly blocks_vision: boolean;
  readonly blocks_light: boolean;
  readonly blocks_move: boolean;
  /** Reserved (P9 textures): always null in P5. */
  readonly texture_asset: null;
  /** Shadow height in cells (0–20), null = default 1. */
  readonly height: number | null;
}

export interface DoorProps {
  readonly state: 'open' | 'closed';
  readonly locked: boolean;
  /** Secret door: shown to players as a plain wall while hidden (12.4). */
  readonly secret: boolean;
  /** Reserved (P9): always null in P5. */
  readonly asset_open: null;
  readonly asset_closed: null;
  /** Hinge end of the open door: 'a' or 'b'; 'slide' = sliding / portcullis. */
  readonly swing: 'a' | 'b' | 'slide';
}

export interface WindowProps {
  readonly kind: 'glass' | 'bars' | 'opening';
}

export interface LightFlicker {
  readonly type: 'none' | 'torch' | 'pulse';
  /** 0–1: relative intensity variation. */
  readonly amp: number;
  /** 0.1–10: cycles per second (order of magnitude). */
  readonly speed: number;
}

export interface LightCone {
  /** Opening, 1–359°. */
  readonly angle: number;
  /** Axis, 0–360°. */
  readonly direction: number;
}

/**
 * Same convention as the token lights of P3 (TokenInput.php): full intensity up to `radius`
 * (bright light), fading to 0 at `dim_radius` (outer radius of the dim light, >= radius).
 */
export interface LightProps {
  /** 0–100 cells. */
  readonly radius: number;
  /** radius–100 cells. */
  readonly dim_radius: number;
  /** "#rrggbb" */
  readonly color: string;
  /** 0–1 */
  readonly intensity: number;
  readonly flicker: LightFlicker;
  readonly cone: LightCone | null;
  readonly enabled: boolean;
  /** uid of a placed token the light follows (its geometry is then ignored), or null. */
  readonly follows_token: string | null;
}

interface ObjectBase {
  /** nanoid, 1–21 chars of [A-Za-z0-9_-], unique in the map. */
  readonly uid: string;
  /** Floor id (string, as in tiles.set). */
  readonly floor: string;
  readonly layer: ObjectLayerId;
  readonly visibility: ObjectVisibility;
  readonly locked: boolean;
  readonly sort_order: number;
  /** Server revision of the object (1 on creation, +1 per applied update). */
  readonly rev: number;
}

/** Polyline: 2–1 000 points; closed = last point joined to the first. Layer 'walls' by default. */
export interface WallObject extends ObjectBase {
  readonly type: 'wall';
  readonly geometry: { readonly points: readonly Point[]; readonly closed: boolean };
  readonly props: WallProps;
}

/** Segment a–b (length 0.1–20 cells), placed on a wall which is split around it (tool D). */
export interface DoorObject extends ObjectBase {
  readonly type: 'door';
  readonly geometry: { readonly a: Point; readonly b: Point };
  readonly props: DoorProps;
}

export interface WindowObject extends ObjectBase {
  readonly type: 'window';
  readonly geometry: { readonly a: Point; readonly b: Point };
  readonly props: WindowProps;
}

/** Layer 'lighting' by default. */
export interface LightObject extends ObjectBase {
  readonly type: 'light';
  readonly geometry: { readonly x: number; readonly y: number };
  readonly props: LightProps;
}

export type MapObject = WallObject | DoorObject | WindowObject | LightObject;

/** object.update patch: geometry and props replace the whole value (no deep merge). */
export interface ObjectPatch {
  readonly geometry?: MapObject['geometry'];
  readonly props?: MapObject['props'];
  readonly visibility?: ObjectVisibility;
  readonly layer?: ObjectLayerId;
  readonly locked?: boolean;
  readonly sort_order?: number;
}

/** Token definition light (P3, lib/types.ts TokenLight). */
export interface TokenLightDef {
  readonly radius: number;
  readonly dim_radius: number;
  readonly color: string;
  readonly intensity: number;
  readonly flicker: boolean;
}

/** Token placed on a map (table map_tokens). x, y = centre of the token, in cells. */
export interface PlacedToken {
  readonly uid: string;
  readonly floor: string;
  /** Token definition id of the same game. */
  readonly token_id: string;
  readonly x: number;
  readonly y: number;
  /** Degrees 0–359. */
  readonly rotation: number;
  /** 0.25–4 */
  readonly scale: number;
  /** Hidden from players (GM sees it faded). */
  readonly hidden: boolean;
  /** Replaces the definition light; null = use the definition. */
  readonly light_override: TokenLightDef | null;
  readonly rev: number;
}

export interface PlacedTokenPatch {
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly scale?: number;
  readonly hidden?: boolean;
  readonly light_override?: TokenLightDef | null;
}

/** What the engine needs of a token definition (from GET /games/{id}/tokens). */
export interface TokenDefView {
  readonly id: string;
  readonly name: string;
  /** Signed URL of the image, null = coloured disc with initials. */
  readonly imageUrl: string | null;
  /** Size in cells. */
  readonly sizeW: number;
  readonly sizeH: number;
  /** "#rrggbb" or null (default ring colour of its kind). */
  readonly ringColor: string | null;
  readonly kind: 'pc' | 'npc' | 'monster' | 'object';
  readonly vision: { readonly enabled: boolean; readonly range: number; readonly dark: number };
  readonly light: TokenLightDef | null;
}

export type WeatherType = 'none' | 'rain' | 'snow' | 'fog' | 'storm';

export interface Weather {
  readonly type: WeatherType;
  readonly intensity: number;
}

/** maps.ambient (server default: darkness 0, tint "#000000", time_of_day null). */
export interface Ambient {
  /** 0 (day) – 1 (pitch black). */
  readonly darkness: number;
  /** "#rrggbb": colour multiplied over the scene ("#000000" = no tint, see vision/ambient.ts). */
  readonly tint: string;
  /** 0–24 h; when set, darkness and tint follow the day/night curve (vision/ambient.ts). */
  readonly time_of_day: number | null;
  readonly weather: Weather;
}

/** [cx, cy, base64 raw-deflate of the 2 048-byte fog bitmap]. */
export type FogChunkWire = readonly [cx: number, cy: number, data: string];

/**
 * Fog bitmap of a 32×32-cell chunk (12.3): 128×128 sub-cells (4×4 per cell), 2 048 bytes,
 * row-major, most significant bit first; bit set = explored. Sub-cell (sx, sy) of the chunk:
 * bit i = sy * 128 + sx, byte i >> 3, mask 0x80 >> (i & 7). See formats/fog-codec.ts.
 */
export type FogBitmap = Uint8Array;

export interface SceneChangedEvent {
  /** Objects added / changed / removed (uids). */
  readonly objects: readonly string[];
  /** Placed tokens added / changed / removed (uids). */
  readonly tokens: readonly string[];
  /** Fog chunks changed. */
  readonly fog: readonly ChunkKey[];
  /** Ambient or token definitions changed. */
  readonly ambient: boolean;
  readonly tokenDefs: boolean;
}

/**
 * Read side of the P5 content of the shown floor (implemented by the editor core). Never put
 * it, nor what it returns, in a Svelte $state. Values are immutable: a change replaces the
 * object (identity changes), so `===` detects changes.
 *
 * Rev rule: after a local object.update / maptoken.update the document increments `rev`
 * locally; the next update carries the new value (the server does the same when it applies it,
 * so both stay equal; an update whose rev is lower than the server's is a conflict).
 */
export interface SceneView {
  readonly floor: string;
  /** Incremented by every object / placed token change (cache key of the occluders). */
  readonly sceneRevision: number;
  /** Objects of the floor, sorted by sort_order then uid. */
  objects(): readonly MapObject[];
  object(uid: string): MapObject | undefined;
  tokens(): readonly PlacedToken[];
  token(uid: string): PlacedToken | undefined;
  tokenDef(tokenId: string): TokenDefView | null;
  readonly ambient: Ambient;
  /** Non-empty fog chunks of the floor. */
  fogKeys(): readonly ChunkKey[];
  /** 2 048-byte bitmap, null = nothing explored in that chunk. Do not mutate. */
  fogChunk(key: ChunkKey): FogBitmap | null;
  /** Batched per microtask, like onChunksChanged. Returns an unsubscribe function. */
  onSceneChanged(listener: (event: SceneChangedEvent) => void): () => void;
}

export type ViewMode = 'gm' | 'player' | 'display';

export interface ViewOptions {
  /**
   * gm: everything visible, fog drawn as a translucent veil, hidden tokens / gm objects faded;
   * player: what `viewers` see now + explored areas (darkened, desaturated), unexplored black;
   * display (P7): like player with the union of `viewers` (empty = revealed fog only).
   */
  readonly mode: ViewMode;
  /** Placed-token uids whose vision is used (player / display, and exploration in gm mode). */
  readonly viewers: readonly string[];
  /** Lightmap + ambient darkness/tint. */
  readonly lighting: boolean;
  /** Fog layer. */
  readonly fog: boolean;
  /** Shadows cast by walls (14.2, 8 nearest lights); forced off in performance mode. */
  readonly shadows: boolean;
  /**
   * Whether the placed tokens are drawn (default true). false (projection screen without
   * tokens): none is drawn, the vision of `viewers` is computed all the same.
   */
  readonly tokens?: boolean;
}

/** Polygon in cells: x0, y0, x1, y1, … (simple, star-shaped around its source). */
export type Polygon = Float32Array;

/**
 * Current visibility of a set of viewers (14.2): a point is visible when it is inside one
 * viewer polygon AND (inside a light polygon within its dim_radius, OR within `dark` cells of
 * that viewer, OR darkness < 0.3).
 */
export interface VisibleScene {
  readonly floor: string;
  /** sceneRevision used. */
  readonly sceneRevision: number;
  /** Effective darkness (after the day/night curve). */
  readonly darkness: number;
  readonly viewers: readonly {
    readonly uid: string;
    readonly x: number;
    readonly y: number;
    /** Vision polygon clipped to vision.range. */
    readonly polygon: Polygon;
    /** Darkvision radius, cells. */
    readonly dark: number;
  }[];
  readonly lights: readonly {
    readonly x: number;
    readonly y: number;
    /** Light polygon clipped to dim_radius (and the cone). */
    readonly polygon: Polygon;
    readonly dimRadius: number;
  }[];
}
