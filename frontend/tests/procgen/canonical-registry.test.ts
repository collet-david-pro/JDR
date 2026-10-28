import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, fingerprint, sha256Hex } from '../../src/procgen/canonical';
import { fallbackKey, isPackKey, PACK_KEYS, packKey } from '../../src/procgen/pack-keys';
import {
  GenCancelled,
  getGenerator,
  registerGenerator,
  runGenerator,
  unregisterGenerator,
} from '../../src/procgen/registry';
import type { GenFloor, GenResult, Generator } from '../../src/procgen/types';

export function emptyFloor(): GenFloor {
  return {
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
  };
}

describe('canonical', () => {
  it('ignores key order, rounds, normalises -0', () => {
    expect(canonicalJson({ b: 1, a: [1.23456, -0, 2] })).toBe('{"a":[1.235,0,2],"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson({ a: undefined, b: null, c: 'é"', d: true })).toBe(
      '{"b":null,"c":"é\\"","d":true}',
    );
    expect(canonicalJson(0.0004)).toBe('0');
    expect(canonicalJson(-0.0004)).toBe('0');
  });
  it('rejects NaN, Infinity and undefined in arrays', () => {
    expect(() => canonicalJson([NaN])).toThrow();
    expect(() => canonicalJson({ a: Infinity })).toThrow();
    expect(() => canonicalJson([1, undefined])).toThrow();
  });
  it('sha256Hex of abc', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('fingerprint is stable', async () => {
    const r: GenResult = {
      generator: 'cave',
      gen_version: 1,
      seed: 's',
      width: 1,
      height: 1,
      floors: [emptyFloor()],
      stats: {},
    };
    expect(await fingerprint(r)).toBe(await sha256Hex(canonicalJson(r)));
    expect(await fingerprint(r)).toHaveLength(64);
  });
});

describe('pack keys', () => {
  it('catalogue', () => {
    expect(PACK_KEYS.length).toBe(39);
    const keys = PACK_KEYS.map((p) => p.key);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(packKey('decor.barrel').blocking).toBe(true);
    expect(packKey('decor.chair').blocking).toBe(false);
    expect(PACK_KEYS.filter((p) => p.blocking).length).toBe(14);
    expect(() => packKey('nope')).toThrow();
    expect(isPackKey('floor.cave')).toBe(true);
    expect(fallbackKey('floor.stone')).toBeNull();
    expect(fallbackKey('floor.cave')).toBe('floor.stone');
    expect(fallbackKey('terrain.lava')).toBe('terrain.water');
    expect(fallbackKey('decor.barrel')).toBeNull();
  });
});

let seen: { ver: number; first: number } | null = null;
const fake = (
  version: number,
  cells: 'dup' | 'unsorted' | 'ok' = 'ok',
): Generator<{ n: number }> => ({
  id: 'cave',
  version,
  defaults: { n: 3 },
  presets: {},
  validate(p) {
    const n = (p as { n?: number } | null)?.n ?? 3;
    if (typeof n !== 'number') throw new Error('bad');
    return { n };
  },
  generate(p, ctx) {
    seen = { ver: version, first: ctx.rng.nextU32() };
    const f = emptyFloor();
    f.ground = [
      { x: 2, y: 1, key: 'floor.stone' },
      { x: 0, y: 1, key: 'floor.stone' },
      { x: 5, y: 0, key: 'floor.stone' },
    ];
    if (cells === 'dup') f.ground.push({ x: 5, y: 0, key: 'floor.dirt' });
    for (let i = 0; i < p.n; i++) ctx.progress('phase', i, p.n);
    return {
      generator: 'cave',
      gen_version: version,
      seed: ctx.rng.seedStr.split(':')[0]!,
      width: 6,
      height: 2,
      floors: [f],
      stats: { n: p.n },
    };
  },
});

describe('registry', () => {
  afterEach(() => unregisterGenerator('cave'));

  it('sorts cells and reports progress', () => {
    registerGenerator(fake(1));
    const calls: string[] = [];
    const r = runGenerator(
      'cave',
      1,
      'seed',
      { n: 2 },
      { progress: (p, d, t) => calls.push(`${p}${d}/${t}`) },
    );
    expect(r.floors[0]!.ground.map((c) => [c.x, c.y])).toEqual([
      [5, 0],
      [0, 1],
      [2, 1],
    ]);
    expect(calls).toEqual(['phase0/2', 'phase1/2']);
  });

  it('rejects duplicate cells, bad seeds and bad params', () => {
    registerGenerator(fake(1, 'dup'));
    expect(() => runGenerator('cave', 1, 'seed', {})).toThrow(/Duplicate/);
    expect(() => runGenerator('cave', 1, '', {})).toThrow();
    expect(() => runGenerator('cave', 1, 'x'.repeat(65), {})).toThrow();
    expect(() => runGenerator('cave', 1, 's', { n: 'a' })).toThrow('bad');
    expect(() => runGenerator('dungeon', 1, 's', {})).toThrow();
  });

  it('cancellation throws GenCancelled from progress', () => {
    registerGenerator(fake(1));
    let cancelled = false;
    expect(() =>
      runGenerator(
        'cave',
        1,
        's',
        { n: 3 },
        {
          isCancelled: () => cancelled,
          progress: (_p, d) => {
            if (d === 1) cancelled = true;
          },
        },
      ),
    ).toThrow(GenCancelled);
  });

  it('keeps several versions callable; current = highest', () => {
    registerGenerator(fake(1));
    registerGenerator(fake(2));
    expect(getGenerator('cave').version).toBe(2);
    expect(getGenerator('cave', 1).version).toBe(1);
    expect(() => registerGenerator(fake(2))).toThrow();
    expect(() => getGenerator('cave', 3)).toThrow();
    runGenerator('cave', 1, 'abc', {});
    const a = seen!;
    runGenerator('cave', 2, 'abc', {});
    expect(a.ver).toBe(1);
    expect(seen!.ver).toBe(2);
    expect(seen!.first).not.toBe(a.first);
    runGenerator('cave', 1, 'abc', {});
    expect(seen!.first).toBe(a.first);
  });
});
