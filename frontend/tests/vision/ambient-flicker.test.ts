import { describe, expect, it } from 'vitest';
import type { Ambient } from '../../src/editor/contracts';
import { ambientAt, dayCurve, mixAmbient, parseHex } from '../../src/vision/ambient';
import { flickerFactor, hashSeed, valueNoise } from '../../src/vision/flicker';

const base: Ambient = {
  darkness: 0.5,
  tint: '#000000',
  time_of_day: null,
  weather: { type: 'none', intensity: 0 },
};

describe('ambient (14.2)', () => {
  it('treats #000000 as no tint and blends the tint with the darkness', () => {
    expect(ambientAt(base)).toEqual({ darkness: 0.5, tint: [1, 1, 1] });
    const blue = ambientAt({ ...base, darkness: 1, tint: '#0000ff' });
    expect(blue.tint[2]).toBe(1);
    expect(blue.tint[0]).toBeCloseTo(0.4);
    expect(ambientAt({ ...base, darkness: 0, tint: '#ff0000' }).tint).toEqual([1, 1, 1]);
  });

  it('follows the day/night curve when time_of_day is set (cyclic, continuous)', () => {
    expect(ambientAt({ ...base, time_of_day: 12 }).darkness).toBe(0);
    expect(ambientAt({ ...base, time_of_day: 0 }).darkness).toBeCloseTo(0.9);
    expect(dayCurve(24).darkness).toBeCloseTo(dayCurve(0).darkness);
    for (let h = 0; h < 24; h += 0.25) {
      expect(Math.abs(dayCurve(h + 0.01).darkness - dayCurve(h).darkness)).toBeLessThan(0.05);
    }
  });

  it('mixes two ambients with easing', () => {
    const a = ambientAt({ ...base, darkness: 0 });
    const b = ambientAt({ ...base, darkness: 1 });
    expect(mixAmbient(a, b, 0)).toEqual(a);
    expect(mixAmbient(a, b, 1).darkness).toBe(1);
    expect(mixAmbient(a, b, 0.5).darkness).toBeCloseTo(0.5);
    expect(parseHex('nope')).toEqual([0, 0, 0]);
  });
});

describe('flicker (14.2)', () => {
  it('is deterministic per uid and bounded by amp', () => {
    const f = { type: 'torch', amp: 0.3, speed: 2 } as const;
    const s = hashSeed('light-1');
    expect(hashSeed('light-1')).toBe(s);
    expect(hashSeed('light-2')).not.toBe(s);
    for (let t = 0; t < 5000; t += 37) {
      const v = flickerFactor(f, s, t);
      expect(v).toBeGreaterThanOrEqual(0.7);
      expect(v).toBeLessThanOrEqual(1);
      expect(flickerFactor(f, s, t)).toBe(v);
    }
    expect(flickerFactor({ type: 'none', amp: 1, speed: 1 }, s, 100)).toBe(1);
    const p = flickerFactor({ type: 'pulse', amp: 0.5, speed: 1 }, s, 250);
    expect(p).toBeGreaterThanOrEqual(0.5);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('value noise is smooth', () => {
    for (let t = 0; t < 10; t += 0.1) {
      expect(Math.abs(valueNoise(1, t + 0.001) - valueNoise(1, t))).toBeLessThan(0.01);
    }
  });
});
