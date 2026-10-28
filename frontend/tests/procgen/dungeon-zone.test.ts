import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dungeonGenerator } from '../../src/procgen/dungeon';
import { Rng } from '../../src/procgen/prng';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import { blockedDoors, floorComponents, floorMask, wallDoorProblems } from './dungeon-checks';

beforeAll(() => registerGenerator(dungeonGenerator));
afterAll(() => unregisterGenerator('dungeon'));

const SIZES: [number, number][] = [
  [12, 12],
  [20, 30],
  [40, 40],
];

function randomOpenings(rng: Rng, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  const n = rng.int(1, 6);
  for (let i = 0; i < n; i++) {
    const side = rng.int(0, 3);
    if (side === 0) out.push([rng.int(0, w - 1), 0]);
    else if (side === 1) out.push([rng.int(0, w - 1), h - 1]);
    else if (side === 2) out.push([0, rng.int(0, h - 1)]);
    else out.push([w - 1, rng.int(0, h - 1)]);
  }
  return out;
}

/** Wall edges lying on the outer border of an opening cell. */
function wallOnOpening(
  walls: { points: [number, number][]; closed: boolean }[],
  openings: [number, number][],
  w: number,
  h: number,
): number {
  let bad = 0;
  const edges: [[number, number], [number, number]][] = [];
  for (const wl of walls) {
    const p = wl.points;
    for (let i = 0; i + 1 < p.length; i++) edges.push([p[i]!, p[i + 1]!]);
    if (wl.closed) edges.push([p[p.length - 1]!, p[0]!]);
  }
  for (const [x, y] of openings) {
    const sides: [[number, number], [number, number]][] = [];
    if (y === 0)
      sides.push([
        [x, 0],
        [x + 1, 0],
      ]);
    if (y === h - 1)
      sides.push([
        [x, h],
        [x + 1, h],
      ]);
    if (x === 0)
      sides.push([
        [0, y],
        [0, y + 1],
      ]);
    if (x === w - 1)
      sides.push([
        [w, y],
        [w, y + 1],
      ]);
    for (const [a, b] of sides) {
      for (const [c, d] of edges) {
        const horiz = a[1] === b[1] && c[1] === d[1] && c[1] === a[1];
        const vert = a[0] === b[0] && c[0] === d[0] && c[0] === a[0];
        if (horiz && Math.min(Math.max(c[0], d[0]), b[0]) > Math.max(Math.min(c[0], d[0]), a[0]))
          bad++;
        if (vert && Math.min(Math.max(c[1], d[1]), b[1]) > Math.max(Math.min(c[1], d[1]), a[1]))
          bad++;
      }
    }
  }
  return bad;
}

describe('dungeon zone mode', () => {
  for (const [w, h] of SIZES) {
    it(`${w}x${h}: 200 seeds, openings connected, walls inside, no stairs`, () => {
      const ro = new Rng(`zone-openings/${w}x${h}`);
      for (let s = 0; s < 200; s++) {
        const openings = randomOpenings(ro, w, h);
        const seed = `z-${w}x${h}-${s}`;
        const r = runGenerator(
          'dungeon',
          1,
          seed,
          { width: 99, height: 77 },
          {
            zone: { width: w, height: h, openings },
          },
        );
        const f = r.floors[0]!;
        expect([r.width, r.height]).toEqual([w, h]);
        const mask = floorMask(f, w, h);
        expect(f.ground.length, seed).toBeGreaterThan(0);
        expect(floorComponents(f, w, h), seed).toBe(1);
        for (const [x, y] of openings) expect(mask.get(x, y), `${seed} opening`).toBe(1);
        for (const wl of f.walls) {
          for (const [x, y] of wl.points) {
            expect(x >= 0 && x <= w && y >= 0 && y <= h, seed).toBe(true);
          }
        }
        expect(wallOnOpening(f.walls, openings, w, h), seed).toBe(0);
        expect(wallDoorProblems(f), seed).toEqual([]);
        expect(f.entrance).toBeNull();
        expect(f.exit).toBeNull();
        expect(
          f.decor.some((d) => d.key.startsWith('decor.stairs')),
          seed,
        ).toBe(false);
        expect(
          f.rooms.every((rm) => rm.kind !== 'entrance' && rm.kind !== 'exit'),
          seed,
        ).toBe(true);
        expect(f.rooms.length).toBeLessThanOrEqual(Math.max(1, Math.floor((w * h) / 25)));
        // No door blocked: reach every door from the first opening.
        const f2 = { ...f, entrance: openings[0]! };
        expect(blockedDoors(f2, w, h), seed).toBe(0);
      }
    });
  }

  it('connects openings placed in the four corners', () => {
    for (const [w, h] of SIZES) {
      const openings: [number, number][] = [
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
      ];
      for (let s = 0; s < 50; s++) {
        const r = runGenerator(
          'dungeon',
          1,
          `corner-${s}`,
          {},
          { zone: { width: w, height: h, openings } },
        );
        const f = r.floors[0]!;
        const mask = floorMask(f, w, h);
        for (const [x, y] of openings) expect(mask.get(x, y)).toBe(1);
        expect(floorComponents(f, w, h), `corner-${s}`).toBe(1);
        expect(wallOnOpening(f.walls, openings, w, h)).toBe(0);
      }
    }
  });

  it('rejects zones that are too small or too large', () => {
    const run = (width: number, height: number) =>
      runGenerator('dungeon', 1, 'x', {}, { zone: { width, height, openings: [] } });
    expect(() => run(7, 20)).toThrow('zone_too_small');
    expect(() => run(20, 401)).toThrow('zone_too_small');
    expect(() => run(8, 8)).not.toThrow();
  });

  it('is deterministic and works without openings', () => {
    const z = { width: 30, height: 30, openings: [] as [number, number][] };
    const a = runGenerator('dungeon', 1, 'same', {}, { zone: z });
    const b = runGenerator('dungeon', 1, 'same', {}, { zone: z });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(floorComponents(a.floors[0]!, 30, 30)).toBe(1);
  });
});
