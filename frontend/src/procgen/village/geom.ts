/** Small grid-geometry helpers of the village generator (cell rectangles, sides, unit edges). */
import type { Segment } from '../geometry';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Side of a rectangle. */
export type Side = 'N' | 'E' | 'S' | 'W';
export type Cell = [number, number];

/** Directions N, E, S, W (y down). */
export const DIRS: readonly Cell[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Side facing the road for a building lying in direction d from the road. */
export function frontSideOf(d: readonly [number, number]): Side {
  if (d[1] > 0) return 'N';
  if (d[1] < 0) return 'S';
  return d[0] > 0 ? 'W' : 'E';
}

/** Coordinate of the border line of a side. */
export function sideLine(r: Rect, side: Side): number {
  if (side === 'N') return r.y;
  if (side === 'S') return r.y + r.h;
  if (side === 'W') return r.x;
  return r.x + r.w;
}

/** Unit edges of a side, in increasing coordinate. */
export function sideUnits(r: Rect, side: Side): Segment[] {
  const out: Segment[] = [];
  if (side === 'N' || side === 'S') {
    const y = sideLine(r, side);
    for (let x = r.x; x < r.x + r.w; x++) out.push({ a: [x, y], b: [x + 1, y] });
  } else {
    const x = sideLine(r, side);
    for (let y = r.y; y < r.y + r.h; y++) out.push({ a: [x, y], b: [x, y + 1] });
  }
  return out;
}

/** Cell just inside the rectangle for a unit edge of the given side. */
export function insideCell(u: Segment, side: Side): Cell {
  const [x, y] = u.a;
  if (side === 'S') return [x, y - 1];
  if (side === 'E') return [x - 1, y];
  return [x, y];
}

/** Opposite side's cell offset: the cell outside a unit edge of the given side. */
export function outsideCell(u: Segment, side: Side): Cell {
  const [x, y] = u.a;
  if (side === 'N') return [x, y - 1];
  if (side === 'W') return [x - 1, y];
  return [x, y];
}

/** Key of a unit edge (orientation + start), unique on a map of at most 1000 cells a side. */
export function unitKey(u: Segment): number {
  const horizontal = u.a[1] === u.b[1];
  return (u.a[1] * 1024 + u.a[0]) * 2 + (horizontal ? 0 : 1);
}

/** Previous and next unit edges on the same line. */
export function unitNeighbours(u: Segment): [Segment, Segment] {
  const [x, y] = u.a;
  if (u.a[1] === u.b[1]) {
    return [
      { a: [x - 1, y], b: [x, y] },
      { a: [x + 1, y], b: [x + 2, y] },
    ];
  }
  return [
    { a: [x, y - 1], b: [x, y] },
    { a: [x, y + 1], b: [x, y + 2] },
  ];
}

export const rectCells = (r: Rect): Cell[] => {
  const out: Cell[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push([x, y]);
  return out;
};
