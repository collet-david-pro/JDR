import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import {
  OUTDOOR_DEFAULTS,
  OUTDOOR_PRESET_LABELS,
  OUTDOOR_PRESETS,
  outdoorGenerator,
  outdoorRules,
  validateOutdoor,
} from '../../src/procgen/outdoor';
import { isPackKey } from '../../src/procgen/pack-keys';
import {
  GenCancelled,
  registerGenerator,
  runGenerator,
  unregisterGenerator,
} from '../../src/procgen/registry';
import { OUTDOOR_THEME_IDS, OUTDOOR_THEMES } from '../../src/procgen/themes/outdoor';
import type { GenResult } from '../../src/procgen/types';
import { cellProblems } from './cave-outdoor-checks';

beforeAll(() => registerGenerator(outdoorGenerator));
afterAll(() => unregisterGenerator('outdoor'));

const run = (seed: string, params: object = {}): GenResult =>
  runGenerator('outdoor', 1, seed, params);

describe('outdoor validate', () => {
  it('fills defaults and replaces wrong types', () => {
    expect(validateOutdoor(undefined)).toEqual(OUTDOOR_DEFAULTS);
    expect(validateOutdoor([1])).toEqual(OUTDOOR_DEFAULTS);
    expect(validateOutdoor({ width: 'x', water: NaN, theme: 'lava', roads: null })).toEqual(
      OUTDOOR_DEFAULTS,
    );
  });

  it('clamps out-of-bounds values and enforces the cell budget', () => {
    const p = validateOutdoor({
      width: 5,
      height: 9999,
      scale: 9,
      water: -1,
      rivers: 99,
      roads: -2,
      forest: 3,
    });
    expect([p.width, p.scale, p.water, p.rivers, p.roads, p.forest]).toEqual([30, 4, 0, 6, 0, 1]);
    expect(p.width * p.height).toBeLessThanOrEqual(160_000);
    expect(validateOutdoor({ scale: 0.1 }).scale).toBe(0.5);
  });

  it('keeps the presets as they are, with French labels', () => {
    expect(Object.keys(OUTDOOR_PRESETS).sort()).toEqual([
      'crossroads',
      'desert_oasis',
      'forest_river',
      'winter_lake',
    ]);
    for (const [name, preset] of Object.entries(OUTDOOR_PRESETS)) {
      expect(validateOutdoor({ ...OUTDOOR_DEFAULTS, ...preset })).toEqual({
        ...OUTDOOR_DEFAULTS,
        ...preset,
      });
      expect(OUTDOOR_PRESET_LABELS[name]).toMatch(/\S/);
    }
    expect(OUTDOOR_PRESET_LABELS['winter_lake']).toBe('Lac gelé');
  });
});

describe('outdoor themes and rules', () => {
  it('only use pack keys', () => {
    for (const id of OUTDOOR_THEME_IDS) {
      const t = OUTDOOR_THEMES[id];
      for (const [name, v] of Object.entries(t)) {
        if (typeof v === 'string' && /^(floor|terrain|decor)\./.test(v))
          expect(isPackKey(v), `${id}.${name}`).toBe(true);
      }
      const rules = outdoorRules(t.rules);
      expect(rules.room_kinds.some((k) => k.kind === 'common')).toBe(true);
      for (const [, items] of rules.kinds)
        for (const it of items) expect(isPackKey(it.key)).toBe(true);
    }
  });
});

describe('outdoor generator', () => {
  it('is deterministic and depends on the seed', async () => {
    const a = await fingerprint(run('alpha'));
    expect(await fingerprint(run('alpha'))).toBe(a);
    expect(await fingerprint(run('beta'))).not.toBe(a);
  });

  it('covers the whole grid with valid cells for every theme', () => {
    for (const theme of OUTDOOR_THEME_IDS) {
      for (let s = 0; s < 5; s++) {
        const r = run(`t-${theme}-${s}`, { theme, width: 60, height: 50 });
        const f = r.floors[0]!;
        expect(r.floors).toHaveLength(1);
        expect(cellProblems(r)).toEqual([]);
        expect(f.ground).toHaveLength(60 * 50);
        expect(f.walls).toEqual([]);
        expect(f.doors).toEqual([]);
        expect(r.stats['water_cells']).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('draws the biomes of each theme', () => {
    const keys = (theme: string): Set<string> => {
      const out = new Set<string>();
      for (let s = 0; s < 6; s++) {
        const f = run(`b-${theme}-${s}`, { theme, water: 0.4, forest: 0.8 }).floors[0]!;
        for (const c of [...f.ground, ...f.terrain, ...f.decor]) out.add(c.key);
      }
      return out;
    };
    const temperate = keys('temperate');
    for (const k of [
      'floor.grass',
      'floor.sand',
      'floor.dirt',
      'floor.stone',
      'terrain.water',
      'terrain.deep_water',
      'decor.tree',
      'decor.rock',
    ])
      expect(temperate.has(k), k).toBe(true);
    const desert = keys('desert');
    expect(desert.has('floor.sand')).toBe(true);
    expect(desert.has('floor.snow')).toBe(false);
    const winter = keys('winter');
    expect(winter.has('floor.snow')).toBe(true);
    expect(winter.has('floor.ice')).toBe(true);
    expect(winter.has('floor.grass')).toBe(false);
  });

  it('water = 0 and no river means no water at all', () => {
    for (const theme of OUTDOOR_THEME_IDS) {
      for (let s = 0; s < 4; s++) {
        const r = run(`dry-${theme}-${s}`, { theme, water: 0, rivers: 0 });
        const f = r.floors[0]!;
        expect(f.terrain).toEqual([]);
        expect(r.stats['water_cells']).toBe(0);
        expect(f.ground.some((c) => c.key === 'floor.ice')).toBe(false);
      }
    }
  });

  it('roads = 0 has neither entrance nor exit; a river-less map has no river', () => {
    const r = run('noroad', { roads: 0, rivers: 0 });
    expect(r.floors[0]!.entrance).toBeNull();
    expect(r.floors[0]!.exit).toBeNull();
    expect(r.stats['roads']).toBe(0);
    expect(r.stats['rivers']).toBe(0);
  });

  it('draws rivers and keeps the extreme sizes valid', () => {
    let rivers = 0;
    for (let s = 0; s < 10; s++)
      rivers += run(`riv-${s}`, { rivers: 6, water: 0.2 }).stats['rivers']!;
    expect(rivers).toBeGreaterThan(0);
    for (const [w, h, scale] of [
      [30, 30, 0.5],
      [30, 400, 4],
      [400, 30, 1],
    ] as const) {
      const r = run(`x${w}-${h}`, { width: w, height: h, scale, roads: 6, rivers: 6 });
      expect(cellProblems(r)).toEqual([]);
      expect(r.floors[0]!.ground).toHaveLength(w * h);
    }
  });

  it('is cancellable and refuses zones', () => {
    expect(() => runGenerator('outdoor', 1, 'c', {}, { isCancelled: () => true })).toThrow(
      GenCancelled,
    );
    expect(() =>
      runGenerator('outdoor', 1, 'z', {}, { zone: { width: 20, height: 20, openings: [] } }),
    ).toThrow('zone_unsupported');
  });
});
