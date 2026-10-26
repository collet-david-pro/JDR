/**
 * Synchronous vision core (contract VisionCore, ./types.ts): occluder sets built lazily per
 * mode, visibility polygons cached by (mode, rounded position, radius, cone) for the current
 * occluders. Used by vision.worker, by the same-thread fallback and by the PNG export.
 *
 * Cache: positions are rounded to 1/1000 cell (the wire precision) and the polygon is computed
 * at the rounded position, so the result does not depend on the cache history. The cache is
 * kept across scene revisions whose occluders are unchanged (same objects, compared by
 * identity: a token move bumps the revision but not the walls).
 */
import type { MapObject, Point, Polygon } from '../editor/contracts';
import { EPS, buildOccluderSet, rawPieces, type OccluderSet, type RawPiece } from './occluders';
import type { OccluderMode, Segment, VisionCore, VisionScene, VisionSource } from './types';
import { SweepScratch, visibilityPolygon } from './visibility';

/** Sources are kept this far inside the map (a source on the border would see outside). */
const BORDER_INSET = 1e-3;
const CACHE_LIMIT = 4096;

export function isOccluderObject(o: MapObject): boolean {
  return o.type === 'wall' || o.type === 'door' || o.type === 'window';
}

function sameList(a: readonly MapObject[], b: readonly MapObject[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameFrame(a: VisionScene, b: VisionScene): boolean {
  return (
    a.floor === b.floor && a.width === b.width && a.height === b.height && a.viewer === b.viewer
  );
}

export class VisionCoreImpl implements VisionCore {
  private scene: VisionScene | null = null;
  private occluders: readonly MapObject[] = [];
  private pieces: RawPiece[] | null = null;
  private readonly sets = new Map<OccluderMode, OccluderSet>();
  private readonly segmentLists = new Map<OccluderMode, readonly Segment[]>();
  private readonly cache = new Map<string, Polygon>();
  private readonly scratch = new SweepScratch();
  private readonly ids: number[] = [];
  /** Number of occluder rebuilds (tests, diagnostics). */
  rebuilds = 0;

  setScene(scene: VisionScene): void {
    const prev = this.scene;
    this.scene = scene;
    if (prev !== null && sameFrame(prev, scene) && prev.revision === scene.revision) return;
    const occluders = scene.objects.filter(isOccluderObject);
    if (prev !== null && sameFrame(prev, scene) && sameList(occluders, this.occluders)) return;
    this.occluders = occluders;
    this.pieces = null;
    this.sets.clear();
    this.segmentLists.clear();
    this.cache.clear();
  }

  /** Watertight segment set of a mode (built on first use). */
  occluderSet(mode: OccluderMode): OccluderSet {
    let set = this.sets.get(mode);
    if (set === undefined) {
      const scene = this.scene;
      this.pieces ??= rawPieces(this.occluders, scene?.viewer ?? 'gm');
      set = buildOccluderSet(
        mode,
        this.pieces,
        scene === null ? null : { x0: 0, y0: 0, x1: scene.width, y1: scene.height },
      );
      this.sets.set(mode, set);
      this.rebuilds++;
    }
    return set;
  }

  compute(kind: 'vision' | 'light', sources: readonly VisionSource[]): Map<string, Polygon> {
    const out = new Map<string, Polygon>();
    const set = this.occluderSet(kind);
    const scene = this.scene;
    for (const s of sources) {
      let x = Math.round(s.x * 1000) / 1000;
      let y = Math.round(s.y * 1000) / 1000;
      if (scene !== null) {
        x = Math.min(scene.width - BORDER_INSET, Math.max(BORDER_INSET, x));
        y = Math.min(scene.height - BORDER_INSET, Math.max(BORDER_INSET, y));
      }
      const cone = s.cone ?? null;
      const key = `${kind}|${x}|${y}|${s.radius}|${cone === null ? '' : `${cone.angle},${cone.direction}`}`;
      let polygon = this.cache.get(key);
      if (polygon !== undefined) {
        // Refresh (LRU order).
        this.cache.delete(key);
      } else {
        polygon = visibilityPolygon(set, x, y, s.radius, cone, this.scratch);
        if (this.cache.size >= CACHE_LIMIT) {
          this.cache.delete(this.cache.keys().next().value!);
        }
      }
      this.cache.set(key, polygon);
      out.set(s.id, polygon);
    }
    return out;
  }

  /** Number of cached polygons (tests). */
  get cacheSize(): number {
    return this.cache.size;
  }

  segments(mode: OccluderMode): readonly Segment[] {
    let list = this.segmentLists.get(mode);
    if (list === undefined) {
      const { coords, count } = this.occluderSet(mode);
      const segs: Segment[] = [];
      for (let i = 0; i < count; i++) {
        segs.push({
          ax: coords[i * 4]!,
          ay: coords[i * 4 + 1]!,
          bx: coords[i * 4 + 2]!,
          by: coords[i * 4 + 3]!,
        });
      }
      list = Object.freeze(segs);
      this.segmentLists.set(mode, list);
    }
    return list;
  }

  /**
   * First point of p→q touching an occluder of `mode`, or null. A contact within EPS of p is
   * ignored (a token standing against a wall can move away from it).
   */
  firstHit(mode: OccluderMode, p: Point, q: Point): Point | null {
    const set = this.occluderSet(mode);
    const [px, py] = p;
    const dx = q[0] - px;
    const dy = q[1] - py;
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    const ids = set.grid.queryBox(px, py, q[0], q[1], this.ids);
    let best = Infinity;
    const c = set.coords;
    for (const i of ids) {
      const t = crossParam(px, py, dx, dy, c[i * 4]!, c[i * 4 + 1]!, c[i * 4 + 2]!, c[i * 4 + 3]!);
      if (t !== null && t * len > EPS && t < best) best = t;
    }
    return best === Infinity ? null : [px + dx * best, py + dy * best];
  }

  /**
   * True when segment a→b touches an occluder of `mode` anywhere, ends included (fog room fill;
   * not part of the VisionCore contract).
   */
  crosses(mode: OccluderMode, ax: number, ay: number, bx: number, by: number): boolean {
    const set = this.occluderSet(mode);
    const ids = set.grid.queryBox(ax, ay, bx, by, this.ids);
    const c = set.coords;
    const dx = bx - ax;
    const dy = by - ay;
    for (const i of ids) {
      if (
        crossParam(ax, ay, dx, dy, c[i * 4]!, c[i * 4 + 1]!, c[i * 4 + 2]!, c[i * 4 + 3]!) !== null
      )
        return true;
    }
    return false;
  }
}

/**
 * Parameter t ∈ [0, 1] along p + t·d where it meets segment c→e (ends of c→e extended by EPS),
 * the first overlap point for collinear overlapping segments, or null.
 */
function crossParam(
  px: number,
  py: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  ex: number,
  ey: number,
): number | null {
  const fx = ex - cx;
  const fy = ey - cy;
  const fl = Math.hypot(fx, fy);
  const den = dx * fy - dy * fx;
  const wx = cx - px;
  const wy = cy - py;
  const dl = Math.hypot(dx, dy);
  if (Math.abs(den) <= 1e-12 * dl * fl) {
    // Parallel: collinear overlap only.
    if (Math.abs(wx * dy - wy * dx) / dl > EPS) return null;
    const d2 = dx * dx + dy * dy;
    const t0 = (wx * dx + wy * dy) / d2;
    const t1 = ((ex - px) * dx + (ey - py) * dy) / d2;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    return lo <= hi ? lo : null;
  }
  const t = (wx * fy - wy * fx) / den;
  const u = (wx * dy - wy * dx) / den;
  const m = EPS / fl;
  if (t < 0 || t > 1 || u < -m || u > 1 + m) return null;
  return t;
}

export function createCore(): VisionCoreImpl {
  return new VisionCoreImpl();
}
