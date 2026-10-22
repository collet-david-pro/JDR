import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createChunkCells, encodeChunk } from '../../src/formats/chunk-codec';
import {
  base64ToBytes,
  checkMapDocumentBlocks,
  CURRENT_FORMAT_VERSION,
  documentAssetRefs,
  LAYER_IDS,
  MapDocumentError,
  MAP_THEMES,
  migrateMapDocument,
  MIGRATIONS,
  DOCUMENT_KEYS,
  REQUIRED_KEYS,
  parseMapDocument,
  validateMapDocument,
  WEATHER_TYPES,
  type MapDocumentV1,
} from '../../src/formats/map-document';
import schema from '../../src/formats/map.schema.json';

const fixturePath = fileURLToPath(new URL('./fixtures/map-v1.json', import.meta.url));
const serverFixtures = fileURLToPath(new URL('../../../tests/fixtures/maps/', import.meta.url));

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
}

/** Fixture with one path replaced (or removed with `undefined`). */
function variant(path: string, value: unknown): Record<string, unknown> {
  const doc = fixture();
  const keys = path.split('.');
  let target = doc as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const last = keys[keys.length - 1]!;
  if (value === undefined) delete target[last];
  else target[last] = value;
  return doc;
}

function issuesOf(value: unknown): string[] {
  const result = validateMapDocument(value);
  return result.ok ? [] : result.issues.map((i) => `${i.path}:${i.code}`);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe('map document validation (format_version 1)', () => {
  it('accepts the reference document of projet.md 12.1', () => {
    const result = validateMapDocument(fixture());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.name).toBe('Crypte oubliée');
      expect(documentAssetRefs(result.doc)).toHaveLength(2);
    }
  });

  it('accepts a minimal document', () => {
    expect(
      issuesOf({
        format: 'jdr-map',
        format_version: 1,
        name: 'Vide',
        grid: {
          type: 'square',
          cell_px: 16,
          width: 1,
          height: 400,
          unit_label: '',
          unit_per_cell: 0.01,
        },
        palette: [null],
        layers: [
          { id: 'ground', kind: 'tiles' },
          { id: 'terrain', kind: 'tiles' },
          { id: 'decor', kind: 'tiles' },
        ],
        floors: [{ uid: 'f1', level: 0, name: 'RDC' }],
        chunks: [],
        objects: null,
        fog: { f1: {} },
        generation: null,
      }),
    ).toEqual([]);
  });

  it.each([
    ['format', 'other', 'format:const'],
    ['format_version', 2, 'format_version:const'],
    ['name', '   ', 'name:required'],
    ['name', 'x'.repeat(121), 'name:too_long'],
    ['name', undefined, 'name:required'],
    ['kind', 'dungeon', 'kind:enum'],
    ['grid.type', 'hex', 'grid.type:const'],
    ['grid.width', 401, 'grid.width:range'],
    ['grid.height', 2.5, 'grid.height:type'],
    ['grid.cell_px', 8, 'grid.cell_px:range'],
    ['grid.unit_label', 'abcdefghijk', 'grid.unit_label:too_long'],
    ['grid.unit_per_cell', 0, 'grid.unit_per_cell:range'],
    ['theme', 'neon', 'theme:enum'],
    ['ambient.darkness', 2, 'ambient.darkness:range'],
    ['ambient.tint', 'red', 'ambient.tint:pattern'],
    ['ambient.time_of_day', 25, 'ambient.time_of_day:range'],
    ['ambient.weather.type', 'hail', 'ambient.weather.type:enum'],
    ['palette', [], 'palette:required'],
    ['palette', [{ asset: 'sha256:' + 'a'.repeat(64) }], 'palette.0:const'],
    ['palette', [null, { asset: 'sha256:ABC' }], 'palette.1.asset:pattern'],
    ['palette', [null, { name: 'x' }], 'palette.1.asset:required'],
    [
      'palette',
      [null, { asset: 'sha256:' + 'a'.repeat(64), autotile: 'a b' }],
      'palette.1.autotile:pattern',
    ],
    ['palette', [null, 3], 'palette.1:type'],
    ['layers', [{ id: 'ground', kind: 'objects' }], 'layers.0.kind:enum'],
    ['layers', [{ id: 'sky', kind: 'tiles' }], 'layers.0.id:enum'],
    [
      'layers',
      [
        { id: 'ground', kind: 'tiles' },
        { id: 'ground', kind: 'tiles' },
      ],
      'layers.1.id:duplicate',
    ],
    ['layers', [{ id: 'ground', kind: 'tiles', opacity: 1.5 }], 'layers.0.opacity:range'],
    ['floors', [], 'floors:required'],
    ['floors', [{ uid: '', level: 0, name: 'a' }], 'floors.0.uid:pattern'],
    ['generation', { generator: 'bsp' }, 'generation.gen_version:required'],
    ['notes', {}, 'notes:type'],
    // Server rules (MapDocumentValidator): unknown keys, P4 content, stricter fields.
    ['extra', 1, 'extra:unsupported'],
    ['grid.extra', 1, 'grid.extra:unsupported'],
    ['ambient.glow', 1, 'ambient.glow:unsupported'],
    ['ambient.weather.wind', 1, 'ambient.weather.wind:unsupported'],
    ['palette', [null, { asset: 'sha256:' + 'a'.repeat(64), id: 3 }], 'palette.1.id:unsupported'],
    [
      'palette',
      [null, { asset: 'sha256:' + 'a'.repeat(64), name: 'n'.repeat(121) }],
      'palette.1.name:too_long',
    ],
    ['layers', [{ id: 'ground', kind: 'tiles', name: 'x' }], 'layers.0.name:unsupported'],
    ['layers', [{ id: 'ground', kind: 'tiles' }], 'layers:required'],
    ['floors', [{ uid: 'f1', level: 0, name: 'a', z: 1 }], 'floors.0.z:unsupported'],
    ['floors', [{ uid: 'rez de chaussée', level: 0, name: 'a' }], 'floors.0.uid:pattern'],
    ['floors', [{ uid: 'f'.repeat(22), level: 0, name: 'a' }], 'floors.0.uid:pattern'],
    ['floors', [{ uid: 'f1', level: 0, name: 'n'.repeat(61) }], 'floors.0.name:too_long'],
    ['floors', [{ uid: 'f1', level: 0, name: '  ' }], 'floors.0.name:required'],
    [
      'floors',
      [
        { uid: 'f1', level: 0, name: 'a' },
        { uid: 'f2', level: 0, name: 'b' },
      ],
      'floors.1.level:duplicate',
    ],
    ['ambient.tint', null, 'ambient.tint:type'],
    ['objects', [{ uid: 'o1' }], 'objects:unsupported'],
    ['notes', [{ uid: 'n1' }], 'notes:unsupported'],
    ['links', [{}], 'links:unsupported'],
    ['tokens_placed', [{ uid: 't1' }], 'tokens_placed:unsupported'],
    ['fog', { f1: { '0:0': 'AAAA' } }, 'fog:unsupported'],
    ['fog', 'x', 'fog:type'],
    [
      'generation',
      { generator: 'BSP!', gen_version: 1, seed: 'a' },
      'generation.generator:pattern',
    ],
    ['generation', { generator: 'bsp', gen_version: 1, seed: '' }, 'generation.seed:required'],
    [
      'generation',
      { generator: 'bsp', gen_version: 1, seed: 'a', params: [1] },
      'generation.params:type',
    ],
  ])('refuses %s = %j', (path, value, expected) => {
    expect(issuesOf(variant(path, value))).toContain(expected);
  });

  it('checks the tile blocks map: floor, layer, key, bounds, base64', () => {
    const doc = fixture();
    const blocks = { '0:0': 'AAAA' };
    doc['chunks'] = {
      f9: { ground: blocks },
      f1: {
        lava: blocks,
        ground: {
          '2:0': 'AAAA',
          '0:2': 'AAAA',
          '1:1:1': 'AAAA',
          '0:1': 'A=A',
          '1:0': 5,
          '01:1': 'A'.repeat(8196),
        },
      },
    };
    expect(issuesOf(doc)).toEqual([
      'chunks.f9:unknown_floor',
      'chunks.f1.lava:unknown_layer',
      'chunks.f1.ground.2:0:out_of_bounds', // 60 cells = 2 blocks (0, 1)
      'chunks.f1.ground.0:2:out_of_bounds', // 40 cells = 2 blocks
      'chunks.f1.ground.1:1:1:pattern',
      'chunks.f1.ground.0:1:pattern',
      'chunks.f1.ground.1:0:type',
      'chunks.f1.ground.01:1:too_long',
    ]);
  });

  it('stops collecting after 50 issues', () => {
    const palette = [null, ...Array.from({ length: 100 }, () => 1)];
    const result = validateMapDocument(variant('palette', palette));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(50);
  });

  it('refuses prototype keys anywhere', () => {
    const doc = JSON.parse(
      JSON.stringify(fixture()).replace('"grid":{', '"grid":{"Constructor":1,'),
    ) as unknown;
    expect(issuesOf(doc)).toEqual(['grid.Constructor:dangerous_key']);
    expect(issuesOf(JSON.parse('{"palette":[null,{"__proto__":{}}]}'))).toEqual([
      'palette.1.__proto__:dangerous_key',
    ]);
  });

  it('refuses something that is not an object', () => {
    expect(issuesOf([])).toEqual([':type']);
    expect(issuesOf(null)).toEqual([':type']);
  });
});

describe('map.schema.json matches the client validation', () => {
  type Schema = {
    required: string[];
    properties: Record<string, { const?: unknown; enum?: unknown[] }>;
    $defs: Record<string, { properties: Record<string, { enum?: unknown[] }> }>;
  };
  const s = schema as unknown as Schema;

  it('declares the format constants and top-level requirements', () => {
    expect(s.properties['format']?.const).toBe('jdr-map');
    expect(s.properties['format_version']?.const).toBe(CURRENT_FORMAT_VERSION);
    expect(s.properties['theme']?.enum).toEqual([...MAP_THEMES]);
    const minimal = Object.fromEntries(s.required.map((k) => [k, fixture()[k]]));
    expect(issuesOf(minimal)).toEqual([]);
    for (const key of s.required) {
      expect(issuesOf(variant(key, undefined))).toContain(`${key}:required`);
    }
  });

  it('uses the same enumerations', () => {
    expect(s.$defs['layer']!.properties['id']!.enum).toEqual([...LAYER_IDS]);
    expect(Object.keys(s.properties)).toEqual([...DOCUMENT_KEYS]);
    expect(s.required).toEqual([...REQUIRED_KEYS]);
    expect(s.$defs['ambient']!.properties['weather']).toMatchObject({
      properties: { type: { enum: [...WEATHER_TYPES] } },
    });
  });
});

describe('tile blocks of a document', () => {
  it('decodes the blocks and counts the painted cells', async () => {
    const result = validateMapDocument(fixture());
    if (!result.ok) throw new Error('fixture invalid');
    expect(await checkMapDocumentBlocks(result.doc)).toEqual({ blocks: 3, cells: 5, issues: [] });
  });

  it('reports blocks with a wrong layer, a bad palette index or bad data', async () => {
    const cells = createChunkCells();
    cells[0] = 3;
    const decor = bytesToBase64((await encodeChunk('decor', cells))!);
    cells[0] = 9; // palette has 4 entries
    const tooFar = bytesToBase64((await encodeChunk('ground', cells))!);
    const doc = {
      ...fixture(),
      chunks: { f1: { ground: { '0:0': decor, '1:0': tooFar, '0:1': 'AAAA' } } },
    } as unknown as MapDocumentV1;
    const check = await checkMapDocumentBlocks(doc);
    expect(check.issues.map((i) => `${i.path}:${i.code}`)).toEqual([
      'chunks.f1.ground.0:0:bad_block',
      'chunks.f1.ground.1:0:bad_block',
      'chunks.f1.ground.0:1:bad_block',
    ]);
  });

  it('refuses painted cells outside the grid and reserved flag bits (as the server)', async () => {
    const cells = createChunkCells();
    cells[(31 * 32 + 31) * 4] = 1; // cell (63, 63) of block 1:1, grid 60 × 40
    const outside = bytesToBase64((await encodeChunk('ground', cells))!);
    const flagged = createChunkCells();
    flagged[0] = 1;
    flagged[2] = 16;
    const reserved = bytesToBase64((await encodeChunk('ground', flagged))!);
    const doc = {
      ...fixture(),
      chunks: { f1: { ground: { '1:1': outside, '0:0': reserved } } },
    } as unknown as MapDocumentV1;
    const check = await checkMapDocumentBlocks(doc);
    expect(check.issues.map((i) => `${i.path}:${i.code}`)).toEqual([
      'chunks.f1.ground.1:1:out_of_bounds',
      'chunks.f1.ground.0:0:bad_flags',
    ]);
  });

  it('decodes base64', () => {
    expect([...base64ToBytes('AAEC/w==')]).toEqual([0, 1, 2, 255]);
  });
});

describe('format migrations', () => {
  it('has no migration while the format is at version 1', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(1);
    expect(Object.keys(MIGRATIONS)).toEqual([]);
    const doc = fixture();
    const result = migrateMapDocument(doc);
    expect(result).toEqual({ ok: true, doc, from: 1, to: 1 });
  });

  it('refuses newer versions and non-map documents', () => {
    expect(migrateMapDocument({ ...fixture(), format_version: 2 })).toEqual({
      ok: false,
      code: 'unsupported_format_version',
      version: 2,
    });
    expect(migrateMapDocument({ format: 'other' })).toMatchObject({ code: 'not_a_map' });
    expect(migrateMapDocument({ format: 'jdr-map', format_version: 0 })).toMatchObject({
      code: 'not_a_map',
    });
    expect(migrateMapDocument('x')).toMatchObject({ code: 'not_a_map' });
  });

  it('chains migrate_vN_to_vN+1 steps without touching the input', () => {
    const steps = {
      1: (d: Record<string, unknown>) => ({ ...d, renamed: d['name'] }),
      2: (d: Record<string, unknown>) => {
        const { name: _name, ...rest } = d;
        return rest;
      },
    };
    const input = { format: 'jdr-map', format_version: 1, name: 'A' };
    const result = migrateMapDocument(input, steps, 3);
    expect(result).toEqual({
      ok: true,
      doc: { format: 'jdr-map', format_version: 3, renamed: 'A' },
      from: 1,
      to: 3,
    });
    expect(input).toEqual({ format: 'jdr-map', format_version: 1, name: 'A' });
    expect(migrateMapDocument({ ...input, format_version: 2 }, steps, 3)).toMatchObject({
      ok: true,
      from: 2,
    });
    expect(migrateMapDocument(input, { 1: steps[1] }, 3)).toEqual({
      ok: false,
      code: 'missing_migration',
      version: 2,
    });
  });

  it('parses a file text (BOM tolerated) or explains the failure', () => {
    const text = readFileSync(fixturePath, 'utf8');
    expect(parseMapDocument('﻿' + text).fromVersion).toBe(1);
    const failure = (t: string): unknown[] | null => {
      try {
        parseMapDocument(t);
        return null;
      } catch (e) {
        if (e instanceof MapDocumentError) return [e.code, e.version, e.issues.length];
        throw e;
      }
    };
    expect(failure('{')).toEqual(['not_json', null, 0]);
    expect(failure('{"format":"x"}')).toEqual(['not_a_map', null, 0]);
    expect(failure(JSON.stringify({ ...fixture(), format_version: 7 }))).toEqual([
      'unsupported_format_version',
      7,
      0,
    ]);
    expect(failure(JSON.stringify({ ...fixture(), name: '' }))?.[0]).toBe('invalid');
  });
});

// Example files of the server (tests/fixtures/maps/, one per format version): the client must
// accept every document the server accepts.
describe.skipIf(!existsSync(serverFixtures))('server fixtures (tests/fixtures/maps)', () => {
  const files = existsSync(serverFixtures)
    ? readdirSync(serverFixtures).filter(
        (f) => /^(map-)?v\d+.*\.json$/.test(f) && !/invalid/.test(f),
      )
    : [];
  it.each(files.length > 0 ? files : ['(none)'])('accepts %s', async (name) => {
    if (name === '(none)') return;
    const parsed = parseMapDocument(readFileSync(join(serverFixtures, name), 'utf8'));
    expect((await checkMapDocumentBlocks(parsed.doc)).issues).toEqual([]);
  });
});
