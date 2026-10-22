import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { ZipWriter, dosDateTime } from '../../src/formats/zip-writer';
import { collector, referenceCrc32 } from './png-decode';

interface ReadEntry {
  name: string;
  data: Uint8Array;
  method: number;
  flags: number;
}

/** Minimal ZIP reader: end record → central directory → local headers (data descriptors). */
function readZip(zip: Uint8Array): ReadEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  let o = v.getUint32(eocd + 16, true);
  expect(o + cdSize).toBe(eocd);
  const entries: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(o, true)).toBe(0x02014b50);
    const flags = v.getUint16(o + 8, true);
    const method = v.getUint16(o + 10, true);
    const crc = v.getUint32(o + 16, true);
    const csize = v.getUint32(o + 20, true);
    const size = v.getUint32(o + 24, true);
    const nameLen = v.getUint16(o + 28, true);
    const local = v.getUint32(o + 42, true);
    const name = new TextDecoder().decode(zip.subarray(o + 46, o + 46 + nameLen));
    // Local header
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const lNameLen = v.getUint16(local + 26, true);
    const lExtra = v.getUint16(local + 28, true);
    expect(new TextDecoder().decode(zip.subarray(local + 30, local + 30 + lNameLen))).toBe(name);
    const start = local + 30 + lNameLen + lExtra;
    const raw = zip.subarray(start, start + csize);
    // Data descriptor right after the data.
    expect(v.getUint32(start + csize, true)).toBe(0x08074b50);
    expect(v.getUint32(start + csize + 4, true)).toBe(crc);
    expect(v.getUint32(start + csize + 8, true)).toBe(csize);
    expect(v.getUint32(start + csize + 12, true)).toBe(size);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw.slice();
    expect(data.length).toBe(size);
    expect(referenceCrc32(data)).toBe(crc);
    entries.push({ name, data, method, flags });
    o += 46 + nameLen;
  }
  return entries;
}

const bytes = (n: number, seed: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => ((i * seed) ^ (i >> 7)) & 0xff);

describe('ZipWriter', () => {
  for (const impl of ['native', 'js'] as const) {
    it(`writes stored and deflated entries readable by a reader (${impl})`, async () => {
      const out = collector();
      const zip = new ZipWriter(out.sink, { impl });
      const a = await zip.open('crypte_p01.png');
      await a.write(bytes(1000, 3));
      await a.write(bytes(70_000, 5));
      await a.close();
      const b = await zip.open('Château été/p02.txt', { method: 'deflate' });
      await b.write(new TextEncoder().encode('bonjour '.repeat(5000)));
      await b.close();
      const c = await zip.open('vide.bin', { method: 'deflate' });
      await c.close();
      await zip.finish();
      const entries = readZip(out.bytes());
      expect(entries.map((e) => e.name)).toEqual([
        'crypte_p01.png',
        'Château été/p02.txt',
        'vide.bin',
      ]);
      expect(entries.map((e) => e.method)).toEqual([0, 8, 8]);
      expect(entries.every((e) => (e.flags & 0x0808) === 0x0808)).toBe(true);
      const expectedA = new Uint8Array([...bytes(1000, 3), ...bytes(70_000, 5)]);
      expect(entries[0]!.data).toEqual(expectedA);
      expect(new TextDecoder().decode(entries[1]!.data)).toBe('bonjour '.repeat(5000));
      expect(entries[2]!.data.length).toBe(0);
      expect(zip.size).toBe(out.bytes().length);
    });
  }

  it('refuses a second entry while one is open, and an empty archive is valid', async () => {
    const out = collector();
    const zip = new ZipWriter(out.sink);
    await zip.open('a');
    await expect(zip.open('b')).rejects.toThrow(/not closed/);
    const empty = collector();
    const z2 = new ZipWriter(empty.sink);
    await z2.finish();
    expect(readZip(empty.bytes())).toEqual([]);
  });

  it('encodes DOS dates', () => {
    const d = dosDateTime(new Date(2026, 9, 22, 13, 45, 31));
    expect(d.time).toBe((13 << 11) | (45 << 5) | 15);
    expect(d.date).toBe(((2026 - 1980) << 9) | (10 << 5) | 22);
  });
});
