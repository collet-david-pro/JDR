import { describe, expect, it } from 'vitest';
import { maskOutline } from '../../src/procgen/geometry';
import { BitGrid, components } from '../../src/procgen/grid';
import { connectOpenings, dropOpeningWalls, zoneOpenings } from '../../src/procgen/zone';

function rect(mask: BitGrid, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask.set(x, y, 1);
}

describe('zoneOpenings', () => {
  it('keeps border cells only, sorted and without duplicates', () => {
    const zone = {
      width: 10,
      height: 8,
      openings: [
        [5, 7],
        [0, 3],
        [4, 4],
        [0, 3],
        [10, 0],
        [9, 0],
        [2.5, 0],
      ] as [number, number][],
    };
    expect(zoneOpenings(zone, 10, 8)).toEqual([
      [9, 0],
      [0, 3],
      [5, 7],
    ]);
    expect(zoneOpenings(undefined, 10, 8)).toEqual([]);
  });
});

describe('connectOpenings', () => {
  it('connects every opening to the floor network without running along the border', () => {
    const mask = new BitGrid(12, 10);
    rect(mask, 4, 3, 7, 6);
    const openings: [number, number][] = [
      [0, 1],
      [11, 8],
      [6, 0],
    ];
    const carved = connectOpenings(mask, openings);
    expect(carved).toBeGreaterThan(0);
    const { sizes } = components(mask, (v) => v !== 0);
    expect(sizes.length).toBe(1);
    for (let x = 0; x < 12; x++) {
      for (const y of [0, 9])
        if (mask.get(x, y) !== 0)
          expect(openings.some(([ox, oy]) => ox === x && oy === y)).toBe(true);
    }
  });

  it('links the openings together when there is no floor', () => {
    const mask = new BitGrid(8, 8);
    connectOpenings(mask, [
      [0, 2],
      [7, 5],
    ]);
    expect(components(mask, (v) => v !== 0).sizes.length).toBe(1);
  });
});

describe('dropOpeningWalls', () => {
  it('removes the border edges of the openings and keeps the rest', () => {
    const mask = new BitGrid(6, 4);
    rect(mask, 0, 0, 5, 3);
    const openings: [number, number][] = [
      [2, 0],
      [5, 1],
    ];
    const segs = dropOpeningWalls(maskOutline(mask), openings, 6, 4);
    const length = segs.reduce(
      (n, s) => n + Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]),
      0,
    );
    expect(length).toBe(2 * (6 + 4) - 2);
    expect(segs).toContainEqual({ a: [0, 0], b: [2, 0] });
    expect(segs).toContainEqual({ a: [3, 0], b: [6, 0] });
    expect(dropOpeningWalls(maskOutline(mask), [], 6, 4)).toEqual(maskOutline(mask));
  });
});

describe('connectOpenings at the corners', () => {
  it('connects an opening in each corner', () => {
    const mask = new BitGrid(10, 8);
    rect(mask, 3, 3, 6, 5);
    const corners: [number, number][] = [
      [0, 0],
      [9, 0],
      [0, 7],
      [9, 7],
    ];
    connectOpenings(mask, corners);
    expect(components(mask, (v) => v !== 0).sizes.length).toBe(1);
    for (const [x, y] of corners) expect(mask.get(x, y)).toBe(1);
  });
});

describe('connectOpenings regressions', () => {
  it('never aims at a border goal it cannot reach', () => {
    const openings: [number, number][] = [
      [9, 0],
      [11, 0],
      [11, 2],
      [0, 8],
      [11, 7],
    ];
    for (const filled of [false, true]) {
      const mask = new BitGrid(12, 12);
      if (filled) rect(mask, 3, 4, 7, 9);
      connectOpenings(mask, openings);
      expect(components(mask, (v) => v !== 0).sizes.length).toBe(1);
      for (const [x, y] of openings) expect(mask.get(x, y)).toBe(1);
    }
  });
});
