/**
 * Wall tool (W, projet.md 15.2): polyline — click = point, double click / Enter = finish,
 * Escape = cancel, clicking the first point closes the wall. Snapping to the half-cell grid and
 * to wall ends / middles (Alt: free). "Room" option: drag a rectangle of closed walls.
 */
import type { MapPointerEvent, Overlay, Point } from '../contracts';
import { MAX_WALL_POINTS } from '../model/scene-values';
import { command, DoubleClick, lockedLayer, newWall, tolerance } from './object-common';
import { dedupePoints, dist, samePoint, snapPoint, type Snapped } from './geometry';
import type { Tool, ToolContext, ToolResult } from './types';

export function createWallTool(ctx: ToolContext): Tool {
  let points: Point[] = [];
  /** Room mode: corner where the drag started. */
  let roomFrom: Point | null = null;
  const dbl = new DoubleClick(ctx);

  const snap = (e: MapPointerEvent): Snapped => {
    const raw: Point = [e.world.x, e.world.y];
    const tol = tolerance(ctx);
    const first = points[0];
    // The first point of the polyline being drawn closes it.
    if (!e.mods.alt && first !== undefined && points.length >= 3 && dist(raw, first) <= tol) {
      return { point: first, kind: 'wall_end' };
    }
    return snapPoint(raw, ctx.doc.objects(), tol, ctx.doc.grid, e.mods.alt);
  };

  const roomPoints = (a: Point, b: Point): Point[] => [a, [b[0], a[1]], b, [a[0], b[1]]];

  const preview = (s: Snapped | null): Overlay | null => {
    const items: Overlay[] = [];
    if (roomFrom !== null && s !== null) {
      items.push({ kind: 'polyline', points: roomPoints(roomFrom, s.point), closed: true });
    } else if (points.length > 0) {
      items.push({
        kind: 'polyline',
        points,
        closed: false,
        ...(s !== null ? { cursor: s.point } : {}),
      });
    }
    if (s !== null && s.kind !== 'none') items.push({ kind: 'snap', x: s.point[0], y: s.point[1] });
    return items.length === 0 ? null : items.length === 1 ? items[0]! : { kind: 'group', items };
  };

  const finish = (closed: boolean): ToolResult => {
    const pts = dedupePoints(points);
    points = [];
    dbl.reset();
    if (pts.length < 2) return { overlay: null };
    const wall = newWall(ctx, pts.slice(0, MAX_WALL_POINTS), closed && pts.length > 2);
    return {
      overlay: null,
      command: command('editor.command.wall', [{ type: 'object.add', object: wall }]),
    };
  };

  return {
    id: 'wall',
    shortcut: 'W',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'walls');
          if (locked !== null) return { notice: locked };
          const s = snap(e);
          if (ctx.settings.wallRoom) {
            roomFrom = s.point;
            points = [];
            return { overlay: preview(s) };
          }
          const double = dbl.press(s.point);
          if (double && points.length >= 2) return finish(false);
          const first = points[0];
          if (first !== undefined && points.length >= 3 && samePoint(first, s.point)) {
            return finish(true);
          }
          if (points.length >= MAX_WALL_POINTS) return { notice: { code: 'wall_limit' } };
          const last = points[points.length - 1];
          if (last === undefined || !samePoint(last, s.point)) points = [...points, s.point];
          return { overlay: preview(s) };
        }
        case 'move':
          return { overlay: preview(snap(e)) };
        case 'up': {
          if (roomFrom === null) return {};
          const s = snap(e);
          const from = roomFrom;
          roomFrom = null;
          if (Math.abs(s.point[0] - from[0]) < 1e-6 || Math.abs(s.point[1] - from[1]) < 1e-6) {
            return { overlay: preview(s) };
          }
          points = roomPoints(from, s.point);
          return finish(true);
        }
        case 'leave':
          return points.length === 0 && roomFrom === null ? { overlay: null } : {};
      }
    },
    onAction(action) {
      if (action === 'confirm' && points.length >= 2) return finish(false);
      return {};
    },
    cancel() {
      points = [];
      roomFrom = null;
      dbl.reset();
      return { overlay: null };
    },
    deactivate() {
      return this.cancel();
    },
  };
}
