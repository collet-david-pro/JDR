/**
 * Polygon drawing shared by the zone, trap and secret tools (P9b2a): click = point, double
 * click or Enter = finish, Escape = cancel, click on the first point = close. 3 to 200
 * points. Snapping as the wall tool (half cell, wall ends and middles; Alt: free).
 */
import type { MapPointerEvent, Overlay, Point } from '../contracts';
import { MAX_POLYGON_POINTS } from '../model/scene-values';
import { DoubleClick, snapMark, snapStep, tolerance } from './object-common';
import { dedupePoints, dist, samePoint, snapPoint, type Snapped } from './geometry';
import type { ToolContext, ToolNotice, ToolResult } from './types';

export interface PolygonStep {
  /** What the tool returns for the overlay / notice. */
  readonly result: ToolResult;
  /** The closed polygon when the gesture is finished (at least 3 points), else null. */
  readonly done: Point[] | null;
}

export interface PolygonDraw {
  /** Left press. */
  press(e: MapPointerEvent): PolygonStep;
  move(e: MapPointerEvent): ToolResult;
  /** Enter. */
  confirm(): PolygonStep;
  cancel(): ToolResult;
  /** Points being drawn. */
  readonly points: readonly Point[];
}

/** Creates a helper that draws a polygon point by point. */
export function createPolygonDraw(ctx: ToolContext): PolygonDraw {
  let points: Point[] = [];
  const dbl = new DoubleClick(ctx);

  const snap = (e: MapPointerEvent): Snapped => {
    const raw: Point = [e.world.x, e.world.y];
    const tol = tolerance(ctx);
    const first = points[0];
    if (!e.mods.alt && first !== undefined && points.length >= 3 && dist(raw, first) <= tol) {
      return { point: first, kind: 'wall_end' };
    }
    return snapPoint(
      raw,
      ctx.doc.objects(),
      tol,
      ctx.doc.grid,
      e.mods.alt,
      undefined,
      snapStep(ctx),
    );
  };

  const preview = (s: Snapped | null): Overlay | null => {
    const items: Overlay[] = [];
    if (points.length > 0) {
      items.push({
        kind: 'polyline',
        points,
        closed: false,
        ...(s !== null ? { cursor: s.point } : {}),
      });
    }
    if (s !== null && s.kind !== 'none') {
      items.push(
        points.length > 0 ? snapMark(ctx, s.point) : { kind: 'snap', x: s.point[0], y: s.point[1] },
      );
    }
    return items.length === 0 ? null : items.length === 1 ? items[0]! : { kind: 'group', items };
  };

  const finish = (): PolygonStep => {
    const pts = dedupePoints(points);
    const closing = pts.length > 1 && samePoint(pts[0]!, pts[pts.length - 1]!);
    const ring = closing ? pts.slice(0, -1) : pts;
    points = [];
    dbl.reset();
    if (ring.length < 3) return { result: { overlay: null }, done: null };
    return { result: { overlay: null }, done: ring.slice(0, MAX_POLYGON_POINTS) };
  };

  const limit: ToolNotice = { code: 'polygon_limit' };

  return {
    get points() {
      return points;
    },
    press(e): PolygonStep {
      const s = snap(e);
      const double = dbl.press(s.point);
      if (double && points.length >= 3) return finish();
      const first = points[0];
      if (first !== undefined && points.length >= 3 && samePoint(first, s.point)) return finish();
      if (points.length >= MAX_POLYGON_POINTS) {
        return { result: { notice: limit }, done: null };
      }
      const last = points[points.length - 1];
      if (last === undefined || !samePoint(last, s.point)) points = [...points, s.point];
      return { result: { overlay: preview(s) }, done: null };
    },
    move(e): ToolResult {
      return { overlay: preview(snap(e)) };
    },
    confirm(): PolygonStep {
      if (points.length < 3) return { result: {}, done: null };
      return finish();
    },
    cancel(): ToolResult {
      points = [];
      dbl.reset();
      return { overlay: null };
    },
  };
}
