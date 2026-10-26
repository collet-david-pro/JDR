/**
 * Edits of the selection tool on objects and placed tokens: move (snapped, kept in the map),
 * handles (wall vertex, door end, light radius), delete, door open / close. Pure functions.
 */
import type {
  DoorObject,
  MapObject,
  MapOp,
  ObjectPatch,
  Overlay,
  PlacedToken,
  Point,
  SceneView,
} from '../contracts';
import { round3 } from '../model/scene-values';
import { objectBox } from './geometry';
import type { HandleHit } from './hit';
import type { ObjectSelection, ToolDocument } from './types';

/** Objects and tokens of the selection that may be edited (not locked, layer not locked). */
export function editable(doc: ToolDocument, sel: ObjectSelection) {
  const lockedLayers = new Set(doc.layers.filter((l) => l.locked).map((l) => l.id));
  const objects = sel.objects
    .map((uid) => doc.object(uid))
    .filter((o): o is MapObject => o !== undefined && !o.locked && !lockedLayers.has(o.layer));
  const tokens = sel.tokens
    .map((uid) => doc.token(uid))
    .filter((t): t is PlacedToken => t !== undefined);
  return { objects, tokens };
}

function movedGeometry(o: MapObject, dx: number, dy: number): MapObject['geometry'] {
  const mv = (p: Point): Point => [round3(p[0] + dx), round3(p[1] + dy)];
  switch (o.type) {
    case 'wall':
      return { points: o.geometry.points.map(mv), closed: o.geometry.closed };
    case 'door':
    case 'window':
      return { a: mv(o.geometry.a), b: mv(o.geometry.b) };
    case 'light':
      return { x: round3(o.geometry.x + dx), y: round3(o.geometry.y + dy) };
  }
}

/** Delta clamped so that every moved item stays inside the map. */
export function clampDelta(
  objects: readonly MapObject[],
  tokens: readonly PlacedToken[],
  dx: number,
  dy: number,
  width: number,
  height: number,
): [number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of objects) {
    const b = objectBox(o);
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  for (const t of tokens) {
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x);
    y1 = Math.max(y1, t.y);
  }
  if (x0 === Infinity) return [dx, dy];
  return [Math.min(width - x1, Math.max(-x0, dx)), Math.min(height - y1, Math.max(-y0, dy))];
}

/**
 * Snapped move delta: with a token in the selection its footprint lands on the cells, else
 * the delta is a multiple of half a cell. `free` (Alt): unchanged.
 */
export function snapDelta(
  scene: SceneView,
  tokens: readonly PlacedToken[],
  dx: number,
  dy: number,
  free: boolean,
): [number, number] {
  if (free) return [dx, dy];
  const t = tokens[0];
  if (t !== undefined) {
    const def = scene.tokenDef(t.token_id);
    const w = (def?.sizeW ?? 1) / 2;
    const h = (def?.sizeH ?? 1) / 2;
    return [Math.round(t.x + dx - w) + w - t.x, Math.round(t.y + dy - h) + h - t.y];
  }
  return [Math.round(dx * 2) / 2, Math.round(dy * 2) / 2];
}

export function moveOps(
  objects: readonly MapObject[],
  tokens: readonly PlacedToken[],
  dx: number,
  dy: number,
): MapOp[] {
  if (dx === 0 && dy === 0) return [];
  const ops: MapOp[] = objects.map((o) => ({
    type: 'object.update',
    uid: o.uid,
    rev: o.rev,
    patch: { geometry: movedGeometry(o, dx, dy) },
  }));
  for (const t of tokens) {
    ops.push({
      type: 'maptoken.update',
      uid: t.uid,
      rev: t.rev,
      patch: { x: round3(t.x + dx), y: round3(t.y + dy) },
    });
  }
  return ops;
}

/** Preview of objects / tokens at their moved position. */
export function movePreview(
  scene: SceneView,
  objects: readonly MapObject[],
  tokens: readonly PlacedToken[],
  dx: number,
  dy: number,
): Overlay[] {
  const out: Overlay[] = objects.map((o) =>
    shapeOverlay({ ...o, geometry: movedGeometry(o, dx, dy) } as MapObject),
  );
  for (const t of tokens) {
    const def = scene.tokenDef(t.token_id);
    const w = (def?.sizeW ?? 1) * t.scale;
    const h = (def?.sizeH ?? 1) * t.scale;
    out.push({ kind: 'area', x: t.x + dx - w / 2, y: t.y + dy - h / 2, w, h });
  }
  return out;
}

/** Outline of an object as a tool overlay. */
export function shapeOverlay(o: MapObject): Overlay {
  switch (o.type) {
    case 'wall':
      return { kind: 'polyline', points: o.geometry.points, closed: o.geometry.closed };
    case 'door':
    case 'window':
      return { kind: 'segment', a: o.geometry.a, b: o.geometry.b, valid: true };
    case 'light':
      return {
        kind: 'light',
        x: o.geometry.x,
        y: o.geometry.y,
        radius: o.props.radius,
        dimRadius: o.props.dim_radius,
      };
  }
}

/** Patch of a handle drag to point p (already snapped), or null when nothing changes. */
export function handlePatch(o: MapObject, handle: HandleHit, p: Point): ObjectPatch | null {
  const q: Point = [round3(p[0]), round3(p[1])];
  if (handle.kind === 'vertex' && o.type === 'wall') {
    const points = o.geometry.points.map((v, i) => (i === handle.index ? q : v));
    return { geometry: { points, closed: o.geometry.closed } };
  }
  if (handle.kind === 'end' && (o.type === 'door' || o.type === 'window')) {
    const g = handle.end === 'a' ? { a: q, b: o.geometry.b } : { a: o.geometry.a, b: q };
    const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    return len < 0.1 || len > 20 ? null : { geometry: g };
  }
  if (handle.kind === 'radius' && o.type === 'light') {
    const dim = round3(
      Math.min(100, Math.max(0.1, Math.hypot(p[0] - o.geometry.x, p[1] - o.geometry.y))),
    );
    const ratio = o.props.dim_radius > 0 ? o.props.radius / o.props.dim_radius : 0.5;
    return { props: { ...o.props, dim_radius: dim, radius: round3(Math.min(dim, dim * ratio)) } };
  }
  return null;
}

export function deleteOps(objects: readonly MapObject[], tokens: readonly PlacedToken[]): MapOp[] {
  return [
    ...objects.map((o): MapOp => ({ type: 'object.remove', uid: o.uid })),
    ...tokens.map((t): MapOp => ({ type: 'maptoken.remove', uid: t.uid })),
  ];
}

/** Opens a closed door, closes an open one. */
export function toggleDoorOp(door: DoorObject): MapOp {
  return {
    type: 'object.update',
    uid: door.uid,
    rev: door.rev,
    patch: { props: { ...door.props, state: door.props.state === 'open' ? 'closed' : 'open' } },
  };
}
