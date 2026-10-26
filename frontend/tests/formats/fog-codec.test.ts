import { describe, expect, it } from 'vitest';
import {
  FOG_RAW_BYTES,
  FogCodecError,
  createFogBitmap,
  decodeFog,
  encodeFog,
  fogAndNot,
  fogFromBase64,
  fogOr,
  fogToBase64,
  getFogBit,
  isFogEmpty,
  setFogBit,
} from '../../src/formats/fog-codec';
import { createRng } from '../../src/editor/util/rng';

describe('fog codec (12.3)', () => {
  it('addresses bits row-major, most significant bit first', () => {
    const bits = createFogBitmap();
    setFogBit(bits, 0, 0);
    setFogBit(bits, 9, 0);
    setFogBit(bits, 127, 127);
    expect(bits[0]).toBe(0x80);
    expect(bits[1]).toBe(0x40);
    expect(bits[FOG_RAW_BYTES - 1]).toBe(0x01);
    expect(getFogBit(bits, 9, 0)).toBe(true);
    expect(getFogBit(bits, 8, 0)).toBe(false);
    setFogBit(bits, 9, 0, false);
    expect(bits[1]).toBe(0);
  });

  it('round-trips random bitmaps (JS and native deflate)', async () => {
    const rng = createRng(7);
    for (let n = 0; n < 20; n++) {
      const bits = createFogBitmap();
      for (let i = 0; i < 300; i++) setFogBit(bits, rng.int(128), rng.int(128));
      for (const forceJs of [false, true]) {
        const data = await encodeFog(bits, { forceJs });
        expect(data).not.toBeNull();
        const back = await decodeFog(data!, { forceJs });
        expect(back).toEqual(bits);
        expect(await decodeFog(fogFromBase64(fogToBase64(data!)))).toEqual(bits);
      }
    }
  });

  it('never encodes an empty bitmap and refuses bad sizes', async () => {
    expect(await encodeFog(createFogBitmap())).toBeNull();
    const { deflateRaw } = await import('../../src/formats/compression');
    await expect(decodeFog(await deflateRaw(new Uint8Array(10)))).rejects.toBeInstanceOf(
      FogCodecError,
    );
    await expect(decodeFog(await deflateRaw(new Uint8Array(4096)))).rejects.toMatchObject({
      code: 'bad_size',
    });
    await expect(decodeFog(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(FogCodecError);
    expect(() => fogFromBase64('***')).toThrow(FogCodecError);
  });

  it('merges with OR and clears with AND NOT, reporting the changed bits', () => {
    const a = createFogBitmap();
    const b = createFogBitmap();
    a[0] = 0b1100_0000;
    b[0] = 0b1010_0000;
    const added = fogOr(a, b);
    expect(a[0]).toBe(0b1110_0000);
    expect(added?.[0]).toBe(0b0010_0000);
    expect(fogOr(a, b)).toBeNull();
    const removed = fogAndNot(a, b);
    expect(a[0]).toBe(0b0100_0000);
    expect(removed?.[0]).toBe(0b1010_0000);
    expect(fogAndNot(a, b)).toBeNull();
    expect(isFogEmpty(a)).toBe(false);
  });
});
