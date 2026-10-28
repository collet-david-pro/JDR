import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import {
  CAVE_DEFAULTS,
  CAVE_PRESET_LABELS,
  CAVE_PRESETS,
  caveGenerator,
  caveRules,
  validateCave,
} from '../../src/procgen/cave';
import { isPackKey } from '../../src/procgen/pack-keys';
import {
  GenCancelled,
  registerGenerator,
  runGenerator,
  unregisterGenerator,
} from '../../src/procgen/registry';
import { CAVE_THEME_IDS, CAVE_THEMES } from '../../src/procgen/themes/cave';
import type { GenResult } from '../../src/procgen/types';
import { cellProblems, componentCount, floorMask, walkableComponents } from './cave-outdoor-checks';

beforeAll(() => registerGenerator(caveGenerator));
afterAll(() => unregisterGenerator('cave'));

const run = (seed: string, params: object = {}): GenResult => runGenerator('cave', 1, seed, params);

describe('cave validate', () => {
  it('fills defaults and replaces wrong types', () => {
    expect(validateCave(undefined)).toEqual(CAVE_DEFAULTS);
    expect(validateCave([1])).toEqual(CAVE_DEFAULTS);
    expect(
      validateCave({ width: 'x', fill: NaN, connect: 'bridge', theme: 'sand', iterations: null }),
    ).toEqual(CAVE_DEFAULTS);
  });

  it('clamps out-of-bounds values and enforces the cell budget', () => {
    const p = validateCave({
      width: 5,
      height: 9999,
      fill: 0.1,
      iterations: 50,
      smooth: -3,
      decor: 4,
    });
    expect([p.width, p.fill, p.iterations, p.smooth, p.decor]).toEqual([20, 0.35, 10, 0, 1]);
    expect(p.width * p.height).toBeLessThanOrEqual(160_000);
    const q = validateCave({ width: 400, height: 400 });
    expect(q.width * q.height).toBeLessThanOrEqual(160_000);
    expect(validateCave({ fill: 0.9 }).fill).toBe(0.6);
  });

  it('keeps the presets as they are, with French labels', () => {
    expect(Object.keys(CAVE_PRESETS).sort()).toEqual([
      'great_cavern',
      'ice_cavern',
      'lava_tubes',
      'small_cave',
    ]);
    for (const [name, preset] of Object.entries(CAVE_PRESETS)) {
      expect(validateCave({ ...CAVE_DEFAULTS, ...preset })).toEqual({
        ...CAVE_DEFAULTS,
        ...preset,
      });
      expect(CAVE_PRESET_LABELS[name]).toMatch(/\S/);
    }
    expect(CAVE_PRESET_LABELS['small_cave']).toBe('Petite grotte');
  });
});

describe('cave themes and rules', () => {
  it('only use pack keys', () => {
    for (const id of CAVE_THEME_IDS) {
      const t = CAVE_THEMES[id];
      for (const k of [t.floor, t.floor_alt])
        expect(isPackKey(k) && k.startsWith('floor.')).toBe(true);
      if (t.lava !== null) expect(isPackKey(t.lava)).toBe(true);
      const rules = caveRules(t.rules);
      expect(rules.torches).toBeNull();
      expect(rules.room_kinds.some((k) => k.kind === 'common')).toBe(true);
      for (const [, items] of rules.kinds)
        for (const it of items) expect(isPackKey(it.key)).toBe(true);
    }
  });
});

describe('cave generator', () => {
  it('is deterministic and depends on the seed', async () => {
    const a = await fingerprint(run('alpha'));
    expect(await fingerprint(run('alpha'))).toBe(a);
    expect(await fingerprint(run('beta'))).not.toBe(a);
  });

  it('produces a coherent cave for every theme, with natural walls and valid cells', () => {
    for (const theme of CAVE_THEME_IDS) {
      for (let s = 0; s < 6; s++) {
        const r = run(`t-${theme}-${s}`, { theme, width: 50, height: 40 });
        const f = r.floors[0]!;
        expect(r.floors).toHaveLength(1);
        expect(cellProblems(r)).toEqual([]);
        expect(f.doors).toEqual([]);
        expect(f.windows).toEqual([]);
        for (const w of f.walls) expect(w.kind).toBe('natural');
        expect(f.lights.every((l) => l.preset === 'magic' || l.preset === 'campfire')).toBe(true);
        expect(r.stats['floor_cells']).toBe(f.ground.length);
        expect(f.rooms.length).toBe(r.stats['regions']);
      }
    }
  });

  it('puts stairs at distinct entrance and exit', () => {
    const r = run('stairs');
    const f = r.floors[0]!;
    expect(f.entrance).not.toEqual(f.exit);
    const at = (key: string) => f.decor.filter((d) => d.key === key).map((d) => [d.x, d.y]);
    expect(at('decor.stairs_up')).toEqual([f.entrance]);
    expect(at('decor.stairs_down')).toEqual([f.exit]);
  });

  it('uses lava only in the lava theme, ice only in the ice theme, and lights mushrooms', () => {
    let lava = 0;
    let campfires = 0;
    let magic = 0;
    for (let s = 0; s < 8; s++) {
      const rk = run(`rock-${s}`, { decor: 1 }).floors[0]!;
      expect(rk.terrain.some((c) => c.key === 'terrain.lava')).toBe(false);
      expect(rk.ground.every((c) => c.key === 'floor.cave' || c.key === 'floor.dirt')).toBe(true);
      const ic = run(`ice-${s}`, { theme: 'ice' }).floors[0]!;
      expect(ic.ground.every((c) => c.key === 'floor.ice' || c.key === 'floor.snow')).toBe(true);
      const lv = run(`lava-${s}`, { theme: 'lava', decor: 1 }).floors[0]!;
      lava += lv.terrain.filter((c) => c.key === 'terrain.lava').length;
      campfires += lv.lights.filter((l) => l.preset === 'campfire').length;
      magic += rk.lights.filter((l) => l.preset === 'magic').length;
    }
    expect(lava).toBeGreaterThan(0);
    expect(campfires).toBeGreaterThan(0);
    expect(magic).toBeGreaterThan(0);
  });

  it('decor = 0 leaves the cave empty; fill mode never tunnels', () => {
    const bare = run('bare', { decor: 0 }).floors[0]!;
    expect(bare.terrain).toEqual([]);
    expect(bare.decor).toHaveLength(2); // the stairs
    for (let s = 0; s < 10; s++) {
      const r = run(`fill-${s}`, { connect: 'fill', fill: 0.5 });
      expect(r.stats['tunnels']).toBe(0);
      expect(componentCount(floorMask(r.floors[0]!, r.width, r.height))).toBe(1);
    }
  });

  it('links the components with tunnels in tunnel mode', () => {
    let tunnels = 0;
    for (let s = 0; s < 20; s++)
      tunnels += run(`tun-${s}`, { fill: 0.5, smooth: 0 }).stats['tunnels']!;
    expect(tunnels).toBeGreaterThan(0);
  });

  it('handles the extreme parameters', () => {
    for (const [w, h, fill] of [
      [20, 20, 0.6],
      [20, 400, 0.35],
      [400, 20, 0.6],
    ] as const) {
      for (let s = 0; s < 3; s++) {
        const r = run(`x${w}-${h}-${s}`, { width: w, height: h, fill, iterations: 10, smooth: 3 });
        const f = r.floors[0]!;
        expect(cellProblems(r)).toEqual([]);
        expect(componentCount(floorMask(f, r.width, r.height))).toBe(1);
        expect(f.entrance).not.toEqual(f.exit);
        expect(walkableComponents(f, r.width, r.height)).toBe(1);
      }
    }
  });

  it('is cancellable', () => {
    expect(() => runGenerator('cave', 1, 'c', {}, { isCancelled: () => true })).toThrow(
      GenCancelled,
    );
  });

  it('rejects a zone that is too small', () => {
    expect(() =>
      runGenerator('cave', 1, 'z', {}, { zone: { width: 7, height: 20, openings: [] } }),
    ).toThrow('zone_too_small');
  });
});
