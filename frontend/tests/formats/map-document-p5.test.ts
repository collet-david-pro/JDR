import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  checkMapDocumentBlocks,
  DOOR_STATES,
  DOOR_SWINGS,
  FLICKER_TYPES,
  OBJECT_TYPES,
  OBJECT_VISIBILITIES,
  parseMapDocument,
  validateMapDocument,
  WALL_KINDS,
  WINDOW_KINDS,
  type MapDocumentV1,
} from '../../src/formats/map-document';
import schema from '../../src/formats/map.schema.json';

/**
 * P5 content of the map document (etapes/P05 "Contrat d'API P5"): objects, placed tokens and fog,
 * with the rules of the server (app/Maps/ObjectRules.php, TokenRules.php, MapDocumentValidator).
 * Reference: the server fixture tests/fixtures/maps/v1-p5-sample.json.
 */
const fixturePath = fileURLToPath(
  new URL('../../../tests/fixtures/maps/v1-p5-sample.json', import.meta.url),
);

type Doc = Record<string, unknown> & {
  objects: Record<string, unknown>[];
  tokens_placed: Record<string, unknown>[];
  fog: Record<string, Record<string, string>>;
};

function fixture(): Doc {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Doc;
}

/** Fixture with one path replaced (or removed with `undefined`), e.g. "objects.0.props.kind". */
function variant(path: string, value: unknown): Doc {
  const doc = fixture();
  const keys = path.split('.');
  let target = doc as unknown as Record<string, unknown>;
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

function fogBlock(bytes: Uint8Array): string {
  return Buffer.from(deflateRawSync(bytes)).toString('base64');
}

describe('P5 content of the map document', () => {
  it('accepts the server fixture (12.1 defaults included) and decodes its fog', async () => {
    const parsed = parseMapDocument(readFileSync(fixturePath, 'utf8'));
    expect(parsed.doc.objects).toHaveLength(8);
    expect(parsed.doc.tokens_placed).toHaveLength(3);
    const check = await checkMapDocumentBlocks(parsed.doc);
    expect(check.issues).toEqual([]);
    expect(check.fogBlocks).toBe(2);
  });

  it.each([
    // Objects: common members.
    ['objects.0.uid', 'a b', 'objects.0.uid:pattern'],
    ['objects.0.uid', 'x'.repeat(22), 'objects.0.uid:pattern'],
    ['objects.0.uid', undefined, 'objects.0.uid:required'],
    ['objects.0.floor', 'f9', 'objects.0.floor:unknown_floor'],
    ['objects.0.type', 'prop', 'objects.0.type:enum'],
    ['objects.0.layer', 'ground', 'objects.0.layer:enum'],
    ['objects.0.visibility', 'players', 'objects.0.visibility:enum'],
    ['objects.0.locked', 1, 'objects.0.locked:type'],
    ['objects.0.sort_order', 1.5, 'objects.0.sort_order:type'],
    ['objects.0.sort_order', 1_000_001, 'objects.0.sort_order:range'],
    ['objects.0.rev', 1, 'objects.0.rev:unsupported'],
    ['objects.0.geometry', undefined, 'objects.0.geometry:required'],
    // Wall.
    ['objects.0.geometry.points', [[1, 1]], 'objects.0.geometry.points:range'],
    [
      'objects.0.geometry.points',
      [
        [1, 1],
        [61, 1],
      ],
      'objects.0.geometry.points.1:range',
    ],
    ['objects.0.geometry.points', [[1, 1], [1]], 'objects.0.geometry.points.1:type'],
    ['objects.0.geometry.closed', 'yes', 'objects.0.geometry.closed:type'],
    ['objects.0.props.kind', 'glass', 'objects.0.props.kind:enum'],
    ['objects.0.props.thickness', 0.01, 'objects.0.props.thickness:range'],
    ['objects.0.props.blocks_move', undefined, 'objects.0.props.blocks_move:required'],
    ['objects.0.props.texture_asset', 'sha256:x', 'objects.0.props.texture_asset:const'],
    ['objects.0.props.height', 21, 'objects.0.props.height:range'],
    ['objects.0.props.extra', 1, 'objects.0.props.extra:unsupported'],
    // Door / window.
    ['objects.2.geometry.b', [5.05, 8], 'objects.2.geometry:range'],
    ['objects.2.geometry.b', [26, 8], 'objects.2.geometry:range'],
    ['objects.2.props.state', 'ajar', 'objects.2.props.state:enum'],
    ['objects.2.props.swing', 'c', 'objects.2.props.swing:enum'],
    ['objects.2.props.asset_open', 'x', 'objects.2.props.asset_open:const'],
    ['objects.4.props.kind', 'stone', 'objects.4.props.kind:enum'],
    // Light.
    ['objects.5.geometry.x', -1, 'objects.5.geometry.x:range'],
    ['objects.5.props.radius', 101, 'objects.5.props.radius:range'],
    ['objects.5.props.dim_radius', 3, 'objects.5.props.dim_radius:below_radius'],
    ['objects.5.props.color', 'orange', 'objects.5.props.color:pattern'],
    ['objects.5.props.intensity', 2, 'objects.5.props.intensity:range'],
    [
      'objects.5.props.flicker',
      { type: 'torch', amp: 0.1 },
      'objects.5.props.flicker.speed:required',
    ],
    [
      'objects.5.props.flicker',
      { type: 'storm', amp: 0.1, speed: 1 },
      'objects.5.props.flicker.type:enum',
    ],
    ['objects.5.props.cone', { angle: 360, direction: 0 }, 'objects.5.props.cone.angle:range'],
    ['objects.5.props.follows_token', 'a b', 'objects.5.props.follows_token:pattern'],
    ['objects.5.props.enabled', undefined, 'objects.5.props.enabled:required'],
    ['objects', {}, 'objects:type'],
    // Placed tokens.
    ['tokens_placed.0.token', 'Garde', 'tokens_placed.0.token:pattern'],
    ['tokens_placed.0.token', 'ref:token: Garde', 'tokens_placed.0.token:pattern'],
    ['tokens_placed.0.token', 'ref:token:' + 'g'.repeat(81), 'tokens_placed.0.token:too_long'],
    ['tokens_placed.0.floor', 'f3', 'tokens_placed.0.floor:unknown_floor'],
    ['tokens_placed.0.x', 60.5, 'tokens_placed.0.x:range'],
    ['tokens_placed.0.y', undefined, 'tokens_placed.0.y:required'],
    ['tokens_placed.0.rotation', 360, 'tokens_placed.0.rotation:range'],
    ['tokens_placed.0.rotation', 1.5, 'tokens_placed.0.rotation:type'],
    ['tokens_placed.0.scale', 5, 'tokens_placed.0.scale:range'],
    ['tokens_placed.0.hidden', 'no', 'tokens_placed.0.hidden:type'],
    ['tokens_placed.0.token_id', '3', 'tokens_placed.0.token_id:unsupported'],
    [
      'tokens_placed.1.light_override',
      { radius: 3, dim_radius: 2, color: '#ffffff', intensity: 1, flicker: false },
      'tokens_placed.1.light_override.dim_radius:below_radius',
    ],
    [
      'tokens_placed.1.light_override',
      { radius: 1, dim_radius: 2, color: '#ffffff', intensity: 1 },
      'tokens_placed.1.light_override.flicker:required',
    ],
    // Fog.
    ['fog.f1', { '2:0': 'AAAA' }, 'fog.f1.2:0:out_of_bounds'],
    ['fog.f1', { '0-0': 'AAAA' }, 'fog.f1.0-0:pattern'],
    ['fog.f1', { '0:0': 'A=A' }, 'fog.f1.0:0:pattern'],
    ['fog.f1', { '0:0': 'A'.repeat(4100) }, 'fog.f1.0:0:too_long'],
    ['fog.f1', 'x', 'fog.f1:type'],
  ])('refuses %s = %j', (path, value, expected) => {
    expect(issuesOf(variant(path, value))).toContain(expected);
  });

  it('accepts the documented defaults and reserved values', () => {
    expect(issuesOf(variant('objects.5.props.cone', { angle: 1, direction: 360 }))).toEqual([]);
    expect(issuesOf(variant('objects.0.props.height', 20))).toEqual([]);
    expect(issuesOf(variant('tokens_placed.0.rotation', undefined))).toEqual([]);
    expect(issuesOf(variant('objects', null))).toEqual([]);
    expect(issuesOf(variant('fog', []))).toEqual([]);
    expect(issuesOf(variant('fog.f1', {}))).toEqual([]);
  });

  it('refuses uids used twice in a list, ignoring case (database key)', () => {
    const doc = fixture();
    doc.objects[1]!['uid'] = 'WALL-ROOM-1';
    doc.tokens_placed[2]!['uid'] = 'tok-guard';
    expect(issuesOf(doc)).toEqual(['objects.1.uid:duplicate', 'tokens_placed.2.uid:duplicate']);
    // Objects and tokens are separate namespaces.
    const other = fixture();
    other.tokens_placed[0]!['uid'] = 'wall-room-1';
    expect(issuesOf(other)).toEqual([]);
  });

  it('reports fog blocks that do not inflate to 2 048 bytes', async () => {
    const doc = fixture();
    doc.fog['f1'] = {
      '0:0': fogBlock(new Uint8Array(2047).fill(1)),
      '1:0': fogBlock(new Uint8Array(2049).fill(1)),
      '0:1': 'AAAA',
      '1:1': fogBlock(new Uint8Array(2048)),
    };
    const result = validateMapDocument(doc);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const check = await checkMapDocumentBlocks(result.doc as MapDocumentV1);
    expect(check.issues.map((i) => `${i.path}:${i.code}`)).toEqual([
      'fog.f1.0:0:bad_block',
      'fog.f1.1:0:bad_block',
      'fog.f1.0:1:bad_block',
    ]);
    expect(check.fogBlocks).toBe(0); // the all-zero block is valid but empty
  });
});

describe('map.schema.json (P5 definitions)', () => {
  type Def = {
    properties: Record<
      string,
      { enum?: unknown[]; const?: unknown; properties?: Record<string, { enum?: unknown[] }> }
    >;
    required?: string[];
  };
  const defs = (schema as unknown as { $defs: Record<string, Def> }).$defs;

  it('uses the enumerations of the validator', () => {
    const types = ['wallObject', 'doorObject', 'windowObject', 'lightObject'].map(
      (d) => defs[d]!.properties['type']!.const,
    );
    expect(types).toEqual([...OBJECT_TYPES]);
    expect(defs['wallObject']!.properties['visibility']!.enum).toEqual([...OBJECT_VISIBILITIES]);
    const props = (d: string): Def => defs[d]!.properties['props'] as unknown as Def;
    expect(props('wallObject').properties['kind']!.enum).toEqual([...WALL_KINDS]);
    expect(props('doorObject').properties['state']!.enum).toEqual([...DOOR_STATES]);
    expect(props('doorObject').properties['swing']!.enum).toEqual([...DOOR_SWINGS]);
    expect(props('windowObject').properties['kind']!.enum).toEqual([...WINDOW_KINDS]);
    const flicker = props('lightObject').properties['flicker'] as unknown as Def;
    expect(flicker.properties['type']!.enum).toEqual([...FLICKER_TYPES]);
  });

  it('requires the same members (defaults omitted)', () => {
    expect(defs['wallObject']!.required).toEqual(['uid', 'floor', 'type', 'geometry', 'props']);
    expect(defs['placedToken']!.required).toEqual(['uid', 'token', 'floor', 'x', 'y']);
  });
});
