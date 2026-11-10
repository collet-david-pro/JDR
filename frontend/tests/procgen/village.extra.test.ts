import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Segment } from '../../src/procgen/geometry';
import type { GenFloor } from '../../src/procgen/types';
import { registerGenerator, runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import {
  cutWalls,
  villageGenerator,
  villageGeneratorV1,
  VILLAGE_PRESETS,
  VILLAGE_VERSION,
} from '../../src/procgen/village';
import { validateVillage } from '../../src/procgen/village/params';
import { analyse, cutProblems } from './village-checks';

beforeAll(() => {
  registerGenerator(villageGeneratorV1);
  registerGenerator(villageGenerator);
});
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
        const r = runGenerator('village', VILLAGE_VERSION, `pre-${s}`, VILLAGE_PRESETS[name]);
        expect(analyse(r, p), `${name} ${s}`).toEqual([]);
        expect(r.stats['buildings']).toBeGreaterThan(0);
      }
    }
  });
  it('L shapes everywhere (l_shape_p = 1) keep the structure', () => {
    for (let s = 0; s < 40; s++) {
      const p = validateVillage({ l_shape_p: 1, theme: s % 2 === 0 ? 'rural' : 'town' });
      const r = runGenerator('village', VILLAGE_VERSION, `ell-${s}`, p);
      expect(analyse(r, p), `ell-${s}`).toEqual([]);
    }
  });
  it('interiors: false gives one room per building and cut walls', () => {
    for (let s = 0; s < 30; s++) {
      const r = runGenerator('village', VILLAGE_VERSION, `noint-${s}`, {
        interiors: false,
        l_shape_p: 0.5,
      });
      const f = r.floors[0]!;
      expect(f.rooms.length).toBe(r.stats['buildings']);
      expect(f.doors.length).toBe(r.stats['buildings']);
      expect(cutProblems(f), `noint-${s}`).toEqual([]);
    }
  });
  it('windows by type: bars on storehouses, openings on farms', () => {
    const kinds = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const r = runGenerator('village', VILLAGE_VERSION, `win-${s}`, {
        buildings: 30,
        width: 120,
        height: 120,
      });
      for (const w of r.floors[0]!.windows) kinds.add(w.kind);
    }
    expect([...kinds].sort()).toEqual(['bars', 'glass', 'opening']);
  });
  it('100x100 stays fast (D14)', () => {
    const t0 = Date.now();
    runGenerator('village', VILLAGE_VERSION, 'perf', {
      width: 100,
      height: 100,
      buildings: 40,
      theme: 'town',
    });
    const ms = Date.now() - t0;
    console.log(`village 100x100 in ${ms} ms`);
    expect(ms).toBeLessThan(10_000);
  });
});

describe('village v2: fences and wall lights', () => {
  const fenceFlags = (
    f: GenFloor,
    W: number,
  ): { flags: number; vertical: boolean; horizontal: boolean }[] => {
    const at = new Set(f.decor.filter((d) => d.key === 'decor.fence').map((d) => d.y * W + d.x));
    return f.decor
      .filter((d) => d.key === 'decor.fence')
      .map((d) => ({
        flags: d.flags ?? 0,
        vertical: at.has((d.y - 1) * W + d.x) || at.has((d.y + 1) * W + d.x),
        horizontal: at.has(d.y * W + d.x - 1) || at.has(d.y * W + d.x + 1),
      }));
  };

  it('a north-south fence run is turned a quarter, an east-west one is not (v1 kept as it was)', () => {
    let turned = 0;
    for (let s = 0; s < 30; s++) {
      const p = { ...VILLAGE_PRESETS['hamlet'], width: 50 + (s % 3) * 10, height: 50 };
      const r = runGenerator('village', VILLAGE_VERSION, `fence-${s}`, p);
      for (const c of fenceFlags(r.floors[0]!, r.width)) {
        expect(c.flags, `fence-${s}`).toBe(c.vertical && !c.horizontal ? 1 : 0);
        if (c.flags === 1) turned++;
      }
      // v1: the same request still draws every piece east-west (stored maps regenerate alike).
      const old = runGenerator('village', 1, `fence-${s}`, p);
      for (const c of fenceFlags(old.floors[0]!, old.width)) expect(c.flags).toBe(0);
    }
    expect(turned).toBeGreaterThan(0);
  });

  it('wall lights stay inside their room, off the wall line, windows and doors', () => {
    for (const theme of ['rural', 'town'] as const) {
      for (let s = 0; s < 40; s++) {
        const r = runGenerator('village', VILLAGE_VERSION, `light-${s}`, {
          theme,
          l_shape_p: s % 2 === 0 ? 1 : 0.3,
        });
        const f = r.floors[0]!;
        const openings = [...f.doors, ...f.windows];
        for (const l of f.lights) {
          const room = f.rooms.find(
            (q) =>
              q.rect !== null &&
              l.x > q.rect.x &&
              l.x < q.rect.x + q.rect.w &&
              l.y > q.rect.y &&
              l.y < q.rect.y + q.rect.h,
          );
          if (room === undefined) {
            // Street lanterns (town): centre of an outdoor cell.
            expect([l.x % 1, l.y % 1], `${theme} light-${s}: ${l.x},${l.y}`).toEqual([0.5, 0.5]);
            continue;
          }
          // Off any wall line: neither coordinate is an integer.
          expect(Number.isInteger(l.x) || Number.isInteger(l.y), `${l.x},${l.y} on a wall`).toBe(
            false,
          );
          for (const o of openings) {
            const mx = (o.a[0] + o.b[0]) / 2;
            const my = (o.a[1] + o.b[1]) / 2;
            expect(Math.hypot(l.x - mx, l.y - my), `${l.x},${l.y} on an opening`).toBeGreaterThan(
              0.2,
            );
          }
        }
      }
    }
  });
});
