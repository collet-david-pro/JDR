/**
 * Map document (projet.md 12.1, `format_version: 1`): the portable form of a map used by
 * export / import (and by the server snapshots). This module mirrors `map.schema.json` with a
 * hand-written validation (no schema library: projet.md 4.3), runs the format migrations
 * (`migrate_vN_to_vN+1`, none while the format is at version 1) and checks the tile blocks.
 *
 * The rules are those of the server (app/Maps/Document/MapDocumentValidator.php, ObjectRules,
 * TokenRules): unknown keys are refused; P5 objects (wall, door, window, light), placed tokens
 * and fog are validated; notes and links (P9) must be empty. The server stays the authority (it
 * validates again on import); the client validation lets the import dialog explain a bad file
 * before uploading it.
 */
import { CHUNK_SIZE, type TileLayerId } from '../editor/contracts';
import { CELL_STRIDE, ChunkCodecError, decodeChunk, TILE_LAYERS } from './chunk-codec';
import { decodeFog, FogCodecError, isFogEmpty } from './fog-codec';

export const MAP_DOCUMENT_FORMAT = 'jdr-map';
export const CURRENT_FORMAT_VERSION = 1;

export const MAP_NAME_MAX = 120;
export const PALETTE_NAME_MAX = 120;
export const FLOOR_NAME_MAX = 60;
export const GRID_SIDE_MAX = 400;
export const CELL_PX_MIN = 16;
export const CELL_PX_MAX = 512;
export const UNIT_LABEL_MAX = 10;
export const UNIT_PER_CELL_MIN = 0.01;
export const UNIT_PER_CELL_MAX = 9999.99;
export const PALETTE_MAX = 4096;
export const FLOORS_MAX = 8;
export const LEVEL_MIN = -100;
export const LEVEL_MAX = 100;
export const CHUNK_BASE64_MAX = 8192;
export const GENERATION_PARAMS_MAX_BYTES = 65536;
/** Cell flags: bits 0-3 used, 4-7 reserved (projet.md 12.2). */
export const FLAGS_MAX = 0x0f;
export const AUTOTILE_PATTERN = /^[A-Za-z0-9_.:-]{1,40}$/;
export const ASSET_REF_PATTERN = /^sha256:[0-9a-fA-F]{64}$/;
export const FLOOR_UID_PATTERN = /^[A-Za-z0-9_-]{1,21}$/;
export const GENERATOR_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
const BLOCK_KEY_PATTERN = /^(\d{1,3}):(\d{1,3})$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
/** Keys refused anywhere in the document (prototype pollution). */
export const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

export const MAP_THEMES = ['parchment', 'slate', 'blueprint', 'dark', 'light'] as const;
export const WEATHER_TYPES = ['none', 'rain', 'snow', 'fog', 'storm'] as const;
export const OBJECT_LAYER_IDS = ['walls', 'props', 'lighting', 'labels', 'gm'] as const;
export const LAYER_IDS = [...TILE_LAYERS, ...OBJECT_LAYER_IDS] as const;

/** Allowed members (anything else is `unsupported`). */
export const DOCUMENT_KEYS = [
  'format',
  'format_version',
  'app_version',
  'name',
  'kind',
  'grid',
  'theme',
  'ambient',
  'palette',
  'layers',
  'floors',
  'chunks',
  'fog',
  'objects',
  'notes',
  'links',
  'tokens_placed',
  'generation',
] as const;
export const REQUIRED_KEYS = [
  'format',
  'format_version',
  'name',
  'grid',
  'palette',
  'layers',
  'floors',
  'chunks',
] as const;
const GRID_KEYS = ['type', 'cell_px', 'width', 'height', 'unit_label', 'unit_per_cell'];
const AMBIENT_KEYS = ['darkness', 'tint', 'time_of_day', 'weather'];
const WEATHER_KEYS = ['type', 'intensity'];
const PALETTE_KEYS = ['asset', 'name', 'autotile'];
const LAYER_KEYS = ['id', 'kind', 'visible', 'locked', 'opacity', 'gm_only'];
const FLOOR_KEYS = ['uid', 'level', 'name'];
const GENERATION_KEYS = ['generator', 'gen_version', 'seed', 'params'];
/** Content of later phases (P9): must be null or empty (`unsupported` otherwise). */
export const LATER_LISTS = ['notes', 'links'] as const;

/* ---- P5 content (etapes/P05 "Contrat d'API P5", same bounds as the server) ------------- */

export const OBJECT_TYPES = ['wall', 'door', 'window', 'light'] as const;
export const OBJECT_VISIBILITIES = ['all', 'gm', 'hidden_until_revealed'] as const;
export const WALL_KINDS = ['stone', 'brick', 'wood', 'metal', 'natural', 'invisible'] as const;
export const DOOR_STATES = ['open', 'closed'] as const;
export const DOOR_SWINGS = ['a', 'b', 'slide'] as const;
export const WINDOW_KINDS = ['glass', 'bars', 'opening'] as const;
export const FLICKER_TYPES = ['none', 'torch', 'pulse'] as const;
export const OBJECTS_MAX = 20_000;
export const TOKENS_PLACED_MAX = 2_000;
export const WALL_POINTS_MIN = 2;
export const WALL_POINTS_MAX = 1_000;
export const SORT_ORDER_MAX = 1_000_000;
export const LIGHT_RADIUS_MAX = 100;
/** Token definition light (P3 TokenInput): radii 0–1000 cells. */
export const TOKEN_LIGHT_RADIUS_MAX = 1_000;
export const TOKEN_NAME_MAX = 80;
export const FOG_BASE64_MAX = 4096;
export const OBJECT_UID_PATTERN = /^[A-Za-z0-9_-]{1,21}$/;
export const TOKEN_REF_PATTERN = /^ref:token:([\s\S]+)$/;
/** Members of a document object (no rev); layer, visibility, locked, sort_order may be omitted. */
const OBJECT_KEYS = [
  'uid',
  'floor',
  'type',
  'layer',
  'geometry',
  'props',
  'visibility',
  'locked',
  'sort_order',
];
const OBJECT_OPTIONAL = ['layer', 'visibility', 'locked', 'sort_order'];
const GEOMETRY_KEYS: Readonly<Record<(typeof OBJECT_TYPES)[number], readonly string[]>> = {
  wall: ['points', 'closed'],
  door: ['a', 'b'],
  window: ['a', 'b'],
  light: ['x', 'y'],
};
const PROPS_KEYS: Readonly<Record<(typeof OBJECT_TYPES)[number], readonly string[]>> = {
  wall: [
    'kind',
    'thickness',
    'blocks_vision',
    'blocks_light',
    'blocks_move',
    'texture_asset',
    'height',
  ],
  door: ['state', 'locked', 'secret', 'asset_open', 'asset_closed', 'swing'],
  window: ['kind'],
  light: [
    'radius',
    'dim_radius',
    'color',
    'intensity',
    'flicker',
    'cone',
    'enabled',
    'follows_token',
  ],
};
/** Reserved props (P9 textures) that a document may omit: null. */
const PROPS_OPTIONAL = ['texture_asset', 'height', 'asset_open', 'asset_closed'];
const TOKEN_KEYS = [
  'uid',
  'token',
  'floor',
  'x',
  'y',
  'rotation',
  'scale',
  'hidden',
  'light_override',
];
const TOKEN_OPTIONAL = ['rotation', 'scale', 'hidden', 'light_override'];
const TOKEN_LIGHT_KEYS = ['radius', 'dim_radius', 'color', 'intensity', 'flicker'];

/* ---- Document types (format_version 1) ------------------------------------------------- */

export interface MapDocumentGrid {
  readonly type?: 'square';
  readonly cell_px: number;
  readonly width: number;
  readonly height: number;
  readonly unit_label: string;
  readonly unit_per_cell: number;
}

export interface MapDocumentPaletteEntry {
  /** "sha256:<hex>" */
  readonly asset: string;
  readonly name?: string | null;
  readonly autotile?: string | null;
}

export interface MapDocumentLayer {
  readonly id: (typeof LAYER_IDS)[number];
  readonly kind: 'tiles' | 'objects';
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly gm_only?: boolean;
}

export interface MapDocumentFloor {
  readonly uid: string;
  readonly level: number;
  readonly name: string;
}

/** "cx:cy" → base64 block. */
export type BlockMap = Readonly<Record<string, string>>;

export interface MapDocumentV1 {
  readonly format: typeof MAP_DOCUMENT_FORMAT;
  readonly format_version: 1;
  readonly app_version?: string;
  readonly name: string;
  readonly kind?: 'battle' | 'world';
  readonly grid: MapDocumentGrid;
  readonly theme?: (typeof MAP_THEMES)[number];
  readonly ambient?: Readonly<Record<string, unknown>>;
  readonly palette: readonly (MapDocumentPaletteEntry | null)[];
  readonly layers: readonly MapDocumentLayer[];
  readonly floors: readonly MapDocumentFloor[];
  readonly chunks: Readonly<Record<string, Readonly<Partial<Record<TileLayerId, BlockMap>>>>>;
  /** Floor uid → "cx:cy" → base64 raw-deflate fog bitmap (projet.md 12.3). */
  readonly fog?:
    Readonly<Record<string, BlockMap | readonly never[] | null>> | readonly never[] | null;
  readonly objects?: readonly MapDocumentObject[] | null;
  readonly notes?: readonly never[] | null;
  readonly links?: readonly never[] | null;
  readonly tokens_placed?: readonly MapDocumentPlacedToken[] | null;
  readonly generation?: Readonly<Record<string, unknown>> | null;
}

/**
 * Object of a document: the editor object (contracts.ts MapObject) without `rev`, `floor` = floor
 * uid of the document; layer, visibility, locked, sort_order and the reserved props may be
 * omitted (12.1 example).
 */
export interface MapDocumentObject {
  readonly uid: string;
  readonly floor: string;
  readonly type: (typeof OBJECT_TYPES)[number];
  readonly layer?: (typeof OBJECT_LAYER_IDS)[number];
  readonly geometry: Readonly<Record<string, unknown>>;
  readonly props: Readonly<Record<string, unknown>>;
  readonly visibility?: (typeof OBJECT_VISIBILITIES)[number];
  readonly locked?: boolean;
  readonly sort_order?: number;
}

/** Placed token of a document: definition by name ("ref:token:<name>"). */
export interface MapDocumentPlacedToken {
  readonly uid: string;
  readonly token: string;
  readonly floor: string;
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
  readonly scale?: number;
  readonly hidden?: boolean;
  readonly light_override?: Readonly<Record<string, unknown>> | null;
}

/* ---- Validation ------------------------------------------------------------------------ */

export type MapDocumentIssueCode =
  | 'required'
  | 'type'
  | 'const'
  | 'enum'
  | 'range'
  | 'pattern'
  | 'too_long'
  | 'too_many'
  | 'duplicate'
  | 'unsupported'
  | 'dangerous_key'
  | 'unknown_floor'
  | 'unknown_layer'
  | 'out_of_bounds'
  | 'bad_flags'
  | 'bad_block'
  | 'below_radius';

export interface MapDocumentIssue {
  /** JSON path, e.g. "grid.width", "palette.3.asset", "chunks.f1.ground.0:0". */
  readonly path: string;
  readonly code: MapDocumentIssueCode;
}

export type MapDocumentValidation =
  | { readonly ok: true; readonly doc: MapDocumentV1; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly MapDocumentIssue[] };

/** At most this many issues are collected (a broken file would list thousands). */
export const MAX_ISSUES = 50;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const charLength = (s: string): number => [...s].length;
const join = (path: string, key: string | number): string =>
  path === '' ? String(key) : `${path}.${key}`;

class Collector {
  readonly issues: MapDocumentIssue[] = [];

  add(path: string, code: MapDocumentIssueCode): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ path, code });
  }

  get full(): boolean {
    return this.issues.length >= MAX_ISSUES;
  }

  /** Required member check; returns the value when present. */
  required(obj: Obj, key: string, path: string): unknown {
    if (!Object.hasOwn(obj, key) || obj[key] === undefined) {
      this.add(path, 'required');
      return undefined;
    }
    return obj[key];
  }

  /** Members outside `allowed` are refused (`unsupported`). */
  keys(obj: Obj, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(obj))
      if (!allowed.includes(key)) this.add(join(path, key), 'unsupported');
  }

  string(v: unknown, path: string, max: number, min = 0): v is string {
    if (typeof v !== 'string') {
      this.add(path, 'type');
      return false;
    }
    const n = charLength(v);
    if (n < min) {
      this.add(path, min === 1 && n === 0 ? 'required' : 'range');
      return false;
    }
    if (n > max) {
      this.add(path, 'too_long');
      return false;
    }
    return true;
  }

  number(v: unknown, path: string, min: number, max: number, integer = false): v is number {
    if (integer ? !isInt(v) : !isNum(v)) {
      this.add(path, 'type');
      return false;
    }
    if ((v as number) < min || (v as number) > max) {
      this.add(path, 'range');
      return false;
    }
    return true;
  }

  boolean(v: unknown, path: string): void {
    if (typeof v !== 'boolean') this.add(path, 'type');
  }

  oneOf(v: unknown, values: readonly unknown[], path: string): boolean {
    if (!values.includes(v)) {
      this.add(path, 'enum');
      return false;
    }
    return true;
  }

  optional(obj: Obj, key: string, check: (v: unknown, path: string) => void, path: string): void {
    if (Object.hasOwn(obj, key) && obj[key] !== undefined) check(obj[key], path);
  }
}

/** Path of the first forbidden key (`__proto__`…, any case) in a parsed value, or null. */
export function findDangerousKey(value: unknown, path = ''): string | null {
  if (typeof value !== 'object' || value === null) return null;
  for (const [key, child] of Object.entries(value)) {
    const here = join(path, key);
    if ((DANGEROUS_KEYS as readonly string[]).includes(key.toLowerCase())) return here;
    const found = findDangerousKey(child, here);
    if (found !== null) return found;
  }
  return null;
}

/** Number of 32-cell blocks along a side of `cells` cells. */
const blocksAlong = (cells: number): number => Math.ceil(cells / CHUNK_SIZE);

function checkGrid(c: Collector, v: unknown): { width: number; height: number } | null {
  if (!isObj(v)) {
    c.add('grid', 'type');
    return null;
  }
  c.keys(v, GRID_KEYS, 'grid');
  c.optional(v, 'type', (x, p) => x === 'square' || c.add(p, 'const'), 'grid.type');
  const cellPx = c.required(v, 'cell_px', 'grid.cell_px');
  if (cellPx !== undefined) c.number(cellPx, 'grid.cell_px', CELL_PX_MIN, CELL_PX_MAX, true);
  const unitLabel = c.required(v, 'unit_label', 'grid.unit_label');
  if (unitLabel !== undefined) c.string(unitLabel, 'grid.unit_label', UNIT_LABEL_MAX);
  const unit = c.required(v, 'unit_per_cell', 'grid.unit_per_cell');
  if (unit !== undefined) {
    c.number(unit, 'grid.unit_per_cell', UNIT_PER_CELL_MIN, UNIT_PER_CELL_MAX);
  }
  const width = c.required(v, 'width', 'grid.width');
  const height = c.required(v, 'height', 'grid.height');
  const okW = width !== undefined && c.number(width, 'grid.width', 1, GRID_SIDE_MAX, true);
  const okH = height !== undefined && c.number(height, 'grid.height', 1, GRID_SIDE_MAX, true);
  return okW && okH ? { width: width as number, height: height as number } : null;
}

function checkAmbient(c: Collector, v: unknown): void {
  if (!isObj(v)) {
    c.add('ambient', 'type');
    return;
  }
  c.keys(v, AMBIENT_KEYS, 'ambient');
  c.optional(v, 'darkness', (x, p) => c.number(x, p, 0, 1), 'ambient.darkness');
  c.optional(
    v,
    'tint',
    (x, p) => {
      if (typeof x !== 'string') c.add(p, 'type');
      else if (!COLOR_PATTERN.test(x)) c.add(p, 'pattern');
    },
    'ambient.tint',
  );
  c.optional(
    v,
    'time_of_day',
    (x, p) => x === null || c.number(x, p, 0, 24),
    'ambient.time_of_day',
  );
  c.optional(
    v,
    'weather',
    (x, p) => {
      if (!isObj(x)) {
        c.add(p, 'type');
        return;
      }
      c.keys(x, WEATHER_KEYS, p);
      c.optional(x, 'type', (y, q) => c.oneOf(y, WEATHER_TYPES, q), `${p}.type`);
      c.optional(x, 'intensity', (y, q) => c.number(y, q, 0, 1), `${p}.intensity`);
    },
    'ambient.weather',
  );
}

function checkPalette(c: Collector, v: unknown): number {
  if (!Array.isArray(v)) {
    c.add('palette', 'type');
    return 0;
  }
  if (v.length === 0) {
    c.add('palette', 'required');
    return 0;
  }
  if (v.length > PALETTE_MAX) {
    c.add('palette', 'too_many');
    return 0;
  }
  if (v[0] !== null) c.add('palette.0', 'const');
  for (let i = 1; i < v.length && !c.full; i++) {
    const entry: unknown = v[i];
    const path = `palette.${i}`;
    if (entry === null) continue;
    if (!isObj(entry)) {
      c.add(path, 'type');
      continue;
    }
    c.keys(entry, PALETTE_KEYS, path);
    const asset = c.required(entry, 'asset', `${path}.asset`);
    if (asset !== undefined) {
      if (typeof asset !== 'string') c.add(`${path}.asset`, 'type');
      else if (!ASSET_REF_PATTERN.test(asset)) c.add(`${path}.asset`, 'pattern');
    }
    c.optional(
      entry,
      'name',
      (x, p) => x === null || c.string(x, p, PALETTE_NAME_MAX),
      `${path}.name`,
    );
    c.optional(
      entry,
      'autotile',
      (x, p) => {
        if (x === null) return;
        if (typeof x !== 'string') c.add(p, 'type');
        else if (!AUTOTILE_PATTERN.test(x)) c.add(p, 'pattern');
      },
      `${path}.autotile`,
    );
  }
  return v.length;
}

function checkLayers(c: Collector, v: unknown): void {
  if (!Array.isArray(v)) {
    c.add('layers', 'type');
    return;
  }
  if (v.length === 0) c.add('layers', 'required');
  if (v.length > LAYER_IDS.length) c.add('layers', 'too_many');
  const seen = new Set<unknown>();
  v.forEach((layer: unknown, i) => {
    const path = `layers.${i}`;
    if (!isObj(layer)) {
      c.add(path, 'type');
      return;
    }
    c.keys(layer, LAYER_KEYS, path);
    const id = c.required(layer, 'id', `${path}.id`);
    const kind = c.required(layer, 'kind', `${path}.kind`);
    const idOk = id !== undefined && c.oneOf(id, LAYER_IDS, `${path}.id`);
    const kindOk = kind !== undefined && c.oneOf(kind, ['tiles', 'objects'], `${path}.kind`);
    if (idOk && kindOk) {
      const tiles = (TILE_LAYERS as readonly unknown[]).includes(id);
      if ((kind === 'tiles') !== tiles) c.add(`${path}.kind`, 'enum');
    }
    if (idOk) {
      if (seen.has(id)) c.add(`${path}.id`, 'duplicate');
      seen.add(id);
    }
    c.optional(layer, 'visible', (x, p) => c.boolean(x, p), `${path}.visible`);
    c.optional(layer, 'locked', (x, p) => c.boolean(x, p), `${path}.locked`);
    c.optional(layer, 'opacity', (x, p) => c.number(x, p, 0, 1), `${path}.opacity`);
    c.optional(layer, 'gm_only', (x, p) => c.boolean(x, p), `${path}.gm_only`);
  });
  // The three tile layers are always part of the stack.
  if (v.length > 0 && TILE_LAYERS.some((id) => !seen.has(id))) c.add('layers', 'required');
}

function checkFloors(c: Collector, v: unknown): Set<string> {
  const uids = new Set<string>();
  if (!Array.isArray(v)) {
    c.add('floors', 'type');
    return uids;
  }
  if (v.length === 0) c.add('floors', 'required');
  if (v.length > FLOORS_MAX) c.add('floors', 'too_many');
  const levels = new Set<number>();
  v.forEach((floor: unknown, i) => {
    const path = `floors.${i}`;
    if (!isObj(floor)) {
      c.add(path, 'type');
      return;
    }
    c.keys(floor, FLOOR_KEYS, path);
    const uid = c.required(floor, 'uid', `${path}.uid`);
    if (uid !== undefined) {
      if (typeof uid !== 'string') c.add(`${path}.uid`, 'type');
      else if (!FLOOR_UID_PATTERN.test(uid)) c.add(`${path}.uid`, 'pattern');
      else if (uids.has(uid)) c.add(`${path}.uid`, 'duplicate');
      else uids.add(uid);
    }
    const level = c.required(floor, 'level', `${path}.level`);
    if (level !== undefined && c.number(level, `${path}.level`, LEVEL_MIN, LEVEL_MAX, true)) {
      if (levels.has(level)) c.add(`${path}.level`, 'duplicate');
      levels.add(level);
    }
    const name = c.required(floor, 'name', `${path}.name`);
    if (
      name !== undefined &&
      c.string(name, `${path}.name`, FLOOR_NAME_MAX) &&
      name.trim() === ''
    ) {
      c.add(`${path}.name`, 'required');
    }
  });
  return uids;
}

function checkBlockMap(
  c: Collector,
  v: unknown,
  path: string,
  size: { width: number; height: number } | null,
): void {
  if (!isObj(v)) {
    c.add(path, 'type');
    return;
  }
  for (const [key, data] of Object.entries(v)) {
    if (c.full) return;
    const p = `${path}.${key}`;
    const m = BLOCK_KEY_PATTERN.exec(key);
    if (m === null) {
      c.add(p, 'pattern');
      continue;
    }
    if (
      size !== null &&
      (Number(m[1]) >= blocksAlong(size.width) || Number(m[2]) >= blocksAlong(size.height))
    ) {
      c.add(p, 'out_of_bounds');
      continue;
    }
    if (typeof data !== 'string') c.add(p, 'type');
    else if (data.length > CHUNK_BASE64_MAX) c.add(p, 'too_long');
    else if (data === '' || data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) {
      c.add(p, 'pattern');
    }
  }
}

function checkChunks(
  c: Collector,
  v: unknown,
  floors: ReadonlySet<string>,
  size: { width: number; height: number } | null,
): void {
  if (!isObj(v)) {
    // An empty map may be exported as [] by a JSON encoder.
    if (!(Array.isArray(v) && v.length === 0)) c.add('chunks', 'type');
    return;
  }
  for (const [floor, layers] of Object.entries(v)) {
    const path = `chunks.${floor}`;
    if (!floors.has(floor)) {
      c.add(path, 'unknown_floor');
      continue;
    }
    if (!isObj(layers)) {
      if (!(Array.isArray(layers) && layers.length === 0)) c.add(path, 'type');
      continue;
    }
    for (const [layer, blocks] of Object.entries(layers)) {
      if (!(TILE_LAYERS as readonly string[]).includes(layer)) {
        c.add(`${path}.${layer}`, 'unknown_layer');
        continue;
      }
      if (Array.isArray(blocks) && blocks.length === 0) continue;
      checkBlockMap(c, blocks, `${path}.${layer}`, size);
    }
  }
}

/* ---- P5 content --------------------------------------------------------------------- */

interface Size {
  readonly width: number;
  readonly height: number;
}

/** Member check of an object whose keys are all required unless listed in `optional`. */
function members(
  c: Collector,
  v: Obj,
  keys: readonly string[],
  optional: readonly string[],
  path: string,
): boolean {
  c.keys(v, keys, path);
  let ok = true;
  for (const key of keys) {
    if (optional.includes(key)) continue;
    if (!Object.hasOwn(v, key) || v[key] === undefined) {
      c.add(join(path, key), 'required');
      ok = false;
    }
  }
  return ok;
}

function checkUid(c: Collector, v: unknown, path: string): v is string {
  if (typeof v !== 'string') {
    c.add(path, 'type');
    return false;
  }
  if (!OBJECT_UID_PATTERN.test(v)) {
    c.add(path, 'pattern');
    return false;
  }
  return true;
}

function checkFloorRef(c: Collector, v: unknown, path: string, floors: ReadonlySet<string>): void {
  if (typeof v !== 'string') c.add(path, 'type');
  else if (!FLOOR_UID_PATTERN.test(v)) c.add(path, 'pattern');
  else if (!floors.has(v)) c.add(path, 'unknown_floor');
}

function checkPoint(c: Collector, v: unknown, path: string, size: Size): v is [number, number] {
  if (!Array.isArray(v) || v.length !== 2) {
    c.add(path, 'type');
    return false;
  }
  return c.number(v[0], path, 0, size.width) && c.number(v[1], path, 0, size.height);
}

function checkColor(c: Collector, v: unknown, path: string): void {
  if (typeof v !== 'string') c.add(path, 'type');
  else if (!COLOR_PATTERN.test(v)) c.add(path, 'pattern');
}

function checkGeometry(
  c: Collector,
  type: (typeof OBJECT_TYPES)[number],
  v: unknown,
  path: string,
  size: Size,
): void {
  if (!isObj(v)) {
    c.add(path, 'type');
    return;
  }
  if (!members(c, v, GEOMETRY_KEYS[type], [], path)) return;
  if (type === 'wall') {
    const points = v['points'];
    if (!Array.isArray(points)) c.add(`${path}.points`, 'type');
    else if (points.length < WALL_POINTS_MIN) c.add(`${path}.points`, 'range');
    else if (points.length > WALL_POINTS_MAX) c.add(`${path}.points`, 'too_many');
    else {
      for (let k = 0; k < points.length && !c.full; k++) {
        if (!checkPoint(c, points[k], `${path}.points.${k}`, size)) break;
      }
    }
    c.boolean(v['closed'], `${path}.closed`);
  } else if (type === 'light') {
    c.number(v['x'], `${path}.x`, 0, size.width);
    c.number(v['y'], `${path}.y`, 0, size.height);
  } else {
    const a = v['a'];
    const b = v['b'];
    if (checkPoint(c, a, `${path}.a`, size) && checkPoint(c, b, `${path}.b`, size)) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.1 - 1e-9 || length > 20 + 1e-9) c.add(path, 'range');
    }
  }
}

function checkFlicker(c: Collector, v: unknown, path: string): void {
  if (!isObj(v)) {
    c.add(path, 'type');
    return;
  }
  if (!members(c, v, ['type', 'amp', 'speed'], [], path)) return;
  c.oneOf(v['type'], FLICKER_TYPES, `${path}.type`);
  c.number(v['amp'], `${path}.amp`, 0, 1);
  c.number(v['speed'], `${path}.speed`, 0.1, 10);
}

function checkCone(c: Collector, v: unknown, path: string): void {
  if (v === null) return;
  if (!isObj(v)) {
    c.add(path, 'type');
    return;
  }
  if (!members(c, v, ['angle', 'direction'], [], path)) return;
  c.number(v['angle'], `${path}.angle`, 1, 359);
  c.number(v['direction'], `${path}.direction`, 0, 360);
}

function checkProps(
  c: Collector,
  type: (typeof OBJECT_TYPES)[number],
  v: unknown,
  path: string,
): void {
  if (!isObj(v)) {
    c.add(path, 'type');
    return;
  }
  if (!members(c, v, PROPS_KEYS[type], PROPS_OPTIONAL, path)) return;
  const p = (key: string): string => `${path}.${key}`;
  const reserved = (key: string): void => {
    if (Object.hasOwn(v, key) && v[key] !== null) c.add(p(key), 'const');
  };
  switch (type) {
    case 'wall':
      c.oneOf(v['kind'], WALL_KINDS, p('kind'));
      c.number(v['thickness'], p('thickness'), 0.05, 2);
      c.boolean(v['blocks_vision'], p('blocks_vision'));
      c.boolean(v['blocks_light'], p('blocks_light'));
      c.boolean(v['blocks_move'], p('blocks_move'));
      reserved('texture_asset');
      c.optional(v, 'height', (x, q) => x === null || c.number(x, q, 0, 20), p('height'));
      break;
    case 'door':
      c.oneOf(v['state'], DOOR_STATES, p('state'));
      c.boolean(v['locked'], p('locked'));
      c.boolean(v['secret'], p('secret'));
      reserved('asset_open');
      reserved('asset_closed');
      c.oneOf(v['swing'], DOOR_SWINGS, p('swing'));
      break;
    case 'window':
      c.oneOf(v['kind'], WINDOW_KINDS, p('kind'));
      break;
    case 'light': {
      const radius = c.number(v['radius'], p('radius'), 0, LIGHT_RADIUS_MAX);
      const dim = c.number(v['dim_radius'], p('dim_radius'), 0, LIGHT_RADIUS_MAX);
      if (radius && dim && (v['dim_radius'] as number) < (v['radius'] as number)) {
        c.add(p('dim_radius'), 'below_radius');
      }
      checkColor(c, v['color'], p('color'));
      c.number(v['intensity'], p('intensity'), 0, 1);
      checkFlicker(c, v['flicker'], p('flicker'));
      checkCone(c, v['cone'], p('cone'));
      c.boolean(v['enabled'], p('enabled'));
      if (v['follows_token'] !== null) checkUid(c, v['follows_token'], p('follows_token'));
      break;
    }
  }
}

function checkObjects(
  c: Collector,
  v: unknown,
  floors: ReadonlySet<string>,
  size: Size | null,
): void {
  if (v === null) return;
  if (!Array.isArray(v)) {
    c.add('objects', 'type');
    return;
  }
  if (v.length > OBJECTS_MAX) {
    c.add('objects', 'too_many');
    return;
  }
  const uids = new Set<string>();
  for (let i = 0; i < v.length && !c.full; i++) {
    const object: unknown = v[i];
    const path = `objects.${i}`;
    if (!isObj(object) || Object.keys(object).length === 0) {
      c.add(path, 'type');
      continue;
    }
    if (!members(c, object, OBJECT_KEYS, OBJECT_OPTIONAL, path)) continue;
    if (checkUid(c, object['uid'], `${path}.uid`)) {
      const key = object['uid'].toLowerCase();
      if (uids.has(key)) c.add(`${path}.uid`, 'duplicate');
      uids.add(key);
    }
    checkFloorRef(c, object['floor'], `${path}.floor`, floors);
    c.optional(object, 'layer', (x, q) => c.oneOf(x, OBJECT_LAYER_IDS, q), `${path}.layer`);
    c.optional(
      object,
      'visibility',
      (x, q) => c.oneOf(x, OBJECT_VISIBILITIES, q),
      `${path}.visibility`,
    );
    c.optional(object, 'locked', (x, q) => c.boolean(x, q), `${path}.locked`);
    c.optional(
      object,
      'sort_order',
      (x, q) => c.number(x, q, -SORT_ORDER_MAX, SORT_ORDER_MAX, true),
      `${path}.sort_order`,
    );
    const type = object['type'];
    if (!c.oneOf(type, OBJECT_TYPES, `${path}.type`)) continue;
    const t = type as (typeof OBJECT_TYPES)[number];
    if (size !== null) checkGeometry(c, t, object['geometry'], `${path}.geometry`, size);
    checkProps(c, t, object['props'], `${path}.props`);
  }
}

function checkTokenLight(c: Collector, v: unknown, path: string): void {
  if (v === null) return;
  if (!isObj(v)) {
    c.add(path, 'type');
    return;
  }
  if (!members(c, v, TOKEN_LIGHT_KEYS, [], path)) return;
  const radius = c.number(v['radius'], `${path}.radius`, 0, TOKEN_LIGHT_RADIUS_MAX);
  const dim = c.number(v['dim_radius'], `${path}.dim_radius`, 0, TOKEN_LIGHT_RADIUS_MAX);
  if (radius && dim && (v['dim_radius'] as number) < (v['radius'] as number)) {
    c.add(`${path}.dim_radius`, 'below_radius');
  }
  checkColor(c, v['color'], `${path}.color`);
  c.number(v['intensity'], `${path}.intensity`, 0, 1);
  c.boolean(v['flicker'], `${path}.flicker`);
}

function checkTokenRef(c: Collector, v: unknown, path: string): void {
  if (typeof v !== 'string') {
    c.add(path, 'type');
    return;
  }
  const m = TOKEN_REF_PATTERN.exec(v);
  // eslint-disable-next-line no-control-regex -- control characters are refused in names
  if (m === null || m[1]!.trim() !== m[1] || /[\u0000-\u001f\u007f]/.test(m[1]!)) {
    c.add(path, 'pattern');
  } else if (charLength(m[1]!) > TOKEN_NAME_MAX) {
    c.add(path, 'too_long');
  }
}

function checkPlacedTokens(
  c: Collector,
  v: unknown,
  floors: ReadonlySet<string>,
  size: Size | null,
): void {
  if (v === null) return;
  if (!Array.isArray(v)) {
    c.add('tokens_placed', 'type');
    return;
  }
  if (v.length > TOKENS_PLACED_MAX) {
    c.add('tokens_placed', 'too_many');
    return;
  }
  const uids = new Set<string>();
  for (let i = 0; i < v.length && !c.full; i++) {
    const token: unknown = v[i];
    const path = `tokens_placed.${i}`;
    if (!isObj(token) || Object.keys(token).length === 0) {
      c.add(path, 'type');
      continue;
    }
    if (!members(c, token, TOKEN_KEYS, TOKEN_OPTIONAL, path)) continue;
    if (checkUid(c, token['uid'], `${path}.uid`)) {
      const key = token['uid'].toLowerCase();
      if (uids.has(key)) c.add(`${path}.uid`, 'duplicate');
      uids.add(key);
    }
    checkTokenRef(c, token['token'], `${path}.token`);
    checkFloorRef(c, token['floor'], `${path}.floor`, floors);
    if (size !== null) {
      c.number(token['x'], `${path}.x`, 0, size.width);
      c.number(token['y'], `${path}.y`, 0, size.height);
    }
    c.optional(token, 'rotation', (x, q) => c.number(x, q, 0, 359, true), `${path}.rotation`);
    c.optional(token, 'scale', (x, q) => c.number(x, q, 0.25, 4), `${path}.scale`);
    c.optional(token, 'hidden', (x, q) => c.boolean(x, q), `${path}.hidden`);
    c.optional(
      token,
      'light_override',
      (x, q) => checkTokenLight(c, x, q),
      `${path}.light_override`,
    );
  }
}

function checkFog(c: Collector, v: unknown, floors: ReadonlySet<string>, size: Size | null): void {
  if (v === null || (Array.isArray(v) && v.length === 0)) return;
  if (!isObj(v)) {
    c.add('fog', 'type');
    return;
  }
  for (const [floor, blocks] of Object.entries(v)) {
    const path = `fog.${floor}`;
    if (!floors.has(floor)) {
      c.add(path, 'unknown_floor');
      continue;
    }
    if (blocks === null || (Array.isArray(blocks) && blocks.length === 0)) continue;
    if (!isObj(blocks)) {
      c.add(path, 'type');
      continue;
    }
    for (const [key, data] of Object.entries(blocks)) {
      if (c.full) return;
      const p = `${path}.${key}`;
      const m = BLOCK_KEY_PATTERN.exec(key);
      if (m === null) c.add(p, 'pattern');
      else if (
        size !== null &&
        (Number(m[1]) >= blocksAlong(size.width) || Number(m[2]) >= blocksAlong(size.height))
      ) {
        c.add(p, 'out_of_bounds');
      } else if (typeof data !== 'string') c.add(p, 'type');
      else if (data.length > FOG_BASE64_MAX) c.add(p, 'too_long');
      else if (data === '' || data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) {
        c.add(p, 'pattern');
      }
    }
  }
}

function checkGeneration(c: Collector, v: unknown): void {
  if (v === null) return;
  if (!isObj(v)) {
    c.add('generation', 'type');
    return;
  }
  c.keys(v, GENERATION_KEYS, 'generation');
  const generator = c.required(v, 'generator', 'generation.generator');
  if (generator !== undefined) {
    if (typeof generator !== 'string') c.add('generation.generator', 'type');
    else if (!GENERATOR_PATTERN.test(generator)) c.add('generation.generator', 'pattern');
  }
  const version = c.required(v, 'gen_version', 'generation.gen_version');
  if (version !== undefined) c.number(version, 'generation.gen_version', 1, 1_000_000, true);
  const seed = c.required(v, 'seed', 'generation.seed');
  if (seed !== undefined) c.string(seed, 'generation.seed', 64, 1);
  c.optional(
    v,
    'params',
    (x, p) => {
      const emptyList = Array.isArray(x) && x.length === 0;
      if (!isObj(x) && !emptyList) c.add(p, 'type');
      else if (new TextEncoder().encode(JSON.stringify(x)).length > GENERATION_PARAMS_MAX_BYTES) {
        c.add(p, 'too_long');
      }
    },
    'generation.params',
  );
}

/**
 * Structural validation of a document at the current format version (same rules as
 * map.schema.json and the server, plus the cross-checks a schema cannot express: unique layer,
 * floor uids and levels, tile/object layer kinds, blocks of known floors inside the grid).
 */
export function validateMapDocument(value: unknown): MapDocumentValidation {
  const c = new Collector();
  if (!isObj(value)) {
    c.add('', 'type');
    return { ok: false, issues: c.issues };
  }
  const dangerous = findDangerousKey(value);
  if (dangerous !== null) {
    c.add(dangerous, 'dangerous_key');
    return { ok: false, issues: c.issues };
  }
  c.keys(value, DOCUMENT_KEYS, '');
  const format = c.required(value, 'format', 'format');
  if (format !== undefined && format !== MAP_DOCUMENT_FORMAT) c.add('format', 'const');
  const version = c.required(value, 'format_version', 'format_version');
  if (version !== undefined && version !== CURRENT_FORMAT_VERSION) c.add('format_version', 'const');
  c.optional(value, 'app_version', (x, p) => c.string(x, p, 40), 'app_version');
  const name = c.required(value, 'name', 'name');
  if (name !== undefined && c.string(name, 'name', MAP_NAME_MAX, 1) && name.trim() === '') {
    c.add('name', 'required');
  }
  c.optional(value, 'kind', (x, p) => c.oneOf(x, ['battle', 'world'], p), 'kind');
  const grid = c.required(value, 'grid', 'grid');
  const size = grid === undefined ? null : checkGrid(c, grid);
  c.optional(value, 'theme', (x, p) => c.oneOf(x, MAP_THEMES, p), 'theme');
  c.optional(value, 'ambient', (x) => checkAmbient(c, x), 'ambient');
  const palette = c.required(value, 'palette', 'palette');
  if (palette !== undefined) checkPalette(c, palette);
  const layers = c.required(value, 'layers', 'layers');
  if (layers !== undefined) checkLayers(c, layers);
  const floorsValue = c.required(value, 'floors', 'floors');
  const floors = floorsValue === undefined ? new Set<string>() : checkFloors(c, floorsValue);
  const chunks = c.required(value, 'chunks', 'chunks');
  if (chunks !== undefined) checkChunks(c, chunks, floors, size);
  c.optional(value, 'objects', (x) => checkObjects(c, x, floors, size), 'objects');
  c.optional(value, 'tokens_placed', (x) => checkPlacedTokens(c, x, floors, size), 'tokens_placed');
  c.optional(value, 'fog', (x) => checkFog(c, x, floors, size), 'fog');
  for (const key of LATER_LISTS) {
    c.optional(
      value,
      key,
      (x, p) => {
        if (x === null) return;
        if (!Array.isArray(x)) c.add(p, 'type');
        else if (x.length > 0) c.add(p, 'unsupported');
      },
      key,
    );
  }
  c.optional(value, 'generation', (x) => checkGeneration(c, x), 'generation');
  if (c.issues.length > 0) return { ok: false, issues: c.issues };
  return { ok: true, doc: value as unknown as MapDocumentV1, issues: [] };
}

/* ---- Tile blocks ---------------------------------------------------------------------- */

/** Bytes of a base64 string (atob: browsers and Node ≥ 16). */
export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface BlockCheck {
  /** Non-empty tile blocks. */
  readonly blocks: number;
  /** Non-empty cells over every tile layer. */
  readonly cells: number;
  /** Non-empty fog blocks (P5). */
  readonly fogBlocks: number;
  readonly issues: readonly MapDocumentIssue[];
}

/**
 * Decodes every tile block of a valid document (projet.md 12.2 controls: decompressed size,
 * magic, version, layer of the header, palette index < palette length; as on the server, a
 * painted cell outside the grid is `out_of_bounds` and reserved flag bits are `bad_flags`) and
 * every fog block (12.3: raw deflate of exactly 2 048 bytes, else `bad_block`).
 */
export async function checkMapDocumentBlocks(doc: MapDocumentV1): Promise<BlockCheck> {
  const c = new Collector();
  const { width, height } = doc.grid;
  let blocks = 0;
  let cells = 0;
  let fogBlocks = 0;
  for (const [floor, layers] of Object.entries(doc.chunks)) {
    if (!isObj(layers)) continue;
    for (const layer of TILE_LAYERS) {
      const map = layers[layer];
      if (!isObj(map)) continue;
      for (const [key, data] of Object.entries(map)) {
        if (c.full) return { blocks, cells, fogBlocks, issues: c.issues };
        const path = `chunks.${floor}.${layer}.${key}`;
        let decoded;
        try {
          decoded = await decodeChunk(base64ToBytes(data as string), {
            paletteSize: doc.palette.length,
            layer,
          });
        } catch (error) {
          if (!(error instanceof ChunkCodecError) && !(error instanceof DOMException)) throw error;
          c.add(path, 'bad_block');
          continue;
        }
        if (decoded === null) continue;
        const [cx, cy] = key.split(':').map(Number) as [number, number];
        let problem: MapDocumentIssueCode | null = null;
        for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE && problem === null; i++) {
          if (decoded.cells[i * CELL_STRIDE] === 0) continue;
          const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
          const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
          if (x >= width || y >= height) problem = 'out_of_bounds';
          else if (decoded.cells[i * CELL_STRIDE + 2]! > FLAGS_MAX) problem = 'bad_flags';
        }
        if (problem !== null) {
          c.add(path, problem);
          continue;
        }
        blocks++;
        cells += decoded.filled;
      }
    }
  }
  const fog = isObj(doc.fog) ? doc.fog : {};
  for (const [floor, map] of Object.entries(fog)) {
    if (!isObj(map)) continue;
    for (const [key, data] of Object.entries(map)) {
      if (c.full) return { blocks, cells, fogBlocks, issues: c.issues };
      try {
        const bits = await decodeFog(base64ToBytes(data as string));
        if (!isFogEmpty(bits)) fogBlocks++;
      } catch (error) {
        if (!(error instanceof FogCodecError) && !(error instanceof DOMException)) throw error;
        c.add(`fog.${floor}.${key}`, 'bad_block');
      }
    }
  }
  return { blocks, cells, fogBlocks, issues: c.issues };
}

/** Distinct asset references of a document (palette; object assets come with P5). */
export function documentAssetRefs(doc: MapDocumentV1): string[] {
  const refs = new Set<string>();
  for (const entry of doc.palette) if (entry !== null) refs.add(entry.asset.toLowerCase());
  return [...refs];
}

/* ---- Format migrations ------------------------------------------------------------------ */

/** `migrate_vN_to_vN+1`: takes a document at version N, returns it at version N + 1. */
export type MigrationStep = (doc: Obj) => Obj;

/**
 * Format migrations, keyed by the source version N (projet.md 12.1: every format change adds
 * `format_version + 1` and a `migrate_vN_to_vN+1`, on the client and on the server). Empty
 * while the format is at version 1.
 */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = Object.freeze({});

export type MigrationFailure = 'not_a_map' | 'unsupported_format_version' | 'missing_migration';

export type MigrationResult =
  | { readonly ok: true; readonly doc: Obj; readonly from: number; readonly to: number }
  | { readonly ok: false; readonly code: MigrationFailure; readonly version: number | null };

/**
 * Brings a parsed document to the current format version. Newer versions are refused
 * (`unsupported_format_version`, as on the server); the input object is not modified.
 */
export function migrateMapDocument(
  value: unknown,
  migrations: Readonly<Record<number, MigrationStep>> = MIGRATIONS,
  current: number = CURRENT_FORMAT_VERSION,
): MigrationResult {
  if (!isObj(value) || value['format'] !== MAP_DOCUMENT_FORMAT) {
    return { ok: false, code: 'not_a_map', version: null };
  }
  const from = value['format_version'];
  if (!isInt(from) || from < 1) return { ok: false, code: 'not_a_map', version: null };
  if (from > current) return { ok: false, code: 'unsupported_format_version', version: from };
  let doc: Obj = value;
  for (let v = from; v < current; v++) {
    const step = migrations[v];
    if (step === undefined) return { ok: false, code: 'missing_migration', version: v };
    doc = { ...step(structuredClone(doc)), format_version: v + 1 };
  }
  return { ok: true, doc, from, to: current };
}

/* ---- Parsing a file --------------------------------------------------------------------- */

export type MapDocumentErrorCode = 'not_json' | MigrationFailure | 'invalid';

export class MapDocumentError extends Error {
  override readonly name = 'MapDocumentError';
  constructor(
    readonly code: MapDocumentErrorCode,
    readonly issues: readonly MapDocumentIssue[] = [],
    readonly version: number | null = null,
  ) {
    super(code);
  }
}

export interface ParsedMapDocument {
  readonly doc: MapDocumentV1;
  /** Format version of the file before migration. */
  readonly fromVersion: number;
}

/** JSON text ⇒ migrated and validated document; throws MapDocumentError. */
export function parseMapDocument(text: string): ParsedMapDocument {
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new MapDocumentError('not_json');
  }
  const migrated = migrateMapDocument(value);
  if (!migrated.ok) throw new MapDocumentError(migrated.code, [], migrated.version);
  const result = validateMapDocument(migrated.doc);
  if (!result.ok) throw new MapDocumentError('invalid', result.issues);
  return { doc: result.doc, fromVersion: migrated.from };
}
