import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_CELLS,
  CHUNK_RAW_BYTES,
  ChunkCodecError,
  TILE_LAYERS,
  createChunkCells,
  decodeChunk,
  decodeChunkRaw,
  encodeChunk,
  encodeChunkRaw,
} from '../../src/formats/chunk-codec';
import { deflateRaw } from '../../src/formats/compression';
import { createRng } from '../../src/editor/util/rng';

interface Vector {
  name: string;
  layer: number;
  level: number;
  raw: string;
  compressed: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/php-chunks.json', import.meta.url), 'utf8'),
) as { vectors: Vector[] };
const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

function randomCells(seed: number, fill = 0.7, paletteSize = 500): Uint16Array {
  const rng = createRng(seed);
  const cells = createChunkCells();
  for (let i = 0; i < CHUNK_CELLS; i++) {
    if (rng.next() >= fill) continue;
    cells[i * 4] = 1 + rng.int(paletteSize - 1);
    cells[i * 4 + 1] = rng.int(256);
    cells[i * 4 + 2] = rng.int(256);
  }
  return cells;
}

async function codecError(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(ChunkCodecError);
    return (e as ChunkCodecError).code;
  }
  throw new Error('expected a ChunkCodecError');
}

describe('raw chunk format (12.2)', () => {
  it('writes the exact header and little-endian cells', () => {
    const cells = createChunkCells();
    cells[0] = 0x0102; // cell 0: index 258
    cells[1] = 7;
    cells[2] = 0b1101;
    cells[1023 * 4] = 65535; // last cell
    const raw = encodeChunkRaw('terrain', cells)!;
    expect(raw.length).toBe(CHUNK_RAW_BYTES);
    expect([...raw.subarray(0, 12)]).toEqual([0x4a, 0x43, 1, 1, 0, 0, 0, 0, 0x02, 0x01, 7, 13]);
    expect([...raw.subarray(CHUNK_RAW_BYTES - 4)]).toEqual([0xff, 0xff, 0, 0]);
  });

  it('encodes an empty chunk as null and decodes an empty block as null', () => {
    expect(encodeChunkRaw('ground', createChunkCells())).toBeNull();
    const raw = new Uint8Array(CHUNK_RAW_BYTES);
    raw.set([0x4a, 0x43, 1, 2]);
    expect(decodeChunkRaw(raw, { paletteSize: 1 })).toBeNull();
  });

  it('round-trips random chunks on every layer', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const layer = TILE_LAYERS[seed % 3]!;
      const cells = randomCells(seed, seed / 50);
      const raw = encodeChunkRaw(layer, cells);
      if (raw === null) continue;
      const decoded = decodeChunkRaw(raw, { paletteSize: 500, layer })!;
      expect(decoded.layer).toBe(layer);
      expect(decoded.cells).toEqual(cells);
    }
  });

  it('validates size, magic, version, layer and palette index', async () => {
    const raw = encodeChunkRaw('decor', randomCells(3, 1, 10))!;
    const mutate = (f: (r: Uint8Array) => void): Uint8Array => {
      const r = new Uint8Array(raw);
      f(r);
      return r;
    };
    const opts = { paletteSize: 10 };
    expect(await codecError(() => decodeChunkRaw(raw.subarray(1), opts))).toBe('bad_size');
    expect(await codecError(() => decodeChunkRaw(new Uint8Array(4105), opts))).toBe('bad_size');
    expect(
      await codecError(() =>
        decodeChunkRaw(
          mutate((r) => (r[0] = 0x4b)),
          opts,
        ),
      ),
    ).toBe('bad_magic');
    expect(
      await codecError(() =>
        decodeChunkRaw(
          mutate((r) => (r[2] = 2)),
          opts,
        ),
      ),
    ).toBe('bad_version');
    expect(
      await codecError(() =>
        decodeChunkRaw(
          mutate((r) => (r[3] = 3)),
          opts,
        ),
      ),
    ).toBe('bad_layer');
    expect(await codecError(() => decodeChunkRaw(raw, { paletteSize: 10, layer: 'ground' }))).toBe(
      'bad_layer',
    );
    expect(await codecError(() => decodeChunkRaw(raw, { paletteSize: 5 }))).toBe(
      'bad_palette_index',
    );
    expect(await codecError(() => encodeChunkRaw('ground', new Uint16Array(10)))).toBe('bad_cells');
    const bad = createChunkCells();
    bad[0] = 1;
    bad[1] = 256;
    expect(await codecError(() => encodeChunkRaw('ground', bad))).toBe('bad_cells');
  });
});

describe('compressed chunks', () => {
  it.each([false, true])('round-trips (forceJs=%s)', async (forceJs) => {
    for (let seed = 1; seed <= 20; seed++) {
      const cells = randomCells(seed * 7, (seed % 5) / 4);
      const data = await encodeChunk('ground', cells, { forceJs });
      if (data === null) {
        expect(encodeChunkRaw('ground', cells)).toBeNull();
        continue;
      }
      const decoded = await decodeChunk(data, { paletteSize: 500, forceJs });
      expect(decoded?.cells).toEqual(cells);
    }
  });

  it.each([false, true])(
    'decodes chunks compressed by PHP gzdeflate (forceJs=%s)',
    async (forceJs) => {
      expect(fixture.vectors.length).toBeGreaterThanOrEqual(5);
      for (const v of fixture.vectors) {
        const decoded = await decodeChunk(b64(v.compressed), { paletteSize: 65536, forceJs });
        const expected = decodeChunkRaw(b64(v.raw), { paletteSize: 65536 });
        expect(decoded, v.name).toEqual(expected);
        expect(decoded?.layer).toBe(TILE_LAYERS[v.layer]);
        // Our encoder reproduces PHP's raw block byte for byte.
        expect(encodeChunkRaw(decoded!.layer, decoded!.cells), v.name).toEqual(b64(v.raw));
      }
    },
  );

  it('rejects oversized or corrupt payloads cleanly (fuzzing)', async () => {
    const rng = createRng(2026);
    for (const forceJs of [false, true]) {
      const tooBig = await deflateRaw(new Uint8Array(CHUNK_RAW_BYTES + 1), { forceJs });
      expect(await codecError(decodeChunk(tooBig, { paletteSize: 2, forceJs }))).toBe('bad_size');
      const good = (await encodeChunk('terrain', randomCells(11), { forceJs }))!;
      for (let i = 0; i < 400; i++) {
        const bad = new Uint8Array(good);
        if (i % 2 === 0) {
          for (let k = 0; k <= rng.int(4); k++) bad[rng.int(bad.length)] = rng.int(256);
        }
        const input = i % 2 === 1 ? bad.subarray(0, rng.int(bad.length)) : bad;
        try {
          const out = await decodeChunk(input, { paletteSize: 500, forceJs });
          // A corruption may still yield a valid block: then it must be well formed.
          if (out !== null) expect(out.cells.length).toBe(CHUNK_CELLS * 4);
        } catch (e) {
          expect(e).toBeInstanceOf(ChunkCodecError);
        }
      }
    }
  });
});
