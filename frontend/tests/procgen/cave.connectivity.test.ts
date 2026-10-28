import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caveGenerator } from '../../src/procgen/cave';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import type { GenWall } from '../../src/procgen/types';
import { componentCount, floorMask, walkableComponents } from './cave-outdoor-checks';

beforeAll(() => registerGenerator(caveGenerator));
afterAll(() => unregisterGenerator('cave'));

const SEEDS = 200;
const SIZES = [
  { width: 40, height: 40 },
  { width: 100, height: 80 },
];
const THEMES = ['rock', 'ice', 'lava'] as const;

const wallProblem = (w: GenWall, W: number, H: number): boolean =>
  w.points.some(([x, y]) => x < 0 || y < 0 || x > W || y > H) || !w.closed;

describe('cave connectivity (D9)', () => {
  for (const size of SIZES) {
    it(`${SEEDS} seeds at ${size.width}×${size.height}: one floor component, walkable floor connected`, () => {
      const t0 = performance.now();
      const failures: string[] = [];
      for (let s = 0; s < SEEDS; s++) {
        const seed = `k${size.width}-${s}`;
        const theme = THEMES[s % 3]!;
        const r = runGenerator('cave', 1, seed, { ...size, theme, decor: 1 });
        const f = r.floors[0]!;
        if (componentCount(floorMask(f, r.width, r.height)) !== 1)
          failures.push(`${seed}: split floor`);
        if (walkableComponents(f, r.width, r.height) !== 1) failures.push(`${seed}: blocked floor`);
        if (f.entrance === null || f.exit === null) failures.push(`${seed}: no stairs`);
        else if (f.entrance[0] === f.exit[0] && f.entrance[1] === f.exit[1])
          failures.push(`${seed}: entrance = exit`);
        if (f.walls.some((w) => wallProblem(w, r.width, r.height)))
          failures.push(`${seed}: open or out-of-rect wall`);
        if (f.walls.length === 0) failures.push(`${seed}: no wall`);
      }
      console.info(
        `cave connectivity ${size.width}x${size.height}: ${SEEDS} seeds in ${(performance.now() - t0).toFixed(0)} ms`,
      );
      expect(failures).toEqual([]);
    }, 60_000);
  }

  it('100×100 stays well under 10 s per generation (D14)', () => {
    let worst = 0;
    for (const theme of THEMES) {
      const t0 = performance.now();
      runGenerator('cave', 1, `perf-${theme}`, { width: 100, height: 100, theme, decor: 1 });
      worst = Math.max(worst, performance.now() - t0);
    }
    const big = performance.now();
    runGenerator('cave', 1, 'perf-big', { width: 400, height: 400 });
    console.info(
      `cave 100x100 worst ${worst.toFixed(0)} ms; 400x400 ${(performance.now() - big).toFixed(0)} ms`,
    );
    expect(worst).toBeLessThan(10_000);
  }, 60_000);
});
