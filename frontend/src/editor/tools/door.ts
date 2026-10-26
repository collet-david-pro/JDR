/**
 * Door / window tool (D, projet.md 15.2): placed on an existing wall under the pointer, with
 * the width of the options; the wall is split around the opening in ONE command (update of the
 * wall + add of the remaining piece + add of the door / window). Preview: `segment` overlay
 * (red when there is no wall under the pointer).
 */
import type { MapObject, MapOp, Point, WallObject } from '../contracts';
import { round3 } from '../model/scene-values';
import { command, lockedLayer, newOpening, newWall, tolerance } from './object-common';
import { dedupePoints, dist, project, snapToGrid, wallSegments } from './geometry';
import type { Tool, ToolContext, ToolResult } from './types';

export interface WallHit {
  readonly wall: WallObject;
  /** Segment index (closing segment = points.length - 1 for a closed wall). */
  readonly segment: number;
  readonly a: Point;
  readonly b: Point;
}

/** Nearest wall segment within `tol` cells of p (+ half its thickness). */
export function wallAt(objects: readonly MapObject[], p: Point, tol: number): WallHit | null {
  let best: WallHit | null = null;
  let bestD = Infinity;
  for (const o of objects) {
    if (o.type !== 'wall') continue;
    wallSegments(o).forEach(([a, b], i) => {
      const d = project(p, a, b).distance;
      if (d <= tol + o.props.thickness / 2 && d < bestD) {
        bestD = d;
        best = { wall: o, segment: i, a, b };
      }
    });
  }
  return best;
}

/**
 * Opening of `width` cells centred on the projection of p on the segment (snapped to the
 * half-cell grid unless `free`), kept inside the segment. Null when the segment is too short.
 */
export function openingOn(
  hit: WallHit,
  p: Point,
  width: number,
  free: boolean,
): [Point, Point] | null {
  const len = dist(hit.a, hit.b);
  const w = Math.min(width, len);
  if (w < 0.1) return null;
  const ux = (hit.b[0] - hit.a[0]) / len;
  const uy = (hit.b[1] - hit.a[1]) / len;
  let centre = project(p, hit.a, hit.b).point;
  if (!free) centre = project(snapToGrid(centre), hit.a, hit.b).point;
  // Distance of the centre from a, clamped so that the opening stays on the segment.
  const s = Math.max(
    w / 2,
    Math.min(len - w / 2, (centre[0] - hit.a[0]) * ux + (centre[1] - hit.a[1]) * uy),
  );
  const a: Point = [round3(hit.a[0] + ux * (s - w / 2)), round3(hit.a[1] + uy * (s - w / 2))];
  const b: Point = [round3(hit.a[0] + ux * (s + w / 2)), round3(hit.a[1] + uy * (s + w / 2))];
  return [a, b];
}

/**
 * Pieces of a wall once the opening a–b (on segment `segment`, a nearer its start) is cut out.
 * Open wall: the part before a and the part after b (each null when empty). Closed wall: one
 * open polyline going round from b to a.
 */
export function splitWall(
  wall: WallObject,
  segment: number,
  a: Point,
  b: Point,
): { first: Point[] | null; second: Point[] | null } {
  const pts = wall.geometry.points;
  const valid = (list: Point[]): Point[] | null => {
    const d = dedupePoints(list);
    return d.length >= 2 ? d : null;
  };
  if (wall.geometry.closed && pts.length > 2) {
    const n = pts.length;
    const round: Point[] = [b];
    for (let k = 1; k <= n; k++) round.push(pts[(segment + k) % n]!);
    round.push(a);
    return { first: valid(round), second: null };
  }
  return {
    first: valid([...pts.slice(0, segment + 1), a]),
    second: valid([b, ...pts.slice(segment + 1)]),
  };
}

/** Ops of the door / window command (wall update / add / remove + the opening). */
export function openingOps(ctx: ToolContext, hit: WallHit, a: Point, b: Point): MapOp[] {
  const { wall } = hit;
  const pieces = splitWall(wall, hit.segment, a, b);
  const ops: MapOp[] = [];
  const keep = pieces.first ?? pieces.second;
  const extra = pieces.first !== null ? pieces.second : null;
  if (keep === null) {
    ops.push({ type: 'object.remove', uid: wall.uid });
  } else {
    ops.push({
      type: 'object.update',
      uid: wall.uid,
      rev: wall.rev,
      patch: { geometry: { points: keep, closed: false } },
    });
  }
  if (extra !== null) {
    const piece = newWall(ctx, extra, false);
    ops.push({
      type: 'object.add',
      object: { ...piece, props: wall.props, layer: wall.layer, visibility: wall.visibility },
    });
  }
  ops.push({ type: 'object.add', object: newOpening(ctx, a, b) });
  return ops;
}

export function createDoorTool(ctx: ToolContext): Tool {
  const placement = (x: number, y: number, free: boolean) => {
    const p: Point = [x, y];
    const hit = wallAt(ctx.doc.objects(), p, tolerance(ctx));
    if (hit === null) return { hit: null, ends: null };
    const width = Math.min(20, Math.max(0.1, ctx.settings.openingWidth));
    return { hit, ends: openingOn(hit, p, width, free) };
  };

  const preview = (x: number, y: number, free: boolean): ToolResult => {
    const { ends } = placement(x, y, free);
    if (ends !== null) return { overlay: { kind: 'segment', a: ends[0], b: ends[1], valid: true } };
    const half = Math.min(20, Math.max(0.1, ctx.settings.openingWidth)) / 2;
    return { overlay: { kind: 'segment', a: [x - half, y], b: [x + half, y], valid: false } };
  };

  return {
    id: 'door',
    shortcut: 'D',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'move':
          return preview(e.world.x, e.world.y, e.mods.alt);
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'walls');
          if (locked !== null) return { notice: locked };
          const { hit, ends } = placement(e.world.x, e.world.y, e.mods.alt);
          if (hit === null || ends === null) return { notice: { code: 'no_wall' } };
          if (hit.wall.locked) return { notice: { code: 'object_locked' } };
          const label =
            ctx.settings.openingKind === 'window' ? 'editor.command.window' : 'editor.command.door';
          return {
            command: command(label, openingOps(ctx, hit, ends[0], ends[1])),
            ...preview(e.world.x, e.world.y, e.mods.alt),
          };
        }
        case 'up':
          return {};
        case 'leave':
          return { overlay: null };
      }
    },
    cancel: () => ({ overlay: null }),
    deactivate: () => ({ overlay: null }),
  };
}
