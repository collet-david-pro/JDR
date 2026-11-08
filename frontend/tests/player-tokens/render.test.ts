import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultDesign } from '../../src/lib/player-tokens/design';
import { EMBLEMS, SHAPE_PATHS } from '../../src/lib/player-tokens/emblems';
import { drawToken } from '../../src/lib/player-tokens/render';

class FakePath {
  constructor(readonly d: string) {}
}

function fakeContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(
        `${name}(${args.map((a) => (a instanceof FakePath ? 'path' : JSON.stringify(a))).join(',')})`,
      );
    };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (t, key: string) =>
      key in t
        ? t[key]
        : [
              'save',
              'restore',
              'scale',
              'translate',
              'fill',
              'stroke',
              'clip',
              'clearRect',
              'drawImage',
            ].includes(key)
          ? record(key)
          : undefined,
    set: (t, key: string, value) => {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('drawToken', () => {
  (globalThis as unknown as { Path2D: unknown }).Path2D = FakePath;

  it('draws ring, inside, clip and the emblem, balanced save/restore', () => {
    const { ctx, calls } = fakeContext();
    drawToken(ctx, defaultDesign(), 512, null);
    expect(calls.filter((c) => c.startsWith('save')).length).toBe(
      calls.filter((c) => c.startsWith('restore')).length,
    );
    expect(calls).toContain('scale(5.12,5.12)');
    expect(calls.some((c) => c.startsWith('clip'))).toBe(true);
    expect(calls.filter((c) => c.startsWith('fill(')).length).toBe(3);
    expect(calls.some((c) => c.startsWith('drawImage'))).toBe(false);
  });

  it('draws the cropped portrait covering the shape, and no emblem', () => {
    const { ctx, calls } = fakeContext();
    const design = { ...defaultDesign(), mode: 'portrait' as const };
    drawToken(ctx, design, 256, { image: {} as CanvasImageSource, width: 800, height: 600 });
    const draw = calls.find((c) => c.startsWith('drawImage'));
    expect(draw).toBeDefined();
    expect(calls.filter((c) => c.startsWith('fill(')).length).toBe(2);
  });

  it('a portrait mode without image draws neither emblem nor portrait', () => {
    const { ctx, calls } = fakeContext();
    drawToken(ctx, { ...defaultDesign(), mode: 'portrait' }, 256, null);
    expect(calls.some((c) => c.startsWith('drawImage'))).toBe(false);
    expect(calls.filter((c) => c.startsWith('fill(')).length).toBe(2);
  });
});

describe('vector library', () => {
  it('has unique ids, well-formed paths and at least a few per group', () => {
    const ids = EMBLEMS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of ['class', 'creature', 'symbol']) {
      expect(EMBLEMS.filter((e) => e.group === group).length).toBeGreaterThanOrEqual(8);
    }
    for (const path of [...EMBLEMS.map((e) => e.path), ...Object.values(SHAPE_PATHS)]) {
      expect(path).toMatch(/^M[MmLlHhVvCcSsQqAaZz0-9 .,-]+$/);
      expect(path.endsWith('z')).toBe(true);
      for (const n of path.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Math.abs(Number(n))).toBeLessThanOrEqual(100);
      }
    }
  });

  it('every emblem and shape has a French label', () => {
    const fr = JSON.parse(
      readFileSync(new URL('../../../i18n/fr.json', import.meta.url), 'utf8'),
    ) as { player_tokens: { emblems: Record<string, string>; shape: Record<string, string> } };
    for (const e of EMBLEMS) expect(fr.player_tokens.emblems[e.id], e.id).toBeTruthy();
    for (const s of Object.keys(SHAPE_PATHS)) expect(fr.player_tokens.shape[s], s).toBeTruthy();
  });
});
