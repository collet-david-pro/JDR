/**
 * Invariants shared by the four generators, over every preset, theme and the size bounds of the
 * panel (min, max and non-square): cells, pack keys, walls, openings and lights stay valid, the
 * result has the requested size, and it survives the apply step unchanged (EditorSession +
 * MapDocument validation, as the "Générer" panel applies it, whatever the snapping step).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EditorSession } from '../../src/editor/ui/session';
import { applyGeneration } from '../../src/lib/procgen/apply';
import { packKey } from '../../src/procgen/pack-keys';
import { GENERATOR_IDS, GENERATOR_INFO, registerAllGenerators } from '../../src/procgen/generators';
import { runGenerator, unregisterGenerator } from '../../src/procgen/registry';
import { VILLAGE_THEMES } from '../../src/procgen/themes/village';
import type { GeneratorId } from '../../src/procgen/types';
import { VILLAGE_VERSION } from '../../src/procgen/village';
import { validateVillage } from '../../src/procgen/village/params';
import { grid } from '../editor/helpers';
import { FULL_PACK, applyProblems, resultProblems } from './result-checks';

beforeAll(() => registerAllGenerators());
afterAll(() => {
  for (const id of GENERATOR_IDS) unregisterGenerator(id);
});

const SNAP_STEPS = [1, 0.5, 0.25, 0.125];

function cases(id: GeneratorId): { params: Record<string, unknown>; label: string }[] {
  const info = GENERATOR_INFO[id];
  const { min, max } = info.size;
  const big = Math.min(max, 120);
  const sizes: [number, number][] = [
    [min, min],
    [min, big],
    [big, min],
    [73, 41],
  ];
  const themes = info.params.find((p) => p.key === 'theme')?.options ?? [];
  const out: { params: Record<string, unknown>; label: string }[] = [];
  for (const preset of ['', ...Object.keys(info.presets)]) {
    for (const theme of ['', ...themes]) {
      for (const [width, height] of sizes) {
        const params: Record<string, unknown> = {
          ...(preset === '' ? {} : info.presets[preset]),
          ...(theme === '' ? {} : { theme }),
          width,
          height,
        };
        out.push({
          params,
          label: `${id} ${preset || 'default'} ${theme || '-'} ${width}x${height}`,
        });
      }
    }
  }
  return out;
}

describe('generic invariants of every generator', () => {
  for (const id of GENERATOR_IDS) {
    it(`${id}: presets x themes x sizes, two seeds, applied without loss`, () => {
      let k = 0;
      for (const { params, label } of cases(id)) {
        for (let s = 0; s < 2; s++) {
          const r = runGenerator(id, GENERATOR_INFO[id].version, `inv-${s}`, params);
          expect([r.width, r.height], label).toEqual([params['width'], params['height']]);
          const problems = resultProblems(r, {
            grid: id === 'dungeon' || id === 'village',
            noBorderOpenings: id === 'village',
            fullGround: id === 'village' || id === 'outdoor',
          });
          expect(problems.slice(0, 3), `${label} inv-${s}`).toEqual([]);
          if (s === 0) {
            const step = SNAP_STEPS[k++ % SNAP_STEPS.length];
            expect(applyProblems(r, step).slice(0, 3), `${label} applied (snap ${step})`).toEqual(
              [],
            );
          }
        }
      }
    });
  }
});

describe('village: decor and roads', () => {
  it('blocking decor is never on a road, outdoor decor never inside a building', () => {
    for (const theme of ['rural', 'town'] as const) {
      for (let s = 0; s < 40; s++) {
        const p = validateVillage({ theme, width: 50 + (s % 4) * 10, height: 50, buildings: 8 });
        const r = runGenerator('village', VILLAGE_VERSION, `deco-${s}`, p);
        const f = r.floors[0]!;
        const W = r.width;
        const inRoom = new Uint8Array(W * r.height);
        for (const q of f.rooms) {
          for (let y = q.rect!.y; y < q.rect!.y + q.rect!.h; y++)
            for (let x = q.rect!.x; x < q.rect!.x + q.rect!.w; x++) inRoom[y * W + x] = 1;
        }
        const road = VILLAGE_THEMES[theme].road;
        const outdoorKeys = new Set([
          'decor.fence',
          'decor.tree',
          'decor.bush',
          'decor.well',
          'decor.stall',
          'decor.lantern',
        ]);
        for (const d of f.decor) {
          const i = d.y * W + d.x;
          const where = `${theme} deco-${s} ${d.key} ${d.x},${d.y}`;
          // The well and the stalls of a town stand on its square (a road cell) by design.
          const onSquare = d.key === 'decor.well' || d.key === 'decor.stall';
          if (packKey(d.key).blocking && inRoom[i] === 0 && !onSquare)
            expect(f.ground[i]!.key, where).not.toBe(road);
          if (outdoorKeys.has(d.key)) expect(inRoom[i], where).toBe(0);
          else expect(inRoom[i], where).toBe(1);
        }
      }
    }
  });
});

describe('apply step: size of the result', () => {
  it('a village clamped to 30 x 30 is refused on a 30 x 20 map, nothing applied', () => {
    // Before the panel guard, Apply on a new map of the default size (30 x 20) crashed here.
    const r = runGenerator('village', VILLAGE_VERSION, 'hameau-1', { width: 30, height: 20 });
    expect([r.width, r.height]).toEqual([30, 30]);
    const s = new EditorSession({ grid: grid(30, 20), newUid: () => 'u' });
    expect(() => applyGeneration(s, { result: r, pack: FULL_PACK, target: 'map' })).toThrow(
      /does not fit 30 x 20/,
    );
    expect(s.doc.objects()).toEqual([]);
    expect(s.history.state.undoSize).toBe(0);
  });
});

describe('apply step: zone of a selection', () => {
  it('dungeon and cave zones land whole inside the selected rectangle', () => {
    for (const id of ['dungeon', 'cave'] as const) {
      for (const [w, h] of [
        [20, 20],
        [34, 21],
        [60, 45],
      ] as const) {
        const rect = { x: 7, y: 5, w, h };
        const r = runGenerator(
          id,
          GENERATOR_INFO[id].version,
          `zone-${w}`,
          { width: w, height: h },
          {
            zone: { width: w, height: h, openings: [[0, Math.floor(h / 2)]] },
          },
        );
        expect([r.width, r.height]).toEqual([w, h]);
        let n = 0;
        const s = new EditorSession({ grid: grid(80, 60), newUid: () => `z${++n}` });
        applyGeneration(s, { result: r, pack: FULL_PACK, target: 'selection', rect });
        const f = r.floors[0]!;
        const objects = s.doc.objects();
        expect(objects).toHaveLength(
          f.walls.length + f.doors.length + f.windows.length + f.lights.length,
        );
        const inside = ([x, y]: readonly number[]): boolean =>
          x! >= rect.x && y! >= rect.y && x! <= rect.x + w && y! <= rect.y + h;
        for (const o of objects) {
          const pts =
            o.type === 'wall'
              ? o.geometry.points
              : o.type === 'door' || o.type === 'window'
                ? [o.geometry.a, o.geometry.b]
                : o.type === 'light'
                  ? [[o.geometry.x, o.geometry.y]]
                  : [];
          for (const p of pts) expect(inside(p), `${id} ${w}x${h} ${o.type} ${p}`).toBe(true);
        }
      }
    }
  });
});
