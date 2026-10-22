import { describe, expect, it } from 'vitest';
import { inflateRawSync, inflateSync } from 'node:zlib';
import {
  FILTER_PAETH,
  FILTER_SUB,
  PngEncoder,
  adler32,
  createDeflateStream,
  crc32,
  filterRow,
  type PngEncoderOptions,
} from '../../src/formats/png-encoder';
import { collector, decodePng, referenceCrc32 } from './png-decode';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Image with smooth areas, noise and transparency. */
function sampleImage(width: number, height: number, seed = 1): Uint8Array {
  const r = rng(seed);
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const noisy = (x >> 3) % 3 === 0;
      px[i] = noisy ? Math.floor(r() * 256) : (x * 7) & 0xff;
      px[i + 1] = (y * 5 + x) & 0xff;
      px[i + 2] = ((x ^ y) * 3) & 0xff;
      px[i + 3] = (x + y) % 5 === 0 ? 0 : 255;
    }
  }
  return px;
}

async function encode(rgba: Uint8Array, options: PngEncoderOptions, band = 7): Promise<Uint8Array> {
  const out = collector();
  const enc = new PngEncoder(options, out.sink);
  await enc.begin();
  for (let y = 0; y < options.height; y += band) {
    const n = Math.min(band, options.height - y);
    await enc.writeRows(rgba, n, y * options.width * 4);
  }
  await enc.end();
  return out.bytes();
}

function expectSamePixels(rgba: Uint8Array, decoded: Uint8Array, alpha: boolean): void {
  expect(decoded.length).toBe(rgba.length);
  for (let i = 0; i < rgba.length; i++) {
    const expected = !alpha && i % 4 === 3 ? 255 : rgba[i];
    if (decoded[i] !== expected) throw new Error(`pixel byte ${i}: ${decoded[i]} ≠ ${expected}`);
  }
}

describe('checksums', () => {
  it('crc32 matches the reference and known values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const data = sampleImage(13, 9);
    expect(crc32(data)).toBe(referenceCrc32(data));
    expect(crc32(data.subarray(100), crc32(data.subarray(0, 100)))).toBe(crc32(data));
  });

  it('adler32 matches the zlib trailer', () => {
    const data = sampleImage(300, 40);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
    expect(adler32(data.subarray(1000), adler32(data.subarray(0, 1000)))).toBe(adler32(data));
  });
});

describe('filterRow', () => {
  it('picks Sub for a gradient row and Paeth for a vertically repeated row', () => {
    const grad = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
    const zero = new Uint8Array(64);
    const out = new Uint8Array(65);
    expect(filterRow(grad, zero, 4, out)).toBe(FILTER_SUB);
    const noise = Uint8Array.from({ length: 64 }, (_, i) => (i * 97) % 251);
    expect(filterRow(noise, noise, 4, out)).toBe(FILTER_PAETH);
  });
});

describe('deflate streams', () => {
  const data = sampleImage(200, 50, 3);
  for (const impl of ['native', 'js'] as const) {
    it(`${impl} zlib stream round-trips (several writes, small segments)`, async () => {
      const out = collector();
      const s = createDeflateStream('zlib', out.sink, { impl, jsSegmentBytes: 3000 });
      for (let o = 0; o < data.length; o += 1777) await s.write(data.slice(o, o + 1777));
      await s.close();
      expect(new Uint8Array(inflateSync(out.bytes()))).toEqual(data);
    });
    it(`${impl} raw stream round-trips, also empty`, async () => {
      for (const input of [data, new Uint8Array(0), new Uint8Array(70_000)]) {
        const out = collector();
        const s = createDeflateStream('raw', out.sink, { impl, jsSegmentBytes: 4096 });
        await s.write(input.slice());
        await s.close();
        expect(new Uint8Array(inflateRawSync(out.bytes()))).toEqual(input);
      }
    });
  }

  it('JS stream handles stored segments (incompressible data)', async () => {
    const r = rng(9);
    const noise = Uint8Array.from({ length: 200_000 }, () => Math.floor(r() * 256));
    const out = collector();
    const s = createDeflateStream('zlib', out.sink, { impl: 'js', jsSegmentBytes: 70_000 });
    await s.write(noise);
    await s.close();
    expect(new Uint8Array(inflateSync(out.bytes()))).toEqual(noise);
  });

  it('propagates a sink failure to write()', async () => {
    const s = createDeflateStream(
      'zlib',
      () => {
        throw new Error('disk full');
      },
      { impl: 'native' },
    );
    const r = rng(2);
    const noise = Uint8Array.from({ length: 300_000 }, () => Math.floor(r() * 256));
    await expect(
      (async () => {
        for (let i = 0; i < 20; i++) await s.write(noise.slice());
        await s.close();
      })(),
    ).rejects.toThrow('disk full');
  });
});

describe('PngEncoder', () => {
  const cases: [string, number, number][] = [
    ['1×1', 1, 1],
    ['odd 37×23', 37, 23],
    ['wide 5000×3', 5000, 3],
    ['tall 3×300', 3, 300],
  ];
  for (const [label, w, h] of cases) {
    for (const alpha of [true, false]) {
      for (const impl of ['native', 'js'] as const) {
        it(`${label} ${alpha ? 'RGBA' : 'RGB'} (${impl}) decodes to the same pixels`, async () => {
          const rgba = sampleImage(w, h, w + h);
          const png = await encode(rgba, { width: w, height: h, alpha, deflate: { impl } });
          const d = decodePng(png);
          expect([d.width, d.height, d.colorType]).toEqual([w, h, alpha ? 6 : 2]);
          expectSamePixels(rgba, d.rgba, alpha);
        });
      }
    }
  }

  it('cuts IDAT into 64 KB chunks and ends with IEND', async () => {
    const w = 700;
    const h = 200;
    const r = rng(5);
    const rgba = Uint8Array.from({ length: w * h * 4 }, () => Math.floor(r() * 256));
    const png = await encode(rgba, { width: w, height: h, alpha: true }, 64);
    const d = decodePng(png);
    const idat = d.chunks.filter((c) => c.type === 'IDAT');
    expect(idat.length).toBeGreaterThan(2);
    for (const c of idat.slice(0, -1)) expect(c.data.length).toBe(65536);
    expect(d.chunks.map((c) => c.type).at(-1)).toBe('IEND');
    expect(d.chunks.map((c) => c.type).slice(0, 1)).toEqual(['IHDR']);
    expectSamePixels(rgba, d.rgba, true);
  });

  it('writes pHYs (px/m) and text chunks (tEXt, iTXt for non Latin-1)', async () => {
    const ppm = Math.round(70 / (25 / 1000));
    const png = await encode(new Uint8Array(4 * 4 * 4), {
      width: 4,
      height: 4,
      alpha: false,
      pixelsPerMeter: ppm,
      text: [
        { keyword: 'Title', value: 'Crypte été' },
        { keyword: 'Software', value: 'JDR' },
        { keyword: 'Comment', value: 'Donjon ⚔' },
      ],
    });
    const d = decodePng(png);
    expect(d.chunks.map((c) => c.type)).toEqual([
      'IHDR',
      'pHYs',
      'tEXt',
      'tEXt',
      'iTXt',
      'IDAT',
      'IEND',
    ]);
    const phys = d.chunks[1]!.data;
    const v = new DataView(phys.buffer, phys.byteOffset, 9);
    expect([v.getUint32(0), v.getUint32(4), phys[8]]).toEqual([2800, 2800, 1]);
    expect(Buffer.from(d.chunks[2]!.data).toString('latin1')).toBe('Title\0Crypte été');
    const itxt = Buffer.from(d.chunks[4]!.data);
    expect(itxt.subarray(0, 8).toString('latin1')).toBe('Comment\0');
    expect(itxt.subarray(12).toString('utf8')).toBe('Donjon ⚔');
  });

  it('rejects bad dimensions and incomplete images', async () => {
    expect(() => new PngEncoder({ width: 0, height: 1, alpha: true }, () => undefined)).toThrow();
    expect(() => new PngEncoder({ width: 1.5, height: 1, alpha: true }, () => undefined)).toThrow();
    const enc = new PngEncoder({ width: 2, height: 2, alpha: true }, () => undefined);
    await enc.begin();
    await enc.writeRows(new Uint8Array(8), 1);
    await expect(enc.end()).rejects.toThrow(/incomplete/);
    await expect(enc.writeRows(new Uint8Array(16), 2)).rejects.toThrow(/Too many/);
  });

  it('applies back-pressure: a slow sink bounds the pending output', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const sink = async (): Promise<void> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    };
    const w = 512;
    const h = 256;
    const r = rng(7);
    const rgba = Uint8Array.from({ length: w * h * 4 }, () => Math.floor(r() * 256));
    const enc = new PngEncoder({ width: w, height: h, alpha: true }, sink);
    await enc.begin();
    for (let y = 0; y < h; y += 32) await enc.writeRows(rgba, 32, y * w * 4);
    await enc.end();
    expect(maxInFlight).toBe(1);
  });
});
