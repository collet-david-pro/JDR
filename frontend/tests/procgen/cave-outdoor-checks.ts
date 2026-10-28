/** Structural checks shared by the cave and outdoor tests. */
import { BitGrid, components } from '../../src/procgen/grid';
import { isPackKey, packKey } from '../../src/procgen/pack-keys';
import type { GenCell, GenFloor, GenResult } from '../../src/procgen/types';

export function floorMask(f: GenFloor, w: number, h: number): BitGrid {
  const g = new BitGrid(w, h);
  for (const c of f.ground) g.set(c.x, c.y, 1);
  return g;
}

export function componentCount(mask: BitGrid): number {
  return components(mask, (v) => v !== 0).sizes.length;
}

const BLOCKING_TERRAIN = new Set(['terrain.lava', 'terrain.deep_water']);

/** Floor components once the blocking decor and the blocking terrain are removed. */
export function walkableComponents(f: GenFloor, w: number, h: number): number {
  const g = floorMask(f, w, h);
  for (const d of f.decor) if (packKey(d.key).blocking) g.set(d.x, d.y, 0);
  for (const t of f.terrain) if (BLOCKING_TERRAIN.has(t.key)) g.set(t.x, t.y, 0);
  return componentCount(g);
}

/** Problems about keys, bounds and duplicates of every cell layer. */
export function cellProblems(r: GenResult): string[] {
  const out: string[] = [];
  const f = r.floors[0]!;
  const layers: [string, GenCell[]][] = [
    ['ground', f.ground],
    ['terrain', f.terrain],
    ['decor', f.decor],
  ];
  for (const [name, cells] of layers) {
    const seen = new Set<number>();
    for (const c of cells) {
      if (!isPackKey(c.key)) out.push(`${name}: unknown key ${c.key}`);
      if (c.x < 0 || c.y < 0 || c.x >= r.width || c.y >= r.height) out.push(`${name}: out of grid`);
      const k = c.y * r.width + c.x;
      if (seen.has(k)) out.push(`${name}: duplicate cell ${c.x},${c.y}`);
      seen.add(k);
    }
  }
  return out;
}

type Seg = [[number, number], [number, number]];

export function wallSegments(f: GenFloor): Seg[] {
  const out: Seg[] = [];
  for (const wall of f.walls) {
    const p = wall.points;
    for (let i = 0; i + 1 < p.length; i++) out.push([p[i]!, p[i + 1]!]);
    if (wall.closed && p.length > 1) out.push([p[p.length - 1]!, p[0]!]);
  }
  return out;
}

/** Wall points outside the rectangle, and segments lying on the outer edge of an opening. */
export function zoneWallProblems(
  f: GenFloor,
  w: number,
  h: number,
  openings: [number, number][],
): string[] {
  const out: string[] = [];
  for (const wall of f.walls) {
    for (const [x, y] of wall.points) {
      if (x < 0 || y < 0 || x > w || y > h) out.push(`point out of rect ${x},${y}`);
    }
  }
  for (const [a, b] of wallSegments(f)) {
    for (const [ox, oy] of openings) {
      const edges: Seg[] = [];
      if (oy === 0)
        edges.push([
          [ox, 0],
          [ox + 1, 0],
        ]);
      if (oy === h - 1)
        edges.push([
          [ox, h],
          [ox + 1, h],
        ]);
      if (ox === 0)
        edges.push([
          [0, oy],
          [0, oy + 1],
        ]);
      if (ox === w - 1)
        edges.push([
          [w, oy],
          [w, oy + 1],
        ]);
      for (const [e0, e1] of edges) {
        const horizontal = e0[1] === e1[1];
        const i = horizontal ? 1 : 0;
        const j = horizontal ? 0 : 1;
        if (a[i] !== e0[i] || b[i] !== e0[i]) continue;
        const lo = Math.max(Math.min(a[j], b[j]), Math.min(e0[j], e1[j]));
        const hi = Math.min(Math.max(a[j], b[j]), Math.max(e0[j], e1[j]));
        if (hi > lo) out.push(`wall on the outer edge of opening ${ox},${oy}`);
      }
    }
  }
  return out;
}
