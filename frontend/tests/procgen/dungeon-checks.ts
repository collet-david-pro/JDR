/** Structural checks shared by the dungeon tests (connectivity, doors, walls). */
import { BitGrid, bfsDistances, components } from '../../src/procgen/grid';
import { packKey } from '../../src/procgen/pack-keys';
import { doorFrontCells } from '../../src/procgen/populate';
import type { GenFloor } from '../../src/procgen/types';

export function floorMask(f: GenFloor, w: number, h: number): BitGrid {
  const g = new BitGrid(w, h);
  for (const c of f.ground) g.set(c.x, c.y, 1);
  return g;
}

/** Number of 4-connected components of the floor. */
export function floorComponents(f: GenFloor, w: number, h: number): number {
  return components(floorMask(f, w, h), (v) => v !== 0).sizes.length;
}

/** Doors whose front cells cannot be reached from the entrance without crossing blocking decor. */
export function blockedDoors(f: GenFloor, w: number, h: number): number {
  const mask = floorMask(f, w, h);
  const blocked = new Uint8Array(w * h);
  for (const d of f.decor) if (packKey(d.key).blocking) blocked[d.y * w + d.x] = 1;
  const free = (x: number, y: number): boolean => mask.get(x, y) !== 0 && blocked[y * w + x] === 0;
  const dist = bfsDistances(mask, free, [f.entrance!]);
  let bad = 0;
  for (const door of f.doors) {
    if (doorFrontCells(mask, door).some(([x, y]) => dist[y * w + x] === -1)) bad++;
  }
  return bad;
}

type Seg = [[number, number], [number, number]];

function wallSegments(f: GenFloor): Seg[] {
  const out: Seg[] = [];
  for (const wall of f.walls) {
    const p = wall.points;
    for (let i = 0; i + 1 < p.length; i++) out.push([p[i]!, p[i + 1]!]);
    if (wall.closed && p.length > 1) out.push([p[p.length - 1]!, p[0]!]);
  }
  return out;
}

const onSeg = (pt: readonly [number, number], [a, b]: Seg): boolean =>
  (a[0] === b[0] &&
    pt[0] === a[0] &&
    pt[1] >= Math.min(a[1], b[1]) &&
    pt[1] <= Math.max(a[1], b[1])) ||
  (a[1] === b[1] &&
    pt[1] === a[1] &&
    pt[0] >= Math.min(a[0], b[0]) &&
    pt[0] <= Math.max(a[0], b[0]));

function overlaps([a, b]: Seg, [c, d]: Seg): boolean {
  if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1]) {
    const lo = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
    const hi = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]));
    return hi > lo;
  }
  if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0]) {
    const lo = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
    const hi = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
    return hi > lo;
  }
  return false;
}

/** Problems between walls and doors: overlaps, and door ends that touch no wall. */
export function wallDoorProblems(f: GenFloor): string[] {
  const segs = wallSegments(f);
  const out: string[] = [];
  for (const door of f.doors) {
    const ds: Seg = [door.a, door.b];
    if (segs.some((s) => overlaps(s, ds))) out.push(`wall over door ${JSON.stringify(ds)}`);
    for (const end of [door.a, door.b]) {
      if (!segs.some((s) => onSeg(end, s))) out.push(`door end ${JSON.stringify(end)} off walls`);
    }
  }
  return out;
}
