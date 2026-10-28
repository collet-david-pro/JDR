import { describe, expect, it } from 'vitest';
import { Rng, createRng, sfc32, xmur3 } from '../../src/procgen/prng';

describe('prng', () => {
  it('xmur3 is stable', () => {
    const h = xmur3('abc');
    expect([h(), h(), h(), h()]).toEqual(FROZEN_XMUR);
    expect(xmur3('abd')()).not.toBe(FROZEN_XMUR[0]);
  });

  it('sfc32 gives frozen values', () => {
    const r = sfc32(1, 2, 3, 4);
    expect(Array.from({ length: 10 }, () => r())).toEqual(FROZEN_SFC);
  });

  it('createRng seeds from seed:generator:version', () => {
    const h = xmur3('s:dungeon:1');
    const ref = sfc32(h(), h(), h(), h());
    const r = createRng('s', 'dungeon', 1);
    for (let i = 0; i < 5; i++) expect(r.nextU32()).toBe(ref());
    expect(createRng('s', 'dungeon', 2).nextU32()).not.toBe(createRng('s', 'dungeon', 1).nextU32());
  });

  it('next is in [0, 1) and roughly uniform', () => {
    const r = createRng('u', 'x', 1);
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      bins[Math.floor(v * 10)]!++;
    }
    for (const b of bins) expect(b).toBeGreaterThan(1700);
    for (const b of bins) expect(b).toBeLessThan(2300);
  });

  it('int reaches both bounds and never exceeds them', () => {
    const r = createRng('i', 'x', 1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(-3, 4);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect(seen.size).toBe(8);
    expect(r.int(5, 5)).toBe(5);
    expect(() => r.int(3, 2)).toThrow();
  });

  it('float, chance, pick, weighted', () => {
    const r = createRng('f', 'x', 1);
    for (let i = 0; i < 200; i++) {
      const v = r.float(2, 3);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(3);
    }
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (r.chance(0.25)) hits++;
    expect(hits).toBeGreaterThan(800);
    expect(hits).toBeLessThan(1200);
    expect(['a', 'b']).toContain(r.pick(['a', 'b']));
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 4000; i++)
      counts[r.weighted(['a', 'b', 'c'] as const, (k) => (k === 'a' ? 3 : k === 'b' ? 1 : 0))]++;
    expect(counts.c).toBe(0);
    expect(counts.a).toBeGreaterThan(2800);
    expect(() => r.weighted([1], () => 0)).toThrow();
  });

  it('shuffle is deterministic, in place and a permutation', () => {
    const a = Array.from({ length: 20 }, (_, i) => i);
    const out = createRng('sh', 'x', 1).shuffle(a);
    expect(out).toBe(a);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const b = createRng('sh', 'x', 1).shuffle(Array.from({ length: 20 }, (_, i) => i));
    expect(b).toEqual(a);
  });

  it('fork is independent and stable', () => {
    const r = createRng('fk', 'x', 1);
    const f1 = r.fork('rooms');
    const before = r.nextU32();
    const f2 = r.fork('rooms');
    expect(f1.nextU32()).toBe(f2.nextU32());
    expect(r.fork('other').nextU32()).not.toBe(r.fork('rooms').nextU32());
    expect(f1 instanceof Rng).toBe(true);
    // Forking did not consume the parent.
    const again = createRng('fk', 'x', 1);
    expect(again.nextU32()).toBe(before);
  });
});

const FROZEN_XMUR: number[] = [1792905582, 3065002282, 2336214789, 2910455134];
const FROZEN_SFC: number[] = [
  8, 35, 56623210, 207756683, 3469086937, 2920252771, 1846779140, 1194183609, 2103805335,
  3546956693,
];
