import { deflateRawSync as nodeDeflate, inflateRawSync as nodeInflate } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CompressionError, deflateRaw, inflateRaw } from '../../src/formats/compression';
import { InflateError, deflateRawSync, inflateRawSync } from '../../src/formats/deflate';
import { createRng } from '../../src/editor/util/rng';

function randomBytes(seed: number, n: number, alphabet = 256): Uint8Array {
  const rng = createRng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.int(alphabet);
  return out;
}

const samples: [string, Uint8Array][] = [
  ['empty', new Uint8Array(0)],
  ['one byte', new Uint8Array([42])],
  ['zeros', new Uint8Array(5000)],
  ['random', randomBytes(1, 4104)],
  ['low entropy', randomBytes(2, 20_000, 4)],
  ['large random (multi stored blocks)', randomBytes(3, 150_000)],
  ['text', new TextEncoder().encode('JDR '.repeat(3000) + 'fin')],
];

describe('JS deflate/inflate', () => {
  it.each(samples)('round-trips %s through the JS codec and zlib', (_name, data) => {
    const packed = deflateRawSync(data);
    expect(inflateRawSync(packed, data.length)).toEqual(data);
    // zlib (≈ PHP gzinflate) reads our output…
    expect(new Uint8Array(nodeInflate(packed))).toEqual(data);
    // …and we read zlib's (dynamic Huffman blocks) at every level.
    for (const level of [1, 6, 9]) {
      expect(inflateRawSync(new Uint8Array(nodeDeflate(data, { level })), data.length)).toEqual(
        data,
      );
    }
  });

  it('compresses repetitive data', () => {
    expect(deflateRawSync(new Uint8Array(4104)).length).toBeLessThan(40);
  });

  it('bounds the output size (anti-bomb)', () => {
    const bomb = new Uint8Array(nodeDeflate(new Uint8Array(1_000_000)));
    expect(() => inflateRawSync(bomb, 4104)).toThrow(InflateError);
    try {
      inflateRawSync(bomb, 4104);
    } catch (e) {
      expect((e as InflateError).code).toBe('output_limit');
    }
  });

  it('rejects corrupt streams with an InflateError (fuzzing)', () => {
    const rng = createRng(99);
    const base = new Uint8Array(nodeDeflate(randomBytes(4, 4104, 16)));
    let errors = 0;
    for (let i = 0; i < 3000; i++) {
      const bad = new Uint8Array(base);
      const mode = i % 3;
      if (mode === 0) {
        const at = rng.int(bad.length);
        bad[at] = bad[at]! ^ (1 << rng.int(8));
      }
      const input =
        mode === 1
          ? bad.subarray(0, rng.int(bad.length))
          : mode === 2
            ? randomBytes(1000 + i, 1 + rng.int(200))
            : bad;
      try {
        inflateRawSync(input, 8192);
      } catch (e) {
        expect(e).toBeInstanceOf(InflateError);
        errors++;
      }
    }
    expect(errors).toBeGreaterThan(1000);
  });
});

describe('compression facade', () => {
  it.each([false, true])('round-trips (forceJs=%s)', async (forceJs) => {
    const data = randomBytes(5, 4104, 8);
    const packed = await deflateRaw(data, { forceJs });
    expect(await inflateRaw(packed, 4104, { forceJs })).toEqual(data);
    // Native and JS outputs are interchangeable.
    expect(await inflateRaw(packed, 4104, { forceJs: !forceJs })).toEqual(data);
  });

  it.each([false, true])('reports errors as CompressionError (forceJs=%s)', async (forceJs) => {
    const packed = await deflateRaw(new Uint8Array(10_000), { forceJs });
    await expect(inflateRaw(packed, 4104, { forceJs })).rejects.toMatchObject({
      code: 'output_limit',
    });
    await expect(
      inflateRaw(new Uint8Array([0xff, 0xff, 0xff]), 4104, { forceJs }),
    ).rejects.toBeInstanceOf(CompressionError);
  });
});
