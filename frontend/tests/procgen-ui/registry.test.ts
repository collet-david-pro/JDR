import { describe, expect, it } from 'vitest';
import { GENERATOR_IDS, GENERATOR_INFO, registerAllGenerators } from '../../src/procgen/generators';
import { getGenerator, listGenerators } from '../../src/procgen/registry';

describe('generators registry', () => {
  it('registers the four generators, idempotently', () => {
    registerAllGenerators();
    registerAllGenerators();
    expect(listGenerators().map((g) => g.id)).toEqual(['cave', 'dungeon', 'outdoor', 'village']);
  });

  it('GENERATOR_INFO matches validate: valid defaults, bounds, presets', () => {
    registerAllGenerators();
    for (const id of GENERATOR_IDS) {
      const info = GENERATOR_INFO[id];
      const g = getGenerator(id);
      expect(info.version).toBe(g.version);
      expect(info.defaults).not.toHaveProperty('floors');
      // Defaults are a fixed point of validate (floors is forced to 1 for the dungeon).
      expect({ ...g.validate(info.defaults) }).toMatchObject(info.defaults);
      for (const spec of info.params) {
        expect(['width', 'height', 'floors']).not.toContain(spec.key);
        expect(info.defaults).toHaveProperty(spec.key);
        const d = info.defaults[spec.key];
        if (spec.kind === 'enum') {
          expect(spec.options).toContain(d);
          for (const o of spec.options!) {
            expect(g.validate({ [spec.key]: o })).toMatchObject({ [spec.key]: o });
          }
        } else if (spec.kind === 'bool') {
          expect(typeof d).toBe('boolean');
        } else {
          const min = spec.min!;
          const max = spec.max!;
          expect(d).toBeGreaterThanOrEqual(min);
          expect(d).toBeLessThanOrEqual(max);
          // The bounds are those of validate: they are accepted as is, beyond them is clamped.
          const at = (v: number) =>
            (g.validate({ ...info.defaults, [spec.key]: v }) as unknown as Record<string, number>)[
              spec.key
            ];
          // Interdependent keys (rooms / room_min ...) may tighten a bound: only check clamping.
          expect(at(min - 100)).toBeGreaterThanOrEqual(min);
          expect(at(max + 100)).toBeLessThanOrEqual(max);
          if (spec.kind === 'int') expect(Number.isInteger(at(min))).toBe(true);
        }
      }
      for (const preset of Object.values(info.presets)) {
        expect(() => g.validate({ ...info.defaults, ...preset })).not.toThrow();
      }
      expect(info.size.min).toBeLessThanOrEqual(info.defaults['width'] as number);
      expect(g.validate({ width: info.size.max + 50 })).toMatchObject({ width: info.size.max });
      expect(g.validate({ width: 1 })).toMatchObject({ width: info.size.min });
    }
  });

  it('zone generators are dungeon and cave', () => {
    expect(GENERATOR_IDS.filter((id) => GENERATOR_INFO[id].zone)).toEqual(['dungeon', 'cave']);
  });
});
