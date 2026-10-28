import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dungeonGenerator } from '../../src/procgen/dungeon';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import { blockedDoors, floorComponents, wallDoorProblems } from './dungeon-checks';

beforeAll(() => registerGenerator(dungeonGenerator));
afterAll(() => unregisterGenerator('dungeon'));

const SEEDS = 1000;
/** Default parameters, room count adjusted to the size (D9). */
const SIZES = [
  { width: 30, height: 30, rooms: 6 },
  { width: 60, height: 60, rooms: 14 },
  { width: 100, height: 100, rooms: 30 },
];

describe('dungeon connectivity (D9)', () => {
  for (const size of SIZES) {
    it(`${SEEDS} seeds at ${size.width}×${size.height}: connected floor, no blocked door`, () => {
      const t0 = performance.now();
      const failures: string[] = [];
      let repairs = 0;
      for (let s = 0; s < SEEDS; s++) {
        const seed = `c${size.width}-${s}`;
        const r = runGenerator('dungeon', 1, seed, size);
        const f = r.floors[0]!;
        repairs += r.stats['repairs']!;
        if (floorComponents(f, r.width, r.height) !== 1) failures.push(`${seed}: split floor`);
        if (blockedDoors(f, r.width, r.height) !== 0) failures.push(`${seed}: blocked door`);
        if (wallDoorProblems(f).length > 0) failures.push(`${seed}: wall/door`);
        if (f.entrance![0] === f.exit![0] && f.entrance![1] === f.exit![1]) {
          failures.push(`${seed}: entrance = exit`);
        }
      }
      console.info(
        `connectivity ${size.width}x${size.height}: ${SEEDS} seeds in ${(performance.now() - t0).toFixed(0)} ms, ${repairs} repairs`,
      );
      expect(failures).toEqual([]);
      expect(repairs).toBe(0);
    }, 60_000);
  }
});
