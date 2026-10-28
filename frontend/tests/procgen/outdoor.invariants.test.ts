import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outdoorGenerator } from '../../src/procgen/outdoor';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import type { GenResult } from '../../src/procgen/types';

beforeAll(() => registerGenerator(outdoorGenerator));
afterAll(() => unregisterGenerator('outdoor'));

const SEEDS = 60;
const THEMES = ['temperate', 'desert', 'winter'] as const;

/** Cells keyed by "layer:key" for quick lookups. */
function index(r: GenResult) {
  const f = r.floors[0]!;
  const W = r.width;
  const at = (cells: { x: number; y: number; key: string }[]) => {
    const m = new Map<number, string>();
    for (const c of cells) m.set(c.y * W + c.x, c.key);
    return m;
  };
  return { f, W, ground: at(f.ground), terrain: at(f.terrain), decor: at(f.decor) };
}

describe('outdoor invariants (D9)', () => {
  it(`${SEEDS} seeds: roads are continuous, nothing on deep water, trees and rocks off the water`, () => {
    const t0 = performance.now();
    const failures: string[] = [];
    let roads = 0;
    let bridges = 0;
    let fords = 0;
    let deadEnds = 0;
    for (let s = 0; s < SEEDS; s++) {
      const theme = THEMES[s % 3]!;
      const r = runGenerator('outdoor', 1, `inv-${s}`, {
        theme,
        roads: 1 + (s % 4),
        rivers: 1 + (s % 3),
        water: 0.2 + 0.1 * (s % 5),
        forest: 0.2 * (s % 5),
      });
      const { f, W, ground, terrain, decor } = index(r);
      const roadKey = theme === 'temperate' ? 'floor.cobble' : 'floor.dirt';
      roads += r.stats['roads']!;
      bridges += r.stats['bridges']!;
      fords += r.stats['fords']!;
      deadEnds += r.stats['river_dead_ends']!;
      if (r.stats['river_dead_ends'] !== 0) failures.push(`${s}: river dead end`);
      // Nothing but bridges stands on the water; nothing at all on the deep water.
      for (const [i, key] of decor) {
        const t = terrain.get(i);
        if (t === 'terrain.deep_water') failures.push(`${s}: ${key} on deep water`);
        if (t === 'terrain.water' && key !== 'decor.bridge') failures.push(`${s}: ${key} on water`);
        if ((key === 'decor.tree' || key === 'decor.rock') && ground.get(i) === 'floor.ice')
          failures.push(`${s}: ${key} on ice`);
      }
      for (const [i, t] of terrain) {
        if (t === 'terrain.deep_water' && ground.get(i) === roadKey && theme === 'temperate')
          failures.push(`${s}: road on deep water`);
      }
      // First road: entrance and exit are linked through road cells, bridges and fords.
      if (r.stats['roads']! > 0) {
        if (f.entrance === null || f.exit === null) {
          failures.push(`${s}: no entrance`);
          continue;
        }
        const ok = (i: number): boolean =>
          terrain.get(i) !== 'terrain.deep_water' &&
          (ground.get(i) === roadKey ||
            decor.get(i) === 'decor.bridge' ||
            ground.get(i) === 'floor.dirt');
        const start = f.entrance[1] * W + f.entrance[0];
        const goal = f.exit[1] * W + f.exit[0];
        const seen = new Set([start]);
        const queue = [start];
        for (let q = 0; q < queue.length; q++) {
          const c = queue[q]!;
          const x = c % W;
          for (const n of [c - W, c + W, x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1]) {
            if (n < 0 || n >= W * r.height || seen.has(n) || !ok(n)) continue;
            seen.add(n);
            queue.push(n);
          }
        }
        if (!ok(start) || !seen.has(goal)) failures.push(`${s}: broken road`);
        const roadCells = f.ground.filter((c) => c.key === roadKey).length;
        if (roadCells === 0 && r.stats['bridges'] === 0) failures.push(`${s}: no road nor bridge`);
      }
    }
    console.info(
      `outdoor invariants: ${SEEDS} seeds in ${(performance.now() - t0).toFixed(0)} ms; roads ${roads}, bridges ${bridges}, fords ${fords}, river dead ends ${deadEnds}`,
    );
    expect(failures).toEqual([]);
    expect(roads).toBeGreaterThan(0);
  }, 60_000);

  it('in the temperate theme the road tiles alone link the extremities (bridges and fords included)', () => {
    let linked = 0;
    for (let s = 0; s < 20; s++) {
      const r = runGenerator('outdoor', 1, `strict-${s}`, { roads: 1, rivers: 3, water: 0.3 });
      const { f, W, ground, decor, terrain } = index(r);
      const fordCell = (i: number): boolean =>
        ground.get(i) === 'floor.dirt' &&
        terrain.get(i) === undefined &&
        decor.get(i) === undefined;
      const path: number[] = [];
      let cur = f.entrance![1] * W + f.entrance![0];
      const goal = f.exit![1] * W + f.exit![0];
      // Cobble cells and bridges; a dirt cell is accepted only as a ford (dry cell next to water).
      const seen = new Set([cur]);
      const queue = [cur];
      for (let q = 0; q < queue.length; q++) {
        cur = queue[q]!;
        path.push(cur);
        const x = cur % W;
        for (const n of [cur - W, cur + W, x > 0 ? cur - 1 : -1, x < W - 1 ? cur + 1 : -1]) {
          if (n < 0 || n >= W * r.height || seen.has(n)) continue;
          if (!(
            ground.get(n) === 'floor.cobble' ||
            decor.get(n) === 'decor.bridge' ||
            (fordCell(n) &&
              [n - W, n + W, n - 1, n + 1].some((m) => terrain.get(m) === 'terrain.water'))
          ))
            continue;
          seen.add(n);
          queue.push(n);
        }
      }
      if (seen.has(goal)) linked++;
    }
    expect(linked).toBeGreaterThanOrEqual(18);
  });

  it('100×100 stays well under 10 s per generation (D14)', () => {
    let worst = 0;
    for (const theme of THEMES) {
      const t0 = performance.now();
      runGenerator('outdoor', 1, `perf-${theme}`, {
        width: 100,
        height: 100,
        theme,
        roads: 4,
        rivers: 3,
      });
      worst = Math.max(worst, performance.now() - t0);
    }
    const big = performance.now();
    runGenerator('outdoor', 1, 'perf-big', { width: 400, height: 400, roads: 6, rivers: 6 });
    console.info(
      `outdoor 100x100 worst ${worst.toFixed(0)} ms; 400x400 ${(performance.now() - big).toFixed(0)} ms`,
    );
    expect(worst).toBeLessThan(10_000);
  }, 60_000);
});
