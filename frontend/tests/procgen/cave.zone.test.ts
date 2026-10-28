import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caveGenerator } from '../../src/procgen/cave';
import { fingerprint } from '../../src/procgen/canonical';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import { Rng } from '../../src/procgen/prng';
import {
  componentCount,
  floorMask,
  walkableComponents,
  zoneWallProblems,
} from './cave-outdoor-checks';

beforeAll(() => registerGenerator(caveGenerator));
afterAll(() => unregisterGenerator('cave'));

/** Random openings on the 4 borders (a mix of isolated cells and runs, corners included). */
function randomOpenings(rng: Rng, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  const n = rng.int(1, 8);
  for (let i = 0; i < n; i++) {
    const side = rng.int(0, 3);
    const run = rng.int(1, 4);
    const base = side < 2 ? rng.int(0, w - 1) : rng.int(0, h - 1);
    for (let k = 0; k < run; k++) {
      const t = base + k;
      if (side === 0 && t < w) out.push([t, 0]);
      if (side === 1 && t < w) out.push([t, h - 1]);
      if (side === 2 && t < h) out.push([0, t]);
      if (side === 3 && t < h) out.push([w - 1, t]);
    }
  }
  return out;
}

describe('cave zone generation (D11)', () => {
  it('100 seeds with random openings: floor linked, walls clipped, no stairs', () => {
    const failures: string[] = [];
    for (let s = 0; s < 100; s++) {
      const rng = new Rng(`zone-open-${s}`);
      const w = rng.int(8, 60);
      const h = rng.int(8, 60);
      const openings = randomOpenings(rng, w, h);
      const theme = (['rock', 'ice', 'lava'] as const)[s % 3]!;
      const r = runGenerator(
        'cave',
        1,
        `zone-${s}`,
        { theme, decor: 1, width: 99, height: 99 },
        { zone: { width: w, height: h, openings } },
      );
      const f = r.floors[0]!;
      if (r.width !== w || r.height !== h) failures.push(`${s}: size`);
      const mask = floorMask(f, w, h);
      for (const [x, y] of openings)
        if (mask.get(x, y) === 0) failures.push(`${s}: opening ${x},${y} is not floor`);
      if (componentCount(mask) !== 1) failures.push(`${s}: split floor`);
      if (walkableComponents(f, w, h) !== 1) failures.push(`${s}: blocked floor`);
      const problems = zoneWallProblems(f, w, h, openings);
      if (problems.length > 0) failures.push(`${s}: ${problems[0]}`);
      if (f.entrance !== null || f.exit !== null) failures.push(`${s}: entrance/exit`);
      if (f.decor.some((d) => d.key.startsWith('decor.stairs'))) failures.push(`${s}: stairs`);
      for (const c of f.decor) {
        if (
          openings.some(([x, y]) => x === c.x && y === c.y) &&
          c.key !== 'decor.mushroom' &&
          !['decor.rubble', 'decor.puddle', 'decor.web'].includes(c.key)
        ) {
          failures.push(`${s}: blocking decor on an opening`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('works without openings (zone = free generation of the zone size)', () => {
    const r = runGenerator('cave', 1, 'z0', {}, { zone: { width: 30, height: 20, openings: [] } });
    expect([r.width, r.height]).toEqual([30, 20]);
    expect(componentCount(floorMask(r.floors[0]!, 30, 20))).toBe(1);
  });

  it('is deterministic', async () => {
    const zone = {
      width: 24,
      height: 24,
      openings: [
        [0, 5],
        [10, 23],
      ] as [number, number][],
    };
    const a = await fingerprint(runGenerator('cave', 1, 'zd', {}, { zone }));
    expect(await fingerprint(runGenerator('cave', 1, 'zd', {}, { zone }))).toBe(a);
  });
});
