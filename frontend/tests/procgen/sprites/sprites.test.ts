import { describe, expect, it } from 'vitest';
import { PACK_KEYS } from '../../../src/procgen/pack-keys';
import { renderSprite, SPRITE_KEYS } from '../../../src/procgen/sprites';

const decor = PACK_KEYS.filter((p) => p.family === 'decor').map((p) => p.key);

describe('renderSprite', () => {
  it('covers exactly the 25 decor keys', () => {
    expect(decor).toHaveLength(25);
    expect([...SPRITE_KEYS].sort()).toEqual([...decor].sort());
  });

  it.each(decor)('%s: transparent corners, content, outline, deterministic', (key) => {
    const n = 256;
    const a = renderSprite(key, n);
    expect(a.length).toBe(n * n * 4);
    for (const [x, y] of [
      [0, 0],
      [n - 1, 0],
      [0, n - 1],
      [n - 1, n - 1],
    ] as const) {
      expect(a[(y * n + x) * 4 + 3], 'corner').toBe(0);
    }
    let opaque = 0;
    let dark = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3]! > 0) opaque++;
      if (a[i + 3]! >= 200 && Math.max(a[i]!, a[i + 1]!, a[i + 2]!) < 110) dark++;
    }
    expect(opaque).toBeGreaterThan(n * n * 0.04);
    if (key !== 'decor.web') expect(dark, 'outline').toBeGreaterThan(100);
    expect(Buffer.from(renderSprite(key, n)).equals(Buffer.from(a))).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(() => renderSprite('decor.nope')).toThrow();
    expect(() => renderSprite('floor.stone')).toThrow();
  });
});
