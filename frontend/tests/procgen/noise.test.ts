import { describe, expect, it } from 'vitest';
import { fbm, simplex2D, valueNoise2D } from '../../src/procgen/noise';
import { createRng } from '../../src/procgen/prng';

const makers = { value: valueNoise2D, simplex: simplex2D };

describe.each(Object.entries(makers))('%s noise', (_name, make) => {
  it('is deterministic and seed-dependent', () => {
    const a = make(createRng('n', 'x', 1));
    const b = make(createRng('n', 'x', 1));
    const c = make(createRng('other', 'x', 1));
    let diff = 0;
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.61;
      expect(a(x, y)).toBe(b(x, y));
      if (a(x, y) !== c(x, y)) diff++;
    }
    expect(diff).toBeGreaterThan(40);
  });

  it('stays in [-1, 1] and uses a good part of the range', () => {
    const f = make(createRng('b', 'x', 1));
    let min = 1;
    let max = -1;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const v = f(x * 0.13, y * 0.13);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.8);
  });

  it('is exactly periodic', () => {
    for (const period of [8, 16, 256]) {
      const f = make(createRng('p', 'x', 1), { period });
      for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 40; j++) {
          const x = i / 8 + 0.125 * j;
          const y = j / 4 - 3 + i / 16;
          expect(f(x + period, y)).toBe(f(x, y));
          expect(f(x, y + period)).toBe(f(x, y));
          expect(f(x - 2 * period, y + period)).toBe(f(x, y));
        }
      }
    }
  });

  it('is roughly continuous', () => {
    const f = make(createRng('c', 'x', 1));
    for (let i = 0; i < 500; i++) {
      const x = i * 0.071;
      const y = i * 0.113;
      expect(Math.abs(f(x + 0.001, y) - f(x, y))).toBeLessThan(0.1);
    }
  });
});

describe('fbm', () => {
  it('is normalised, deterministic and periodic with an integer lacunarity', () => {
    const f = simplex2D(createRng('fbm', 'x', 1), { period: 16 });
    for (let i = 0; i < 200; i++) {
      const x = i * 0.31;
      const y = i * 0.17;
      const v = fbm(f, x, y);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(fbm(f, x, y)).toBe(v);
    }
    expect(fbm(f, 3.25 + 16, 1.5, { octaves: 3 })).toBe(fbm(f, 3.25, 1.5, { octaves: 3 }));
    expect(fbm(f, 2.3, 4.1, { octaves: 1 })).toBe(f(2.3, 4.1));
  });
});
