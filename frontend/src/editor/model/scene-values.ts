/**
 * Values of the P5 scene content (objects, placed tokens, ambient — projet.md 12.4, contract in
 * editor/contracts.ts and etapes/P05 "Contrat d'API"): normalisation (3 decimals, like the
 * server, so that both states stay equal), validation (an invalid value would make the server
 * refuse the whole batch) and patch helpers.
 */
import type {
  Ambient,
  DoorProps,
  LightProps,
  Link,
  MapObject,
  ObjectLayerId,
  ObjectPatch,
  ObjectVisibility,
  PlacedToken,
  PlacedTokenPatch,
  PortalProps,
  Point,
  StairsProps,
  TokenLightDef,
  WallProps,
  WindowProps,
} from '../contracts';
import type { PinObject, SecretObject, TrapObject, ZoneObject } from '../contracts-notes';
import { MapOpError } from './ops';

export const UID_PATTERN = /^[A-Za-z0-9_-]{1,21}$/;
export const MAX_WALL_POINTS = 1000;
export const MAX_OBJECTS = 20_000;
export const MAX_PLACED_TOKENS = 2_000;
const LAYERS: readonly ObjectLayerId[] = ['walls', 'props', 'lighting', 'labels', 'gm'];
const VISIBILITIES: readonly ObjectVisibility[] = ['all', 'gm', 'hidden_until_revealed'];
const WALL_KINDS = ['stone', 'brick', 'wood', 'metal', 'natural', 'invisible'];
const OBJECT_TYPES: readonly MapObject['type'][] = [
  'wall',
  'door',
  'window',
  'light',
  'stairs',
  'portal',
  'pin',
  'zone',
  'trap',
  'secret',
];
const COLOR = /^#[0-9a-fA-F]{6}$/;

export const round3 = (v: number): number => Math.round(v * 1000) / 1000;
export const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface Bounds {
  readonly width: number;
  readonly height: number;
}

function bad(message: string): never {
  throw new MapOpError('bad_object', message);
}

function num(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) bad(`Invalid ${what}`);
  return v;
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') bad(`Invalid ${what}`);
  return v;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) bad(`Invalid ${what}`);
  return v as T;
}

function point(p: unknown, b: Bounds): Point {
  if (!Array.isArray(p) || p.length !== 2) bad('Invalid point');
  const x = round3(num(p[0], -1e-3, b.width + 1e-3, 'x'));
  const y = round3(num(p[1], -1e-3, b.height + 1e-3, 'y'));
  return [Math.min(b.width, Math.max(0, x)), Math.min(b.height, Math.max(0, y))];
}

function segment(g: unknown, b: Bounds): { a: Point; b: Point } {
  const s = g as { a?: unknown; b?: unknown } | null;
  if (typeof s !== 'object' || s === null) bad('Invalid geometry');
  const a = point(s.a, b);
  const e = point(s.b, b);
  const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
  if (len < 0.1 - 1e-9 || len > 20 + 1e-9) bad('Invalid segment length');
  return { a, b: e };
}

export const MAX_POLYGON_POINTS = 200;

function polygon(g: unknown, b: Bounds): { polygon: { x: number; y: number }[] } {
  const raw = (g as { polygon?: unknown } | null)?.polygon;
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > MAX_POLYGON_POINTS) {
    bad('Invalid polygon');
  }
  return {
    polygon: raw.map((p) => {
      const q = p as { x?: unknown; y?: unknown } | null;
      const [x, y] = point([q?.x, q?.y], b);
      return { x, y };
    }),
  };
}

export const PIN_ICONS = ['place', 'danger', 'treasure', 'npc', 'info'] as const;
export const SECRET_KINDS = ['passage', 'room', 'object'] as const;

function noteLink(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !UID_PATTERN.test(v)) bad('Invalid note link');
  return v;
}

function pinProps(p: PinObject['props']): PinObject['props'] {
  if (typeof p.color !== 'string' || !COLOR.test(p.color)) bad('Invalid color');
  return {
    icon: oneOf(p.icon, PIN_ICONS, 'pin icon'),
    color: p.color.toLowerCase(),
    note: noteLink(p.note),
  };
}

function zoneProps(p: ZoneObject['props']): ZoneObject['props'] {
  return {
    kind: oneOf(p.kind, ['description'], 'zone kind'),
    note: noteLink(p.note),
    show_on_enter: bool(p.show_on_enter, 'show_on_enter'),
  };
}

function trapProps(p: TrapObject['props']): TrapObject['props'] {
  return {
    note: noteLink(p.note),
    reveal_effect: oneOf(p.reveal_effect, ['pulse', 'none'], 'reveal_effect'),
  };
}

function secretProps(p: SecretObject['props']): SecretObject['props'] {
  return { kind: oneOf(p.kind, SECRET_KINDS, 'secret kind'), note: noteLink(p.note) };
}

function wallProps(p: WallProps): WallProps {
  return {
    kind: oneOf(p.kind, WALL_KINDS as WallProps['kind'][], 'wall kind'),
    thickness: round3(num(p.thickness, 0.05, 2, 'thickness')),
    blocks_vision: bool(p.blocks_vision, 'blocks_vision'),
    blocks_light: bool(p.blocks_light, 'blocks_light'),
    blocks_move: bool(p.blocks_move, 'blocks_move'),
    texture_asset: null,
    height: p.height === null ? null : round3(num(p.height, 0, 20, 'height')),
  };
}

const FLOOR_UID = /^[A-Za-z0-9_-]{1,21}$/;
export const PORTAL_ICONS = ['portal', 'door', 'stairs', 'ladder', 'trapdoor'] as const;

/** Validated link (door, stairs, portal): ids stay strings, `broken` / `map_name` are read-side hints. */
export function linkProps(l: unknown): Link {
  if (typeof l !== 'object' || l === null) bad('Invalid link');
  const k = l as Record<string, unknown>;
  const mapId = k['map_id'];
  if (mapId !== null && typeof mapId !== 'string' && typeof mapId !== 'number')
    bad('Invalid link map');
  const floor = k['floor'] ?? null;
  if (floor !== null && (typeof floor !== 'string' || !FLOOR_UID.test(floor)))
    bad('Invalid link floor');
  const coord = (v: unknown, max: number, what: string): number | null => {
    if (v === null || v === undefined) return null;
    return round3(num(v, 0, max, what));
  };
  return {
    map_id: mapId === null ? null : String(mapId),
    floor,
    x: coord(k['x'], 100_000, 'link x'),
    y: coord(k['y'], 100_000, 'link y'),
    ...(typeof k['map_name'] === 'string' ? { map_name: k['map_name'] } : {}),
    ...(k['broken'] === true ? { broken: true as const } : {}),
  };
}

function stairsProps(p: StairsProps): StairsProps {
  if (typeof p.to_floor !== 'string' || !FLOOR_UID.test(p.to_floor)) bad('Invalid to_floor');
  return {
    direction: oneOf(p.direction, ['up', 'down'], 'direction'),
    to_floor: p.to_floor,
    ...(p.link !== undefined && p.link !== null ? { link: linkProps(p.link) } : {}),
  };
}

function portalProps(p: PortalProps): PortalProps {
  if (typeof p.color !== 'string' || !COLOR.test(p.color)) bad('Invalid color');
  if (
    p.label !== undefined &&
    (typeof p.label !== 'string' || p.label.length < 1 || p.label.length > 60)
  ) {
    bad('Invalid label');
  }
  return {
    icon: oneOf(p.icon, PORTAL_ICONS, 'portal icon'),
    color: p.color.toLowerCase(),
    ...(p.label !== undefined ? { label: p.label } : {}),
    link: linkProps(p.link),
  };
}

function doorProps(p: DoorProps): DoorProps {
  return {
    state: oneOf(p.state, ['open', 'closed'], 'door state'),
    locked: bool(p.locked, 'locked'),
    secret: bool(p.secret, 'secret'),
    asset_open: null,
    asset_closed: null,
    swing: oneOf(p.swing, ['a', 'b', 'slide'], 'swing'),
    ...(p.link !== undefined && p.link !== null ? { link: linkProps(p.link) } : {}),
  };
}

function windowProps(p: WindowProps): WindowProps {
  return { kind: oneOf(p.kind, ['glass', 'bars', 'opening'], 'window kind') };
}

export function lightProps(p: LightProps): LightProps {
  const radius = round3(num(p.radius, 0, 100, 'radius'));
  const dim = round3(num(p.dim_radius, 0, 100, 'dim_radius'));
  if (dim < radius) bad('dim_radius below radius');
  if (typeof p.color !== 'string' || !COLOR.test(p.color)) bad('Invalid color');
  const f = p.flicker;
  if (typeof f !== 'object' || f === null) bad('Invalid flicker');
  const cone =
    p.cone === null
      ? null
      : {
          angle: round3(num(p.cone.angle, 1, 359, 'cone angle')),
          direction: round3(num(p.cone.direction, 0, 360, 'cone direction')),
        };
  if (p.follows_token !== null && !UID_PATTERN.test(String(p.follows_token))) bad('follows_token');
  return {
    radius,
    dim_radius: dim,
    color: p.color.toLowerCase(),
    intensity: round3(num(p.intensity, 0, 1, 'intensity')),
    flicker: {
      type: oneOf(f.type, ['none', 'torch', 'pulse'], 'flicker type'),
      amp: round3(num(f.amp, 0, 1, 'flicker amp')),
      speed: round3(num(f.speed, 0.1, 10, 'flicker speed')),
    },
    cone,
    enabled: bool(p.enabled, 'enabled'),
    follows_token: p.follows_token,
  };
}

/** Geometry of an object of a given type, normalised. */
function geometry(type: MapObject['type'], g: MapObject['geometry'], b: Bounds) {
  switch (type) {
    case 'wall': {
      const w = g as { points?: unknown; closed?: unknown };
      if (!Array.isArray(w.points) || w.points.length < 2 || w.points.length > MAX_WALL_POINTS) {
        bad('Invalid wall points');
      }
      return { points: w.points.map((p) => point(p, b)), closed: bool(w.closed, 'closed') };
    }
    case 'door':
    case 'window':
      return segment(g, b);
    case 'light':
    case 'portal': {
      const l = g as { x?: unknown; y?: unknown };
      const [x, y] = point([l.x, l.y], b);
      return { x, y };
    }
    case 'pin': {
      const l = g as { x?: unknown; y?: unknown };
      const [x, y] = point([l.x, l.y], b);
      return { x, y };
    }
    case 'zone':
      return polygon(g, b);
    case 'trap': {
      const t = g as { polygon?: unknown; x?: unknown; y?: unknown };
      if (t.polygon !== undefined) return polygon(g, b);
      const [x, y] = point([t.x, t.y], b);
      return { x, y };
    }
    case 'secret': {
      const sg = g as { polygon?: unknown };
      if (sg.polygon !== undefined) return polygon(g, b);
      return segment(g, b);
    }
    case 'stairs': {
      const r = g as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
      const w = num(r.w, 1, 10, 'stairs w');
      const h = num(r.h, 1, 10, 'stairs h');
      const x = num(r.x, 0, b.width, 'stairs x');
      const y = num(r.y, 0, b.height, 'stairs y');
      if (![w, h, x, y].every(Number.isInteger)) bad('Stairs geometry must be integers');
      if (x + w > b.width || y + h > b.height) bad('Stairs out of bounds');
      return { x, y, w, h };
    }
  }
}

function props(type: MapObject['type'], p: MapObject['props']): MapObject['props'] {
  if (typeof p !== 'object' || p === null) bad('Invalid props');
  switch (type) {
    case 'wall':
      return wallProps(p as WallProps);
    case 'door':
      return doorProps(p as DoorProps);
    case 'window':
      return windowProps(p as WindowProps);
    case 'light':
      return lightProps(p as LightProps);
    case 'stairs':
      return stairsProps(p as StairsProps);
    case 'portal':
      return portalProps(p as PortalProps);
    case 'pin':
      return pinProps(p as PinObject['props']);
    case 'zone':
      return zoneProps(p as ZoneObject['props']);
    case 'trap':
      return trapProps(p as TrapObject['props']);
    case 'secret':
      return secretProps(p as SecretObject['props']);
  }
}

/** Validated, rounded copy of an object (frozen). `rev` is kept (≥ 1). */
export function normalizeObject(o: MapObject, b: Bounds): MapObject {
  if (typeof o !== 'object' || o === null || !UID_PATTERN.test(String(o.uid))) bad('Invalid uid');
  const type = oneOf(o.type, OBJECT_TYPES, 'type');
  if (typeof o.floor !== 'string' || o.floor === '') bad('Invalid floor');
  const sort = num(o.sort_order, -1_000_000, 1_000_000, 'sort_order');
  if (!Number.isInteger(sort)) bad('Invalid sort_order');
  const rev = Number.isInteger(o.rev) && o.rev >= 1 ? o.rev : 1;
  return Object.freeze({
    uid: o.uid,
    floor: o.floor,
    type,
    layer: oneOf(o.layer, LAYERS, 'layer'),
    geometry: geometry(type, o.geometry, b),
    props: props(type, o.props),
    visibility: oneOf(o.visibility, VISIBILITIES, 'visibility'),
    locked: bool(o.locked, 'locked'),
    sort_order: sort,
    rev,
  } as MapObject);
}

export function tokenLight(l: TokenLightDef | null): TokenLightDef | null {
  if (l === null) return null;
  const radius = round3(num(l.radius, 0, 100, 'light radius'));
  const dim = round3(num(l.dim_radius, 0, 100, 'light dim_radius'));
  if (dim < radius) bad('dim_radius below radius');
  if (typeof l.color !== 'string' || !COLOR.test(l.color)) bad('Invalid color');
  return {
    radius,
    dim_radius: dim,
    color: l.color.toLowerCase(),
    intensity: round3(num(l.intensity, 0, 1, 'intensity')),
    flicker: bool(l.flicker, 'flicker'),
  };
}

/** Validated, rounded copy of a placed token (frozen). */
export function normalizeToken(t: PlacedToken, b: Bounds): PlacedToken {
  if (typeof t !== 'object' || t === null || !UID_PATTERN.test(String(t.uid))) bad('Invalid uid');
  if (typeof t.floor !== 'string' || t.floor === '') bad('Invalid floor');
  if (typeof t.token_id !== 'string' || t.token_id === '') bad('Invalid token_id');
  const [x, y] = point([t.x, t.y], b);
  const rotation = Math.round(num(t.rotation, 0, 359.5, 'rotation')) % 360;
  return Object.freeze({
    uid: t.uid,
    floor: t.floor,
    token_id: t.token_id,
    x,
    y,
    rotation,
    scale: round2(num(t.scale, 0.25, 4, 'scale')),
    hidden: bool(t.hidden, 'hidden'),
    light_override: tokenLight(t.light_override),
    rev: Number.isInteger(t.rev) && t.rev >= 1 ? t.rev : 1,
  });
}

const OBJECT_PATCH_KEYS = [
  'geometry',
  'props',
  'visibility',
  'layer',
  'locked',
  'sort_order',
] as const;
const TOKEN_PATCH_KEYS = ['x', 'y', 'rotation', 'scale', 'hidden', 'light_override'] as const;

/** Object with a patch applied (validated); `rev` unchanged. */
export function patchObject(o: MapObject, patch: ObjectPatch, b: Bounds): MapObject {
  const next = { ...o } as Record<string, unknown>;
  for (const k of OBJECT_PATCH_KEYS) if (patch[k] !== undefined) next[k] = patch[k];
  return normalizeObject(next as unknown as MapObject, b);
}

/** Previous values of the patched keys (the inverse patch). */
export function objectInversePatch(o: MapObject, patch: ObjectPatch): ObjectPatch {
  const out: Record<string, unknown> = {};
  for (const k of OBJECT_PATCH_KEYS) if (patch[k] !== undefined) out[k] = o[k];
  return out as ObjectPatch;
}

/** Patch restricted to the keys whose value actually changes (deep comparison). */
export function changedObjectPatch(o: MapObject, patch: ObjectPatch): ObjectPatch {
  const out: Record<string, unknown> = {};
  for (const k of OBJECT_PATCH_KEYS) {
    if (patch[k] !== undefined && !sameValue(patch[k], o[k])) out[k] = patch[k];
  }
  return out as ObjectPatch;
}

export function patchToken(t: PlacedToken, patch: PlacedTokenPatch, b: Bounds): PlacedToken {
  const next = { ...t } as Record<string, unknown>;
  for (const k of TOKEN_PATCH_KEYS) if (patch[k] !== undefined) next[k] = patch[k];
  return normalizeToken(next as unknown as PlacedToken, b);
}

export function tokenInversePatch(t: PlacedToken, patch: PlacedTokenPatch): PlacedTokenPatch {
  const out: Record<string, unknown> = {};
  for (const k of TOKEN_PATCH_KEYS) if (patch[k] !== undefined) out[k] = t[k];
  return out as PlacedTokenPatch;
}

export function changedTokenPatch(t: PlacedToken, patch: PlacedTokenPatch): PlacedTokenPatch {
  const out: Record<string, unknown> = {};
  for (const k of TOKEN_PATCH_KEYS) {
    if (patch[k] !== undefined && !sameValue(patch[k], t[k])) out[k] = patch[k];
  }
  return out as PlacedTokenPatch;
}

/** Deep equality of JSON-like values (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameValue(v, bb[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export const DEFAULT_AMBIENT: Ambient = Object.freeze({
  darkness: 0,
  tint: '#000000',
  time_of_day: null,
  weather: Object.freeze({ type: 'none', intensity: 0 }),
});

/** Ambient from server data (missing / invalid fields ⇒ defaults). */
export function ambientOf(value: unknown): Ambient {
  const a = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const w = (typeof a['weather'] === 'object' && a['weather'] !== null ? a['weather'] : {}) as {
    type?: unknown;
    intensity?: unknown;
  };
  const d = a['darkness'];
  const darkness = typeof d === 'number' && Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
  const tintValue = a['tint'];
  const tint =
    typeof tintValue === 'string' && COLOR.test(tintValue) ? tintValue.toLowerCase() : '#000000';
  const rawTod = a['time_of_day'];
  const todNumber =
    typeof rawTod === 'number' ? rawTod : typeof rawTod === 'string' ? hours(rawTod) : NaN;
  const tod = Number.isFinite(todNumber) && todNumber >= 0 && todNumber <= 24 ? todNumber : null;
  const types = ['none', 'rain', 'snow', 'fog', 'storm'] as const;
  const type = (types as readonly unknown[]).includes(w.type)
    ? (w.type as (typeof types)[number])
    : 'none';
  const intensity = typeof w.intensity === 'number' ? Math.min(1, Math.max(0, w.intensity)) : 0;
  return Object.freeze({
    darkness,
    tint,
    time_of_day: tod,
    weather: Object.freeze({ type, intensity }),
  });
}

/** "18.5" or "18:30" ⇒ 18.5. */
function hours(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (m !== null) return Number(m[1]) + Number(m[2]) / 60;
  return text.trim() === '' ? NaN : Number(text);
}
