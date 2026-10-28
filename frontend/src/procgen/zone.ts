/**
 * Zone generation (D11): helpers shared by the generators that accept `ctx.zone` (dungeon, cave).
 *
 * The zone is the selected rectangle, generated in local coordinates (0..width-1, 0..height-1).
 * `openings` are cells of the rectangle border that touch existing floor just outside it: the
 * generator makes each of them floor, connects it to its network and leaves no wall between it and
 * the outside.
 */
import type { Segment } from './geometry';
import { astar } from './graph';
import type { BitGrid } from './grid';
import { floodFill } from './grid';
import type { GenContext } from './types';

export type GenZone = NonNullable<GenContext['zone']>;

/** Openings kept: on the border of the w x h rectangle, without duplicates, sorted by y then x. */
export function zoneOpenings(zone: GenZone | undefined, w: number, h: number): [number, number][] {
  if (zone === undefined) return [];
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const [x, y] of zone.openings) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w || y >= h)
      continue;
    if (x !== 0 && y !== 0 && x !== w - 1 && y !== h - 1) continue;
    const k = y * w + x;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([x, y]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/**
 * Makes every opening floor and connects it to the floor network (the component of the first
 * floor cell in scan order, or of the first opening when there is no floor), carving 1-cell
 * corridors with A* that never run along the rectangle border (a corner opening steps along it
 * once to get inside). Returns the number of carved cells.
 */
export function connectOpenings(
  mask: BitGrid,
  openings: readonly (readonly [number, number])[],
): number {
  const { w, h } = mask;
  if (openings.length === 0) return 0;
  const isOpening = new Uint8Array(w * h);
  for (const [x, y] of openings) isOpening[y * w + x] = 1;
  let start = -1;
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] !== 0) {
      start = i;
      break;
    }
  }
  const connected = new Uint8Array(w * h);
  const absorb = (x: number, y: number): void => {
    for (const [cx, cy] of floodFill(
      mask,
      x,
      y,
      (px, py) => mask.get(px, py) !== 0 && connected[py * w + px] === 0,
    )) {
      connected[cy * w + cx] = 1;
    }
  };
  let carved = 0;
  if (start >= 0) absorb(start % w, Math.floor(start / w));
  const border = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === w - 1 || y === h - 1;
  for (const [ox, oy] of openings) {
    if (mask.get(ox, oy) === 0) {
      mask.set(ox, oy, 1);
      carved++;
    }
    if (connected[oy * w + ox] !== 0) continue;
    if (start < 0) {
      start = oy * w + ox;
      absorb(ox, oy);
      continue;
    }
    // Nearest connected cell (Manhattan distance, ties in scan order).
    let goal = -1;
    let best = Infinity;
    for (let i = 0; i < connected.length; i++) {
      if (connected[i] === 0) continue;
      const d = Math.abs((i % w) - ox) + Math.abs(Math.floor(i / w) - oy);
      if (d < best) {
        best = d;
        goal = i;
      }
    }
    const corner = (ox === 0 || ox === w - 1) && (oy === 0 || oy === h - 1);
    const gx = goal % w;
    const gy = Math.floor(goal / w);
    const path = astar(
      w,
      h,
      (x, y) => {
        if ((x === ox && y === oy) || (x === gx && y === gy)) return 1;
        if (border(x, y)) {
          if (isOpening[y * w + x] !== 0) return 1;
          // A corner opening only has border neighbours: let it step along the border once.
          return corner && Math.abs(x - ox) + Math.abs(y - oy) === 1 ? 2 : Infinity;
        }
        return mask.get(x, y) !== 0 ? 1 : 2;
      },
      [ox, oy],
      [gx, gy],
    );
    if (path === null) continue;
    for (const [x, y] of path) {
      if (mask.get(x, y) === 0) {
        mask.set(x, y, 1);
        carved++;
      }
    }
    absorb(ox, oy);
  }
  return carved;
}

/**
 * Removes the wall edges that lie on the outer border of the w x h rectangle next to an opening
 * cell (the existing floor continues outside). Segments are split into unit edges there and the
 * kept runs re-merged, keeping their direction; other segments are returned unchanged.
 */
export function dropOpeningWalls(
  segments: readonly Segment[],
  openings: readonly (readonly [number, number])[],
  w: number,
  h: number,
): Segment[] {
  if (openings.length === 0) return segments.slice();
  const isOpening = new Uint8Array(w * h);
  for (const [x, y] of openings) isOpening[y * w + x] = 1;
  const open = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && isOpening[y * w + x] !== 0;
  const out: Segment[] = [];
  for (const s of segments) {
    const [ax, ay] = s.a;
    const [bx, by] = s.b;
    const horizontal = ay === by && (ay === 0 || ay === h);
    const vertical = ax === bx && (ax === 0 || ax === w);
    if (!horizontal && !vertical) {
      out.push(s);
      continue;
    }
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    const len = Math.abs(bx - ax) + Math.abs(by - ay);
    let run: [number, number] | null = null;
    for (let i = 0; i < len; i++) {
      const x0 = ax + dx * i;
      const y0 = ay + dy * i;
      // Cell inside the rectangle bounded by this unit edge.
      const cx = horizontal ? Math.min(x0, x0 + dx) : ax === 0 ? 0 : w - 1;
      const cy = vertical ? Math.min(y0, y0 + dy) : ay === 0 ? 0 : h - 1;
      if (open(cx, cy)) {
        if (run !== null) out.push({ a: run, b: [x0, y0] });
        run = null;
      } else if (run === null) {
        run = [x0, y0];
      }
    }
    if (run !== null) out.push({ a: run, b: [bx, by] });
  }
  return out;
}
