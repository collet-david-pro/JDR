import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TILE_LAYERS,
  createChunkCells,
  decodeChunk,
  decodeChunkRaw,
  encodeChunk,
} from '../../src/formats/chunk-codec';
import {
  ChunkStreamError,
  encodeChunkStream,
  parseChunkStream,
} from '../../src/formats/chunk-stream';
import { makeDoc } from '../editor/helpers';

interface Vector {
  name: string;
  layer: number;
  compressed: string;
}
const php = JSON.parse(
  readFileSync(new URL('../formats/fixtures/php-chunks.json', import.meta.url), 'utf8'),
) as { vectors: Vector[] };
const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

describe('parseChunkStream', () => {
  it('reads [cx u16][cy u16][layer u8][len u32][data] records, little endian', () => {
    const bytes = new Uint8Array([
      0x02, 0x01, 0x03, 0x00, 0x01, 0x03, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x0c,
      0x00, 0x02, 0x01, 0x00, 0x00, 0x00, 0x7f,
    ]);
    const records = parseChunkStream(bytes);
    expect(records.map((r) => [r.cx, r.cy, r.layer, r.key, [...r.data]])).toEqual([
      [258, 3, 'terrain', '258:3', [0xaa, 0xbb, 0xcc]],
      [0, 12, 'decor', '0:12', [0x7f]],
    ]);
  });

  it('accepts an empty stream (map without tiles)', () => {
    expect(parseChunkStream(new Uint8Array())).toEqual([]);
  });

  it.each([
    ['truncated header', [0x01, 0x00, 0x00]],
    ['truncated block', [0, 0, 0, 0, 0, 5, 0, 0, 0, 1, 2]],
    ['unknown layer', [0, 0, 0, 0, 3, 1, 0, 0, 0, 1]],
    ['empty block', [0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['huge length', [0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x7f, 1]],
  ])('rejects a corrupt stream: %s', (_name, bytes) => {
    expect(() => parseChunkStream(new Uint8Array(bytes))).toThrow(ChunkStreamError);
  });

  it('round-trips the PHP blocks (gzdeflate) and loads them into a document', async () => {
    const records = php.vectors.map((v, i) => ({
      cx: i,
      cy: 1,
      layer: TILE_LAYERS[v.layer]!,
      data: b64(v.compressed),
    }));
    const stream = encodeChunkStream(records);
    const parsed = parseChunkStream(stream);
    expect(parsed.map((r) => [r.key, r.layer, r.data.length])).toEqual(
      records.map((r) => [`${r.cx}:1`, r.layer, r.data.length]),
    );
    const doc = makeDoc(200, 64, 65536);
    for (const r of parsed) await doc.importChunk(r.layer, r.key, r.data);
    for (const r of parsed) expect(doc.chunkKeys(r.layer)).toContain(r.key);
  });

  it('round-trips blocks encoded by the JS codec', async () => {
    const cells = createChunkCells();
    cells[0] = 3;
    cells[4 * 33] = 2;
    cells[4 * 33 + 1] = 7;
    const data = (await encodeChunk('ground', cells))!;
    const [rec] = parseChunkStream(encodeChunkStream([{ cx: 2, cy: 0, layer: 'ground', data }]));
    const doc = makeDoc(128, 64, 8);
    await doc.importChunk(rec!.layer, rec!.key, rec!.data);
    expect(doc.getCell('ground', 64, 0).index).toBe(3);
    expect(doc.getCell('ground', 65, 1)).toEqual({ index: 2, variant: 7, flags: 0 });
  });

  /** Fixture written by the server lot (tests/php/Maps/ChunkCodecTest.php, ChunkCodec::compress). */
  const serverFixture = new URL(
    '../../../tests/php/Maps/fixtures/php-to-js-chunks.json',
    import.meta.url,
  );
  it.skipIf(!existsSync(serverFixture))(
    'decodes the blocks compressed by the PHP ChunkCodec, through a stream',
    async () => {
      const { vectors } = JSON.parse(readFileSync(serverFixture, 'utf8')) as {
        vectors: (Vector & { raw: string })[];
      };
      expect(vectors.length).toBeGreaterThan(0);
      const stream = encodeChunkStream(
        vectors.map((v, i) => ({
          cx: i,
          cy: 0,
          layer: TILE_LAYERS[v.layer]!,
          data: b64(v.compressed),
        })),
      );
      const parsed = parseChunkStream(stream);
      for (const [i, r] of parsed.entries()) {
        const v = vectors[i]!;
        const fromStream = await decodeChunk(r.data, { paletteSize: 65536, layer: r.layer });
        const expected = decodeChunkRaw(b64(v.raw), { paletteSize: 65536 });
        expect(fromStream?.cells).toEqual(expected?.cells);
      }
    },
  );
});
