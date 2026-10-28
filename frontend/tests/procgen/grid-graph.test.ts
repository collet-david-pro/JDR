import { describe, expect, it } from 'vitest';
import {
  BitGrid,
  Grid,
  bfsDistances,
  components,
  farthestPair,
  floodFill,
} from '../../src/procgen/grid';
import { UnionFind, astar, kruskal } from '../../src/procgen/graph';
import { createRng } from '../../src/procgen/prng';

function fromRows(rows: string[]): BitGrid {
  const g = new BitGrid(rows[0]!.length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => g.set(x, y, c === '#' ? 0 : 1)));
  return g;
}

describe('grids', () => {
  it('BitGrid basics', () => {
    const g = new BitGrid(4, 3);
    g.set(1, 1, 1);
    g.set(9, 9, 1);
    expect(g.get(1, 1)).toBe(1);
    expect(g.get(-1, 0)).toBe(0);
    expect(g.inBounds(3, 2)).toBe(true);
    expect(g.inBounds(4, 2)).toBe(false);
    expect(g.count()).toBe(1);
    const c = g.clone();
    c.fill(1);
    expect(c.count()).toBe(12);
    expect(g.count()).toBe(1);
    const gg = new Grid<string>(2, 2, 'a');
    gg.set(1, 0, 'b');
    expect(gg.get(1, 0)).toBe('b');
    expect(gg.get(2, 0)).toBeUndefined();
    expect(gg.clone().data).toEqual(['a', 'b', 'a', 'a']);
  });

  it('components, 4 and 8 connectivity', () => {
    const g = fromRows(['.#.', '#.#', '.#.']);
    const c4 = components(g, (v) => v === 1, 4);
    expect(c4.sizes).toEqual([1, 1, 1, 1, 1]);
    const c8 = components(g, (v) => v === 1, 8);
    expect(c8.sizes).toEqual([5]);
    expect(c8.labels[1]).toBe(-1);
    const h = fromRows(['..#..', '..#..', '#####', '...#.']);
    const c = components(h, (v) => v === 1);
    expect(c.sizes).toEqual([4, 4, 3, 1]);
  });

  it('floodFill and bfsDistances', () => {
    const g = fromRows(['..#..', '..#..', '.....']);
    const pass = (x: number, y: number): boolean => g.get(x, y) === 1;
    expect(floodFill(g, 0, 0, pass).length).toBe(13);
    expect(floodFill(g, 2, 0, pass)).toEqual([]);
    const d = bfsDistances(g, pass, [[0, 0]]);
    expect(d[0]).toBe(0);
    expect(d[4]).toBe(2 + 4 + 2);
    expect(d[2]).toBe(-1);
    const two = bfsDistances(g, pass, [
      [0, 0],
      [4, 0],
    ]);
    expect(two[4]).toBe(0);
    expect(two[10]).toBe(2);
  });

  it('farthestPair on a corridor', () => {
    const g = fromRows(['.......']);
    const p = farthestPair(g, (x, y) => g.get(x, y) === 1, [3, 0])!;
    expect(p.dist).toBe(6);
    expect(p.a).toEqual([0, 0]);
    expect(p.b).toEqual([6, 0]);
    expect(farthestPair(g, () => false, [3, 0])).toBeNull();
  });
});

describe('graph', () => {
  it('UnionFind', () => {
    const uf = new UnionFind(5);
    expect(uf.union(0, 1)).toBe(true);
    expect(uf.union(1, 0)).toBe(false);
    uf.union(3, 4);
    expect(uf.count).toBe(3);
    expect(uf.connected(0, 1)).toBe(true);
    expect(uf.connected(0, 3)).toBe(false);
  });

  it('kruskal builds a minimum spanning tree with stable ties', () => {
    const edges = [
      { a: 0, b: 1, w: 7 },
      { a: 0, b: 3, w: 5 },
      { a: 1, b: 2, w: 8 },
      { a: 1, b: 3, w: 9 },
      { a: 1, b: 4, w: 7 },
      { a: 2, b: 4, w: 5 },
      { a: 3, b: 4, w: 15 },
      { a: 3, b: 5, w: 6 },
      { a: 4, b: 5, w: 8 },
      { a: 4, b: 6, w: 9 },
      { a: 5, b: 6, w: 11 },
    ];
    const t = kruskal(7, edges);
    expect(t.length).toBe(6);
    expect(t.reduce((s, e) => s + e.w, 0)).toBe(39);
    expect(kruskal(7, [...edges].reverse())).toEqual(t);
    const ties = kruskal(3, [
      { a: 1, b: 2, w: 1 },
      { a: 0, b: 2, w: 1 },
      { a: 0, b: 1, w: 1 },
    ]);
    expect(ties).toEqual([
      { a: 0, b: 1, w: 1 },
      { a: 0, b: 2, w: 1 },
    ]);
  });

  it('astar is optimal against BFS and deterministic', () => {
    const rng = createRng('astar', 'x', 1);
    for (let t = 0; t < 30; t++) {
      const g = new BitGrid(12, 12);
      for (let i = 0; i < g.data.length; i++) g.data[i] = rng.chance(0.7) ? 1 : 0;
      g.set(0, 0, 1);
      g.set(11, 11, 1);
      const pass = (x: number, y: number): boolean => g.get(x, y) === 1;
      const bfs = bfsDistances(g, pass, [[0, 0]])[11 * 12 + 11]!;
      const path = astar(12, 12, (x, y) => (pass(x, y) ? 1 : Infinity), [0, 0], [11, 11]);
      if (bfs === -1) expect(path).toBeNull();
      else {
        expect(path!.length - 1).toBe(bfs);
        expect(path![0]).toEqual([0, 0]);
        expect(path!.at(-1)).toEqual([11, 11]);
        for (const [x, y] of path!) expect(pass(x, y)).toBe(true);
        expect(astar(12, 12, (x, y) => (pass(x, y) ? 1 : Infinity), [0, 0], [11, 11])).toEqual(
          path,
        );
      }
    }
  });

  it('astar avoids costly cells and supports diagonals', () => {
    const cost = (x: number, y: number): number => (x === 1 && y < 2 ? 50 : 1);
    const p = astar(3, 3, cost, [0, 0], [2, 0])!;
    expect(p.some(([x, y]) => x === 1 && y < 2)).toBe(false);
    const d = astar(5, 5, () => 1, [0, 0], [4, 4], { diagonal: true })!;
    expect(d.length).toBe(5);
    expect(astar(3, 3, () => Infinity, [0, 0], [2, 2])).toBeNull();
  });
});
