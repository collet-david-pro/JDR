import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Segment } from '../../src/procgen/geometry';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import { cutWalls, villageGenerator, VILLAGE_PRESETS } from '../../src/procgen/village';
import { validateVillage } from '../../src/procgen/village/params';
import { analyse, cutProblems } from './village-checks';

beforeAll(() => registerGenerator(villageGenerator));
afterAll(() => unregisterGenerator('village'));

const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({
  a: [ax, ay],
  b: [bx, by],
});

describe('cutWalls', () => {
  it('splits a wall around an opening and keeps the direction', () => {
    expect(cutWalls([seg(0, 2, 10, 2)], [seg(4, 2, 5, 2)])).toEqual([
      seg(0, 2, 4, 2),
      seg(5, 2, 10, 2),
    ]);
    expect(cutWalls([seg(10, 2, 0, 2)], [seg(4, 2, 5, 2)])).toEqual([
      seg(10, 2, 5, 2),
      seg(4, 2, 0, 2),
    ]);
    expect(cutWalls([seg(3, 0, 3, 6)], [seg(3, 2, 3, 3), seg(3, 4, 3, 5)])).toEqual([
      seg(3, 0, 3, 2),
      seg(3, 3, 3, 4),
      seg(3, 5, 3, 6),
    ]);
  });
  it('removes covered walls, ignores other lines and an opening at the very end', () => {
    expect(cutWalls([seg(0, 2, 3, 2)], [seg(0, 2, 3, 2)])).toEqual([]);
    expect(cutWalls([seg(0, 2, 3, 2)], [seg(0, 3, 3, 3), seg(5, 2, 6, 2)])).toEqual([
      seg(0, 2, 3, 2),
    ]);
    expect(cutWalls([seg(0, 2, 6, 2)], [seg(0, 2, 1, 2)])).toEqual([seg(1, 2, 6, 2)]);
  });
});

describe('village variants', () => {
  it('presets: structure holds', () => {
    for (const name of Object.keys(VILLAGE_PRESETS)) {
      for (let s = 0; s < 10; s++) {
        const p = validateVillage(VILLAGE_PRESETS[name]);
        const r = runGenerator('village', 1, `pre-${s}`, VILLAGE_PRESETS[name]);
        expect(analyse(r, p), `${name} ${s}`).toEqual([]);
        expect(r.stats['buildings']).toBeGreaterThan(0);
      }
    }
  });
  it('L shapes everywhere (l_shape_p = 1) keep the structure', () => {
    for (let s = 0; s < 40; s++) {
      const p = validateVillage({ l_shape_p: 1, theme: s % 2 === 0 ? 'rural' : 'town' });
      const r = runGenerator('village', 1, `ell-${s}`, p);
      expect(analyse(r, p), `ell-${s}`).toEqual([]);
    }
  });
  it('interiors: false gives one room per building and cut walls', () => {
    for (let s = 0; s < 30; s++) {
      const r = runGenerator('village', 1, `noint-${s}`, { interiors: false, l_shape_p: 0.5 });
      const f = r.floors[0]!;
      expect(f.rooms.length).toBe(r.stats['buildings']);
      expect(f.doors.length).toBe(r.stats['buildings']);
      expect(cutProblems(f), `noint-${s}`).toEqual([]);
    }
  });
  it('windows by type: bars on storehouses, openings on farms', () => {
    const kinds = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const r = runGenerator('village', 1, `win-${s}`, { buildings: 30, width: 120, height: 120 });
      for (const w of r.floors[0]!.windows) kinds.add(w.kind);
    }
    expect([...kinds].sort()).toEqual(['bars', 'glass', 'opening']);
  });
  it('100x100 stays fast (D14)', () => {
    const t0 = Date.now();
    runGenerator('village', 1, 'perf', { width: 100, height: 100, buildings: 40, theme: 'town' });
    const ms = Date.now() - t0;
    console.log(`village 100x100 in ${ms} ms`);
    expect(ms).toBeLessThan(10_000);
  });
});
