import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GenCancelled,
  registerGenerator,
  runGenerator,
  unregisterGenerator,
} from '../../src/procgen/registry';
import { isPackKey } from '../../src/procgen/pack-keys';
import { VILLAGE_THEMES } from '../../src/procgen/themes/village';
import { villageGenerator } from '../../src/procgen/village';
import {
  VILLAGE_DEFAULTS,
  VILLAGE_PRESETS,
  validateVillage,
} from '../../src/procgen/village/params';
import { analyse } from './village-checks';

beforeAll(() => registerGenerator(villageGenerator));
afterAll(() => unregisterGenerator('village'));

describe('village params', () => {
  it('validate clamps bounds and falls back on invalid types', () => {
    expect(validateVillage(undefined)).toEqual(VILLAGE_DEFAULTS);
    expect(
      validateVillage({ width: 5, height: 900, buildings: 1, l_shape_p: 3, decor: -1 }),
    ).toMatchObject({
      width: 30,
      height: 200,
      buildings: 2,
      l_shape_p: 1,
      decor: 0,
    });
    expect(
      validateVillage({ theme: 'x', interiors: 'yes', width: 'a', buildings: NaN }),
    ).toMatchObject({
      theme: 'rural',
      interiors: true,
      width: 70,
      buildings: 10,
    });
  });
  it('presets stay within bounds', () => {
    for (const p of Object.values(VILLAGE_PRESETS)) {
      expect(validateVillage(p)).toMatchObject(p);
    }
  });
});

describe('village generator', () => {
  it('is deterministic and uses only pack keys', () => {
    const a = runGenerator('village', 1, 'det', {});
    const b = runGenerator('village', 1, 'det', {});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const f = a.floors[0]!;
    for (const c of [...f.ground, ...f.terrain, ...f.decor])
      expect(isPackKey(c.key), c.key).toBe(true);
    for (const theme of Object.values(VILLAGE_THEMES)) {
      for (const k of [theme.base, theme.road, ...theme.interiors, theme.base_alt, theme.plaza]) {
        if (k !== null) expect(isPackKey(k), k).toBe(true);
      }
    }
    expect(a.stats['buildings']).toBeGreaterThan(0);
  });
  it('refuses zones and honours cancellation', () => {
    expect(() =>
      runGenerator('village', 1, 'z', {}, { zone: { width: 30, height: 30, openings: [] } }),
    ).toThrow('zone_unsupported');
    expect(() => runGenerator('village', 1, 'c', {}, { isCancelled: () => true })).toThrow(
      GenCancelled,
    );
  });
  it('at most one cell per layer and cell', () => {
    for (const theme of ['rural', 'town']) {
      const f = runGenerator('village', 1, 'uniq', { theme }).floors[0]!;
      const seen = new Set<number>();
      for (const d of f.decor) {
        const k = d.y * 1000 + d.x;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });
});

describe('village structure (D9)', () => {
  for (const [w, h] of [
    [70, 70],
    [45, 60],
  ] as const) {
    for (const theme of ['rural', 'town'] as const) {
      it(`200 seeds ${w}x${h} ${theme}: access, rooms, cut walls, windows`, () => {
        for (let s = 0; s < 200; s++) {
          const p = validateVillage({ width: w, height: h, theme, buildings: 12 });
          const r = runGenerator('village', 1, `d9-${s}`, p);
          const problems = analyse(r, p);
          expect(problems.slice(0, 3), `${theme} ${w}x${h} d9-${s}`).toEqual([]);
        }
      });
    }
  }
});
