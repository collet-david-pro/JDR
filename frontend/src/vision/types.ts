/**
 * P5 contract of the vision module (src/vision, pure TypeScript + vision.worker; projet.md 13.4,
 * 14.2). Written by the orchestrator (etapes/P05-vision.md): changing it requires updating the
 * engine (lot 3), the editor (lot 4) and the export (lot 2).
 */
import type {
  ChunkKey,
  FogBitmap,
  LightCone,
  MapObject,
  Point,
  Polygon,
  VisibleScene,
} from '../editor/contracts';

/** What blocks: vision (blocks_vision), light (blocks_light) or movement (blocks_move). */
export type OccluderMode = 'vision' | 'light' | 'move';

/**
 * Who looks: 'gm' sees secret doors as doors; 'player' sees a hidden secret door as a wall
 * (both block the same way while closed). Objects on the gm layer / visibility ≠ 'all' still
 * block in both cases (they are physical).
 */
export type Viewer = 'gm' | 'player';

export interface VisionScene {
  readonly floor: string;
  /** Map size in cells (polygons are also clipped to the map rectangle). */
  readonly width: number;
  readonly height: number;
  /** All objects of the floor (non-occluders are ignored). */
  readonly objects: readonly MapObject[];
  readonly viewer: Viewer;
  /** Cache key: same revision = same occluders (SceneView.sceneRevision). */
  readonly revision: number;
}

export interface VisionSource {
  /** Caller id, returned as the key of the result. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Clip radius in cells (> 0). */
  readonly radius: number;
  readonly cone?: LightCone | null;
}

/** One occluding segment (cells). */
export interface Segment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

/**
 * Asynchronous service (worker when available, same-thread fallback otherwise — tests, old
 * browsers). Results are cached by (rounded position, radius, cone, occluder revision).
 */
export interface VisionService {
  /** Replaces the occluders (cheap when the revision is unchanged). */
  setScene(scene: VisionScene): void;
  /**
   * Polygons for the sources against the current scene. 'vision' uses the vision occluders,
   * 'light' the light occluders. A newer call does not cancel an older one; both resolve.
   */
  compute(
    kind: 'vision' | 'light',
    sources: readonly VisionSource[],
  ): Promise<ReadonlyMap<string, Polygon>>;
  destroy(): void;
}

/** Same-thread, synchronous core (used by the worker, the fallback and the PNG export). */
export interface VisionCore {
  setScene(scene: VisionScene): void;
  compute(kind: 'vision' | 'light', sources: readonly VisionSource[]): ReadonlyMap<string, Polygon>;
  /** Occluding segments of a mode (after splitting walls around doors, merging joints). */
  segments(mode: OccluderMode): readonly Segment[];
  /** First hit of the segment p→q against the move occluders, or null (P6 collision). */
  firstHit(mode: OccluderMode, p: Point, q: Point): Point | null;
}

/** Fog rasterisation result: chunk key → 2 048-byte bitmap (only chunks with bits set). */
export type FogRaster = Map<ChunkKey, FogBitmap>;

/** Pure fog rasterisers of src/vision/fog-raster.ts (4×4 sub-cells per cell, 12.3). */
export interface FogRasterizers {
  /** Sub-cells visible in `scene` (rule of VisibleScene), clipped to the map. */
  visible(scene: VisibleScene, width: number, height: number): FogRaster;
  /** Axis-aligned rectangle in cells (floats). */
  rect(x: number, y: number, w: number, h: number, width: number, height: number): FogRaster;
  /** Filled polygon in cells. */
  polygon(points: readonly Point[], width: number, height: number): FogRaster;
  /** Disc (brush) in cells. */
  disc(x: number, y: number, r: number, width: number, height: number): FogRaster;
  /**
   * "Room" of a point: flood fill of sub-cells not crossing the vision occluders of `core`,
   * limited to `maxCells` cells (null when the limit is exceeded: the room is not closed).
   */
  room(
    core: VisionCore,
    x: number,
    y: number,
    width: number,
    height: number,
    maxCells: number,
  ): FogRaster | null;
}
