import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  listZipEntries,
  MapFileError,
  readMapFile,
  type MapFileErrorCode,
} from '../../src/formats/map-document-file';

const text = readFileSync(
  fileURLToPath(new URL('./fixtures/map-v1.json', import.meta.url)),
  'utf8',
);

/** Minimal ZIP writer (stored or deflate, CRC left at 0: the reader does not check it). */
function zip(files: { name: string; data: Uint8Array | string; deflate?: boolean }[]): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const data = f.deflate === true ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = enc.encode(f.name);
    const local = new DataView(new ArrayBuffer(30 + name.length + data.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, f.deflate === true ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    const l = new Uint8Array(local.buffer);
    l.set(name, 30);
    l.set(data, 30 + name.length);
    const central = new DataView(new ArrayBuffer(46 + name.length));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, f.deflate === true ? 8 : 0, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    new Uint8Array(central.buffer).set(name, 46);
    locals.push(l);
    centrals.push(new Uint8Array(central.buffer));
    offset += l.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)] as BlobPart[]);
}

async function errorOf(blob: Blob, name: string): Promise<[MapFileErrorCode, number] | null> {
  try {
    await readMapFile(blob, name);
    return null;
  } catch (e) {
    if (e instanceof MapFileError) return [e.code, e.issues.length];
    throw e;
  }
}

describe('readMapFile', () => {
  it('previews a JSON document', async () => {
    const blob = new Blob([text], { type: 'application/json' });
    const preview = await readMapFile(blob, 'crypte.json');
    expect(preview).toMatchObject({
      container: 'json',
      fileName: 'crypte.json',
      fileSize: blob.size,
      formatVersion: 1,
      name: 'Crypte oubliée',
      width: 60,
      height: 40,
      assets: 2,
      bundledAssets: 0,
      blocks: 3,
      cells: 5,
    });
    // Leading spaces and a BOM are accepted, whatever the file name.
    expect((await readMapFile(new Blob(['﻿  ' + text]), 'x.txt')).name).toBe('Crypte oubliée');
  });

  it('previews a ZIP (stored or deflated map.json) and counts the bundled images', async () => {
    for (const deflate of [false, true]) {
      const blob = zip([
        { name: 'assets/', data: '' },
        { name: `assets/${'ab12'.repeat(16)}.png`, data: new Uint8Array([1, 2, 3]) },
        { name: `assets/${'cd34'.repeat(16)}.webp`, data: new Uint8Array([4]) },
        { name: 'map.json', data: text, deflate },
      ]);
      const preview = await readMapFile(blob, 'crypte.zip');
      expect(preview).toMatchObject({
        container: 'zip',
        name: 'Crypte oubliée',
        assets: 2,
        bundledAssets: 2,
        cells: 5,
      });
    }
    const entries = await listZipEntries(zip([{ name: 'été.json', data: 'x' }]));
    expect(entries.map((e) => e.name)).toEqual(['été.json']);
  });

  it('explains why a file cannot be imported', async () => {
    expect(await errorOf(new Blob([]), 'a.json')).toEqual(['empty', 0]);
    expect(await errorOf(new Blob(['GIF89a']), 'a.gif')).toEqual(['unknown_type', 0]);
    expect(await errorOf(new Blob(['{"a":']), 'a.json')).toEqual(['not_json', 0]);
    expect(await errorOf(new Blob(['{"format":"x"}']), 'a.json')).toEqual(['not_a_map', 0]);
    const newer = JSON.stringify({ ...JSON.parse(text), format_version: 3 });
    await expect(readMapFile(new Blob([newer]), 'a.json')).rejects.toMatchObject({
      code: 'unsupported_format_version',
      version: 3,
    });
    const invalid = JSON.stringify({ ...JSON.parse(text), grid: { type: 'hex' } });
    expect((await errorOf(new Blob([invalid]), 'a.json'))?.[0]).toBe('invalid');
    const badBlock = JSON.parse(text) as { chunks: { f1: { ground: Record<string, string> } } };
    badBlock.chunks.f1.ground['0:0'] = 'AAAA';
    expect(await errorOf(new Blob([JSON.stringify(badBlock)]), 'a.json')).toEqual(['invalid', 1]);
    expect(await errorOf(zip([{ name: 'other.json', data: text }]), 'a.zip')).toEqual([
      'zip_without_map',
      0,
    ]);
    const truncated = zip([{ name: 'map.json', data: text }]).slice(0, 200);
    expect(await errorOf(truncated, 'a.zip')).toEqual(['bad_zip', 0]);
  });
});
