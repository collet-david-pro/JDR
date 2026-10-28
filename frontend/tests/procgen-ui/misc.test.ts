import { beforeEach, describe, expect, it } from 'vitest';
import { MapsClient } from '../../src/lib/maps/maps-client';
import { takeGeneration, stashGeneration } from '../../src/lib/procgen/handoff';
import { clearPackCache, loadPack } from '../../src/lib/procgen/pack';
import { previewPixels } from '../../src/lib/procgen/preview';
import { randomSeed } from '../../src/lib/procgen/seed';
import type { GenFloor, GenResult } from '../../src/procgen/types';
import { json, mockApi, ok } from '../fixtures/games';
import { makeMap, makeSummary } from '../maps/fixtures';

function result(f: Partial<GenFloor>, width = 6, height = 4): GenResult {
  return {
    generator: 'village',
    gen_version: 1,
    seed: 's',
    width,
    height,
    floors: [
      {
        ground: [],
        terrain: [],
        decor: [],
        walls: [],
        doors: [],
        windows: [],
        lights: [],
        rooms: [],
        entrance: null,
        exit: null,
        ...f,
      },
    ],
    stats: {},
  };
}
const px = (a: Uint8ClampedArray, w: number, x: number, y: number): number[] => {
  const i = (y * w + x) * 4;
  return [a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!];
};

describe('previewPixels', () => {
  it('one RGBA pixel per cell, transparent when empty', () => {
    const a = previewPixels(result({}));
    expect(a).toBeInstanceOf(Uint8ClampedArray);
    expect(a.length).toBe(6 * 4 * 4);
    expect(a.every((v) => v === 0)).toBe(true);
  });

  it('colors by family, walls on both sides of an edge, doors on top', () => {
    const w = 6;
    const a = previewPixels(
      result({
        ground: [
          { x: 0, y: 0, key: 'floor.grass' },
          { x: 1, y: 0, key: 'floor.cobble' },
          { x: 0, y: 1, key: 'floor.stone' },
          { x: 1, y: 1, key: 'floor.stone' },
        ],
        terrain: [{ x: 0, y: 0, key: 'terrain.water' }],
        decor: [
          { x: 1, y: 1, key: 'decor.barrel' },
          { x: 2, y: 1, key: 'decor.rug' },
        ],
        walls: [
          {
            points: [
              [0, 1],
              [2, 1],
            ],
            closed: false,
            kind: 'stone',
          },
        ],
        doors: [{ a: [1, 1], b: [2, 1], secret: false, locked: false, swing: 'a' }],
      }),
    );
    expect(px(a, w, 0, 0)).toEqual([24, 22, 28, 255]); // wall bordering (0,1) from above
    expect(px(a, w, 1, 0)).toEqual([255, 64, 200, 255]); // door
    expect(px(a, w, 1, 1)).toEqual([255, 64, 200, 255]); // door wins on the other side
    expect(px(a, w, 0, 1)).toEqual([24, 22, 28, 255]);
    expect(px(a, w, 2, 0)[3]).toBe(0);
    const water = previewPixels(result({ terrain: [{ x: 0, y: 0, key: 'terrain.water' }] }));
    expect(px(water, w, 0, 0)).toEqual([64, 130, 205, 255]);
    const decor = previewPixels(
      result({
        decor: [
          { x: 3, y: 3, key: 'decor.barrel' },
          { x: 4, y: 3, key: 'decor.rug' },
        ],
      }),
    );
    expect(px(decor, w, 3, 3)).not.toEqual(px(decor, w, 4, 3));
  });

  it('ignores out-of-range cells', () => {
    expect(() =>
      previewPixels(
        result({
          ground: [{ x: 99, y: 99, key: 'floor.stone' }],
          walls: [
            {
              points: [
                [-3, 0],
                [99, 0],
              ],
              closed: false,
              kind: 'stone',
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe('randomSeed', () => {
  it('8 base-36 characters, varying', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()));
    for (const s of seeds) expect(s).toMatch(/^[0-9a-z]{8}$/);
    expect(seeds.size).toBeGreaterThan(45);
  });
});

describe('handoff', () => {
  it('is single use and per map', () => {
    const r = result({});
    stashGeneration('7', { result: r, params: { a: 1 } });
    expect(takeGeneration('8')).toBeNull();
    expect(takeGeneration('7')).toEqual({ result: r, params: { a: 1 } });
    expect(takeGeneration('7')).toBeNull();
  });
});

describe('loadPack', () => {
  beforeEach(() => clearPackCache());
  const wire = {
    version: 2,
    assets: { 'floor.stone': { asset_id: '5', url: 'https://x/a', name: 'Pierre' } },
  };

  it('loads once (cache), clearPackCache reloads', async () => {
    const { api, fetchMock } = mockApi(() => json(ok(wire)));
    const [a, b] = await Promise.all([loadPack(api), loadPack(api)]);
    expect(a).toBe(b);
    expect(a).toEqual({
      version: 2,
      assets: { 'floor.stone': { asset_id: '5', url: 'https://x/a', name: 'Pierre' } },
    });
    await loadPack(api);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/v1/procgen/pack');
    clearPackCache();
    await loadPack(api);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure and accepts an empty pack', async () => {
    let fail = true;
    const { api } = mockApi(() =>
      fail
        ? json({ ok: false, error: { code: 'x', message: 'x' } }, 500)
        : json(ok({ version: 1, assets: {} })),
    );
    await expect(loadPack(api)).rejects.toBeDefined();
    fail = false;
    expect(await loadPack(api)).toEqual({ version: 1, assets: {} });
  });
});

describe('MapsClient P8', () => {
  it('createVersion sends kind only when not manual; update carries generation', async () => {
    const bodies: unknown[] = [];
    const { api } = mockApi((url, init) => {
      bodies.push([init.method, url, typeof init.body === 'string' ? JSON.parse(init.body) : null]);
      return json(ok(url.includes('versions') ? { id: '1' } : makeSummary()));
    });
    const client = new MapsClient(api);
    await client.createVersion('3');
    await client.createVersion('3', ' Avant ', 'pre_generate');
    const generation = { generator: 'cave', gen_version: 1, seed: 's', params: { fill: 0.4 } };
    await client.update('3', { generation });
    await client.update('3', { generation: null });
    expect(bodies).toEqual([
      ['POST', '/api/v1/maps/3/versions', {}],
      ['POST', '/api/v1/maps/3/versions', { label: 'Avant', kind: 'pre_generate' }],
      ['PATCH', '/api/v1/maps/3', { generation }],
      ['PATCH', '/api/v1/maps/3', { generation: null }],
    ]);
    expect(makeMap().generation ?? null).toBeNull();
  });
});
