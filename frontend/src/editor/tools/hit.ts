/**
 * Hit testing of objects and placed tokens (selection tool). Priority: tokens > lights >
 * doors / windows > walls; the tolerance is given in cells (screen pixels × cells per pixel).
 * Handles of selected objects: wall vertices, door / window ends, light radius (east of the
 * light, at dim_radius), the same positions as the engine `objects` overlay.
 */
import type { LayerDef, MapObject, PlacedToken, Point, SceneView } from '../contracts';
import { dist, objectBox, project, wallSegments } from './geometry';
import type { ObjectSelection } from './types';

export type Hit =
  | { readonly kind: 'token'; readonly uid: string }
  | { readonly kind: 'object'; readonly uid: string };

export type HandleHit =
  | { readonly kind: 'vertex'; readonly uid: string; readonly index: number }
  | { readonly kind: 'end'; readonly uid: string; readonly end: 'a' | 'b' }
  | { readonly kind: 'radius'; readonly uid: string };

/** Light gizmo radius in screen px (scene/style.ts LIGHT_GIZMO_PX + margin). */
const LIGHT_PICK_PX = 9;

export function tokenRadius(scene: SceneView, t: PlacedToken): number {
  const def = scene.tokenDef(t.token_id);
  const size = def === null ? 1 : Math.max(def.sizeW, def.sizeH);
  return (size * t.scale) / 2;
}

function layerShown(layers: readonly LayerDef[], id: string): boolean {
  return layers.find((l) => l.id === id)?.visible !== false;
}

/** Distance from p to an object's shape (cells, 0 inside). */
export function objectDistance(o: MapObject, p: Point): number {
  switch (o.type) {
    case 'light':
      return dist(p, [o.geometry.x, o.geometry.y]);
    case 'door':
    case 'window':
      return project(p, o.geometry.a, o.geometry.b).distance;
    case 'wall': {
      let best = Infinity;
      for (const [a, b] of wallSegments(o)) best = Math.min(best, project(p, a, b).distance);
      return Math.max(0, best - o.props.thickness / 2);
    }
  }
}

const RANK: Record<MapObject['type'], number> = { light: 0, door: 1, window: 1, wall: 2 };

/** Topmost object or token under p (tol in cells, px = cells per screen pixel). */
export function hitTest(
  scene: SceneView,
  layers: readonly LayerDef[],
  p: Point,
  tol: number,
  px: number,
): Hit | null {
  let bestToken: { uid: string; d: number } | null = null;
  for (const t of scene.tokens()) {
    const d = dist(p, [t.x, t.y]) - tokenRadius(scene, t);
    if (d <= tol && (bestToken === null || d < bestToken.d)) bestToken = { uid: t.uid, d };
  }
  if (bestToken !== null) return { kind: 'token', uid: bestToken.uid };
  let best: { uid: string; rank: number; d: number } | null = null;
  for (const o of scene.objects()) {
    if (!layerShown(layers, o.layer)) continue;
    const limit = o.type === 'light' ? Math.max(tol, LIGHT_PICK_PX * px) : tol;
    const d = objectDistance(o, p);
    if (d > limit) continue;
    const rank = RANK[o.type];
    if (best === null || rank < best.rank || (rank === best.rank && d < best.d)) {
      best = { uid: o.uid, rank, d };
    }
  }
  return best === null ? null : { kind: 'object', uid: best.uid };
}

/** Handle of a selected object under p. */
export function handleAt(
  scene: SceneView,
  selection: ObjectSelection,
  p: Point,
  tol: number,
): HandleHit | null {
  for (const uid of selection.objects) {
    const o = scene.object(uid);
    if (o === undefined) continue;
    if (o.type === 'wall') {
      const i = o.geometry.points.findIndex((q) => dist(p, q) <= tol);
      if (i >= 0) return { kind: 'vertex', uid, index: i };
    } else if (o.type === 'door' || o.type === 'window') {
      if (dist(p, o.geometry.a) <= tol) return { kind: 'end', uid, end: 'a' };
      if (dist(p, o.geometry.b) <= tol) return { kind: 'end', uid, end: 'b' };
    } else if (dist(p, lightRadiusHandle(o.geometry.x, o.geometry.y, o.props.dim_radius)) <= tol) {
      return { kind: 'radius', uid };
    }
  }
  return null;
}

export function lightRadiusHandle(x: number, y: number, dimRadius: number): Point {
  return [x + dimRadius, y];
}

/** Objects (shown layers) and tokens inside a rectangle (cells, floats). */
export function insideRect(
  scene: SceneView,
  layers: readonly LayerDef[],
  r: { x: number; y: number; w: number; h: number },
): ObjectSelection {
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const objects = scene
    .objects()
    .filter((o) => {
      if (!layerShown(layers, o.layer)) return false;
      const b = objectBox(o);
      return b.x0 >= r.x && b.y0 >= r.y && b.x1 <= x1 && b.y1 <= y1;
    })
    .map((o) => o.uid);
  const tokens = scene
    .tokens()
    .filter((t) => t.x >= r.x && t.y >= r.y && t.x <= x1 && t.y <= y1)
    .map((t) => t.uid);
  return { objects, tokens };
}
