import { describe, expect, it } from 'vitest';
import {
  chainSegments,
  douglasPeucker,
  marchingSquares,
  maskOutline,
  round3,
} from '../../src/procgen/geometry';
import { BitGrid } from '../../src/procgen/grid';
import { poissonDisk } from '../../src/procgen/poisson';
import { createRng } from '../../src/procgen/prng';

function mask(rows: string[]): BitGrid {
  const g = new BitGrid(rows[0]!.length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => g.set(x, y, c === '#' ? 1 : 0)));
  return g;
}

describe('geometry', () => {
  it('outline of a square = 4 segments forming one closed polyline', () => {
    const segs = maskOutline(mask(['##', '##']));
    expect(segs.length).toBe(4);
    const lines = chainSegments(segs);
    expect(lines.length).toBe(1);
    expect(lines[0]!.closed).toBe(true);
    expect(lines[0]!.points).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });

  it('outline of an L = 6 segments, 6 vertices', () => {
    const segs = maskOutline(mask(['#..', '#..', '###']));
    expect(segs.length).toBe(6);
    const lines = chainSegments(segs);
    expect(lines.length).toBe(1);
    expect(lines[0]!.points.length).toBe(6);
  });

  it('a hole gives two closed polylines', () => {
    const lines = chainSegments(maskOutline(mask(['###', '#.#', '###'])));
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.closed)).toBe(true);
  });

  it('is stable and empty on an empty mask', () => {
    expect(maskOutline(new BitGrid(3, 3))).toEqual([]);
    const m = mask(['#.#', '...', '#.#']);
    expect(maskOutline(m)).toEqual(maskOutline(m.clone()));
    expect(chainSegments(maskOutline(m)).length).toBe(4);
  });

  it('chainSegments handles open chains', () => {
    const lines = chainSegments([
      { a: [0, 0], b: [1, 0] },
      { a: [1, 0], b: [2, 0] },
      { a: [2, 0], b: [2, 1] },
    ]);
    expect(lines).toEqual([
      {
        points: [
          [0, 0],
          [2, 0],
          [2, 1],
        ],
        closed: false,
      },
    ]);
  });

  it('douglasPeucker', () => {
    const pts: [number, number][] = [
      [0, 0],
      [1, 0.01],
      [2, -0.01],
      [3, 0],
      [3, 3],
    ];
    expect(douglasPeucker(pts, 0.1)).toEqual([
      [0, 0],
      [3, 0],
      [3, 3],
    ]);
    expect(douglasPeucker(pts, 0)).toEqual(pts);
    expect(
      douglasPeucker(
        [
          [0, 0],
          [1, 1],
        ],
        5,
      ),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('marching squares on a disc gives one closed polyline', () => {
    const n = 21;
    const f = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        f[y * n + x] = 1 - Math.sqrt((x - 10) * (x - 10) + (y - 10) * (y - 10)) / 6;
    const lines = marchingSquares(f, n, n, 0.5);
    expect(lines.length).toBe(1);
    expect(lines[0]!.closed).toBe(true);
    for (const [x, y] of lines[0]!.points) {
      const r = Math.sqrt((x - 10) * (x - 10) + (y - 10) * (y - 10));
      expect(Math.abs(r - 3)).toBeLessThan(0.2);
    }
  });

  it('marching squares on a bitmap, two blobs and a border blob', () => {
    const g = mask(['##...', '##..#', '.....', '..#..']);
    const lines = marchingSquares(g, 5, 4);
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.closed)).toBe(true);
    const saddle = marchingSquares(new Float32Array([1, 0, 0, 1]), 2, 2);
    expect(saddle.length).toBe(1);
  });

  it('round3', () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(2)).toBe(2);
  });
});

describe('poissonDisk', () => {
  it('respects the minimum distance and is deterministic', () => {
    const run = (): [number, number][] => poissonDisk(createRng('pd', 'x', 1), 40, 30, () => 3);
    const pts = run();
    expect(pts.length).toBeGreaterThan(40);
    expect(run()).toEqual(pts);
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i]![0]).toBeGreaterThanOrEqual(0);
      expect(pts[i]![0]).toBeLessThan(40);
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i]![0] - pts[j]![0];
        const dy = pts[i]![1] - pts[j]![1];
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(3 - 1e-9);
      }
    }
  });

  it('variable density, mask and maxPoints', () => {
    const rng = createRng('pd2', 'x', 1);
    const pts = poissonDisk(rng, 60, 20, (x) => (x < 30 ? 1.5 : 4));
    const left = pts.filter((p) => p[0] < 30).length;
    expect(left).toBeGreaterThan(2 * (pts.length - left));
    const m = new BitGrid(30, 30);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 10; x++) m.set(x, y, 1);
    const masked = poissonDisk(createRng('pd3', 'x', 1), 30, 30, () => 2, { mask: m });
    expect(masked.length).toBeGreaterThan(5);
    expect(masked.every((p) => p[0] < 10)).toBe(true);
    expect(poissonDisk(createRng('pd4', 'x', 1), 30, 30, () => 2, { maxPoints: 7 }).length).toBe(7);
    expect(poissonDisk(createRng('pd5', 'x', 1), 30, 30, () => 2, { mask: () => false })).toEqual(
      [],
    );
  });
});
