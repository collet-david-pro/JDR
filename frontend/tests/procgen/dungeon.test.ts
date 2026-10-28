import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/procgen/canonical';
import {
  DUNGEON_DEFAULTS,
  DUNGEON_PRESET_LABELS,
  DUNGEON_PRESETS,
  dungeonGenerator,
  dungeonRules,
  validateDungeon,
} from '../../src/procgen/dungeon';
import { isPackKey, packKey } from '../../src/procgen/pack-keys';
import {
  GenCancelled,
  registerGenerator,
  runGenerator,
  unregisterGenerator,
} from '../../src/procgen/registry';
import { DUNGEON_THEME_IDS, DUNGEON_THEMES } from '../../src/procgen/themes/dungeon';
import type { GenResult } from '../../src/procgen/types';
import { blockedDoors, floorComponents, wallDoorProblems } from './dungeon-checks';

beforeAll(() => registerGenerator(dungeonGenerator));
afterAll(() => unregisterGenerator('dungeon'));

const run = (seed: string, params: object = {}): GenResult =>
  runGenerator('dungeon', 1, seed, params);

describe('dungeon validate', () => {
  it('fills defaults and replaces wrong types', () => {
    expect(validateDungeon(undefined)).toEqual(DUNGEON_DEFAULTS);
    expect(validateDungeon([1, 2])).toEqual(DUNGEON_DEFAULTS);
    expect(validateDungeon({ width: 'big', loops: NaN, theme: 'lava', floors: 3 })).toEqual(
      DUNGEON_DEFAULTS,
    );
  });

  it('clamps out-of-bounds values and applies the safety rules', () => {
    const p = validateDungeon({
      width: 5,
      height: 1000,
      rooms: 1000,
      room_min: 30,
      room_max: 2,
      corridor: 9,
      loops: 2,
      door_p: -1,
      secret_p: 1,
      decor: 7,
      floors: 2,
    });
    expect(p.width).toBe(20);
    expect(p.height).toBe(400);
    expect(p.rooms).toBe(200);
    expect(p.room_min).toBe(7); // capped so that a 20-wide map still splits once
    expect(p.room_max).toBe(7);
    expect([p.corridor, p.loops, p.door_p, p.secret_p, p.decor, p.floors]).toEqual([
      3, 0.5, 0, 0.5, 1, 1,
    ]);
    expect(validateDungeon({ width: 20, height: 20, rooms: 200 }).rooms).toBe(16);
    expect(validateDungeon({ width: 33.6 }).width).toBe(34);
  });

  it('keeps the presets as they are, with French labels', () => {
    for (const [name, preset] of Object.entries(DUNGEON_PRESETS)) {
      const p = validateDungeon({ ...DUNGEON_DEFAULTS, ...preset });
      expect(p).toEqual({ ...DUNGEON_DEFAULTS, ...preset });
      expect(DUNGEON_PRESET_LABELS[name]).toMatch(/\S/);
    }
  });
});

describe('dungeon themes and rules', () => {
  it('only use pack keys', () => {
    for (const id of DUNGEON_THEME_IDS) {
      const t = DUNGEON_THEMES[id];
      for (const k of [t.floor, t.floor_alt, t.corridor]) expect(packKey(k).family).toBe('floor');
      if (t.water !== null) expect(packKey(t.water).family).toBe('terrain');
      const rules = dungeonRules(t.rules);
      expect(rules.room_kinds.some((k) => k.kind === 'common')).toBe(true);
      for (const [, items] of rules.kinds)
        for (const it of items) expect(isPackKey(it.key)).toBe(true);
    }
  });
});

describe('dungeon generator', () => {
  it('is deterministic and depends on the seed', async () => {
    const a = await fingerprint(run('alpha'));
    expect(await fingerprint(run('alpha'))).toBe(a);
    expect(await fingerprint(run('beta'))).not.toBe(a);
  });

  it('produces a coherent level for every theme and corridor width', () => {
    let doors = 0;
    let secret = 0;
    for (const theme of DUNGEON_THEME_IDS) {
      for (const corridor of [1, 2, 3]) {
        for (let s = 0; s < 8; s++) {
          const r = run(`t-${theme}-${corridor}-${s}`, {
            theme,
            corridor,
            loops: 0.5,
            secret_p: 0.5,
          });
          const f = r.floors[0]!;
          expect(r.floors).toHaveLength(1);
          for (const c of [...f.ground, ...f.terrain, ...f.decor])
            expect(isPackKey(c.key)).toBe(true);
          for (const w of f.walls) expect(w.kind).toBe(DUNGEON_THEMES[theme].wall_kind);
          expect(wallDoorProblems(f)).toEqual([]);
          expect(floorComponents(f, r.width, r.height)).toBe(1);
          expect(blockedDoors(f, r.width, r.height)).toBe(0);
          expect(r.stats['repairs']).toBe(0);
          for (const d of f.doors) {
            const len = Math.abs(d.a[0] - d.b[0]) + Math.abs(d.a[1] - d.b[1]);
            expect(len).toBeGreaterThanOrEqual(1);
            expect(len).toBeLessThanOrEqual(corridor);
            if (DUNGEON_THEMES[theme].door_swing_slide) expect(d.swing).toBe('slide');
          }
          doors += f.doors.length;
          secret += f.doors.filter((d) => d.secret).length;
        }
      }
    }
    expect(doors).toBeGreaterThan(0);
    expect(secret).toBeGreaterThan(0);
  });

  it('places distinct stairs at the entrance and the exit, and types the rooms', () => {
    for (let s = 0; s < 20; s++) {
      const r = run(`stairs-${s}`);
      const f = r.floors[0]!;
      expect(f.entrance).not.toEqual(f.exit);
      const at = (key: string) => f.decor.filter((d) => d.key === key).map((d) => [d.x, d.y]);
      expect(at('decor.stairs_up')).toEqual([f.entrance]);
      expect(at('decor.stairs_down')).toEqual([f.exit]);
      const kinds = f.rooms.map((room) => room.kind);
      expect(kinds.filter((k) => k === 'entrance')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'exit')).toHaveLength(1);
      expect(f.rooms.length).toBeLessThanOrEqual(14);
      expect(f.rooms.length).toBeGreaterThanOrEqual(10);
      expect(r.stats['rooms']).toBe(f.rooms.length);
      expect(r.stats['floor_cells']).toBe(f.ground.length);
      expect(r.stats['decor']).toBe(f.decor.length);
      expect(r.stats['lights']).toBe(f.lights.length);
    }
  });

  it('honours the room count on small and large maps', () => {
    expect(run('few', { width: 30, height: 30, rooms: 6 }).floors[0]!.rooms).toHaveLength(6);
    const many = run('many', { width: 120, height: 120, rooms: 40 }).floors[0]!.rooms.length;
    expect(many).toBe(40);
    const tight = run('tight', { width: 20, height: 20, rooms: 16, room_min: 20 }).floors[0]!;
    expect(tight.rooms.length).toBeGreaterThanOrEqual(2);
    expect(tight.entrance).not.toEqual(tight.exit);
  });

  it('decor = 0 leaves only the stairs and no light', () => {
    const f = run('bare', { decor: 0 }).floors[0]!;
    expect(f.decor.map((d) => d.key).sort()).toEqual(['decor.stairs_down', 'decor.stairs_up']);
    expect(f.lights).toEqual([]);
    expect(f.terrain).toEqual([]);
  });

  it('reports progress and cancels through it', () => {
    const phases: string[] = [];
    runGenerator('dungeon', 1, 'p', {}, { progress: (ph) => phases.push(ph) });
    expect(phases.length).toBe(10);
    expect(() => runGenerator('dungeon', 1, 'p', {}, { isCancelled: () => true })).toThrow(
      GenCancelled,
    );
  });

  it('generates a default 100×100 map in under 10 s', () => {
    const t0 = performance.now();
    const r = run('perf', { width: 100, height: 100 });
    const ms = performance.now() - t0;
    console.info(`dungeon 100x100: ${ms.toFixed(1)} ms`);
    expect(r.floors[0]!.ground.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(10_000);
    const t1 = performance.now();
    run('perf-max', { width: 400, height: 400, rooms: 200 });
    console.info(`dungeon 400x400, 200 rooms: ${(performance.now() - t1).toFixed(1)} ms`);
  });
});
