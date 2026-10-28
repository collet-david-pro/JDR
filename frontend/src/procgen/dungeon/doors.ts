/** Room/corridor junctions: openings on the room borders, door-eligible when corridor-wide. */
import type { Point2 } from '../geometry';
import type { BitGrid } from '../grid';
import type { Rect } from './layout';

export interface Junction {
  room: number;
  /** Ends of the opening on the room border line. */
  a: Point2;
  b: Point2;
  /** Cell just outside the room, in front of the opening's first cell. */
  outside: [number, number];
  /** Narrow enough (≤ corridor width) and framed by walls at both ends: may hold a door. */
  doorable: boolean;
}

/** A border vertex touches a wall when the four cells around it are not all floor. */
function touchesWall(floor: BitGrid, px: number, py: number): boolean {
  return (
    floor.get(px - 1, py - 1) === 0 ||
    floor.get(px, py - 1) === 0 ||
    floor.get(px - 1, py) === 0 ||
    floor.get(px, py) === 0
  );
}

/**
 * Openings of every room: maximal runs of floor cells just outside a side of its rectangle
 * (sides in order top, right, bottom, left; runs in increasing coordinate).
 */
export function findJunctions(
  floor: BitGrid,
  rooms: readonly Rect[],
  corridor: number,
): Junction[] {
  const out: Junction[] = [];
  rooms.forEach((r, room) => {
    const sides: {
      len: number;
      cell: (t: number) => [number, number];
      line: (t: number) => Point2;
    }[] = [
      { len: r.w, cell: (t) => [r.x + t, r.y - 1], line: (t) => [r.x + t, r.y] },
      { len: r.h, cell: (t) => [r.x + r.w, r.y + t], line: (t) => [r.x + r.w, r.y + t] },
      { len: r.w, cell: (t) => [r.x + t, r.y + r.h], line: (t) => [r.x + t, r.y + r.h] },
      { len: r.h, cell: (t) => [r.x - 1, r.y + t], line: (t) => [r.x, r.y + t] },
    ];
    for (const side of sides) {
      let t = 0;
      while (t < side.len) {
        const [cx, cy] = side.cell(t);
        if (floor.get(cx, cy) === 0) {
          t++;
          continue;
        }
        const t0 = t;
        while (t < side.len && floor.get(...side.cell(t)) !== 0) t++;
        const a = side.line(t0);
        const b = side.line(t);
        out.push({
          room,
          a,
          b,
          outside: [cx, cy],
          doorable:
            t - t0 <= corridor && touchesWall(floor, a[0], a[1]) && touchesWall(floor, b[0], b[1]),
        });
      }
    }
  });
  return out;
}
