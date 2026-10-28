/** Wall cutting: removes the openings (doors, windows) from wall segments, as the editor does. */
import type { Segment } from '../geometry';

/**
 * Cuts axis-aligned wall segments around the openings (axis-aligned segments lying on cell
 * borders). Every part of a wall covered by an opening is removed; the remaining pieces keep the
 * direction of their segment and the order of travel, so each opening end touches a wall end
 * (or the outside). Segments not touched by an opening are returned unchanged.
 */
export function cutWalls(segments: readonly Segment[], openings: readonly Segment[]): Segment[] {
  const byLine = new Map<string, [number, number][]>();
  for (const o of openings) {
    const [ax, ay] = o.a;
    const [bx, by] = o.b;
    let key: string;
    let iv: [number, number];
    if (ay === by && ax !== bx) {
      key = `h${ay}`;
      iv = [Math.min(ax, bx), Math.max(ax, bx)];
    } else if (ax === bx && ay !== by) {
      key = `v${ax}`;
      iv = [Math.min(ay, by), Math.max(ay, by)];
    } else continue;
    const list = byLine.get(key);
    if (list === undefined) byLine.set(key, [iv]);
    else list.push(iv);
  }
  for (const list of byLine.values()) list.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out: Segment[] = [];
  for (const s of segments) {
    const [ax, ay] = s.a;
    const [bx, by] = s.b;
    const horizontal = ay === by && ax !== bx;
    const vertical = ax === bx && ay !== by;
    if (!horizontal && !vertical) {
      out.push(s);
      continue;
    }
    const line = horizontal ? ay : ax;
    const from = horizontal ? ax : ay;
    const to = horizontal ? bx : by;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const list = byLine.get(`${horizontal ? 'h' : 'v'}${line}`);
    if (list === undefined) {
      out.push(s);
      continue;
    }
    const pieces: [number, number][] = [];
    let cursor = lo;
    for (const [ol, oh] of list) {
      if (oh <= cursor) continue;
      if (ol >= hi) break;
      if (ol > cursor) pieces.push([cursor, ol]);
      cursor = Math.max(cursor, oh);
    }
    if (cursor < hi) pieces.push([cursor, hi]);
    if (pieces.length === 1 && pieces[0]![0] === lo && pieces[0]![1] === hi) {
      out.push(s);
      continue;
    }
    const forward = to >= from;
    if (!forward) pieces.reverse();
    for (const [p0, p1] of pieces) {
      const [s0, s1] = forward ? [p0, p1] : [p1, p0];
      out.push(horizontal ? { a: [s0, line], b: [s1, line] } : { a: [line, s0], b: [line, s1] });
    }
  }
  return out;
}
