import type {
  DoorObject,
  LightObject,
  MapObject,
  PlacedToken,
  Point,
  TokenDefView,
  WallObject,
} from '../../src/editor/contracts';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { grid, palette } from './helpers';

export function tokenDef(id: string, kind: TokenDefView['kind'] = 'pc', size = 1): TokenDefView {
  return {
    id,
    name: `Token ${id}`,
    imageUrl: null,
    sizeW: size,
    sizeH: size,
    ringColor: null,
    kind,
    vision: { enabled: true, range: 10, dark: 0 },
    light: null,
  };
}

export function makeSceneDoc(width = 64, height = 64): MapDocument {
  const doc = new MapDocument({ grid: grid(width, height), palette: palette(4) });
  doc.setTokenDefs([tokenDef('t1'), tokenDef('t2', 'monster', 2)]);
  doc.flush();
  return doc;
}

export function wall(uid: string, points: Point[], closed = false): WallObject {
  return {
    uid,
    floor: 'f1',
    type: 'wall',
    layer: 'walls',
    geometry: { points, closed },
    props: {
      kind: 'stone',
      thickness: 0.2,
      blocks_vision: true,
      blocks_light: true,
      blocks_move: true,
      texture_asset: null,
      height: null,
    },
    visibility: 'all',
    locked: false,
    sort_order: 0,
    rev: 1,
  };
}

export function door(uid: string, a: Point, b: Point): DoorObject {
  return {
    uid,
    floor: 'f1',
    type: 'door',
    layer: 'walls',
    geometry: { a, b },
    props: {
      state: 'closed',
      locked: false,
      secret: false,
      asset_open: null,
      asset_closed: null,
      swing: 'a',
    },
    visibility: 'all',
    locked: false,
    sort_order: 0,
    rev: 1,
  };
}

export function light(uid: string, x: number, y: number): LightObject {
  return {
    uid,
    floor: 'f1',
    type: 'light',
    layer: 'lighting',
    geometry: { x, y },
    props: {
      radius: 4,
      dim_radius: 8,
      color: '#ffb35c',
      intensity: 0.9,
      flicker: { type: 'torch', amp: 0.2, speed: 2 },
      cone: null,
      enabled: true,
      follows_token: null,
    },
    visibility: 'all',
    locked: false,
    sort_order: 0,
    rev: 1,
  };
}

export function placed(uid: string, x: number, y: number, tokenId = 't1'): PlacedToken {
  return {
    uid,
    floor: 'f1',
    token_id: tokenId,
    x,
    y,
    rotation: 0,
    scale: 1,
    hidden: false,
    light_override: null,
    rev: 1,
  };
}

/** Comparable P5 state (objects, tokens without rev, fog bits, ambient). */
export function sceneSnapshot(doc: MapDocument, withRev = false): unknown {
  const strip = <T extends { rev: number }>(o: T) => {
    if (withRev) return o;
    const { rev: _rev, ...rest } = o;
    return rest;
  };
  const fog: Record<string, string> = {};
  for (const k of [...doc.fogKeys()].sort()) fog[k] = Buffer.from(doc.fogChunk(k)!).toString('hex');
  return {
    objects: doc.objects().map((o: MapObject) => strip(o)),
    tokens: [...doc.tokens()].sort((a, b) => (a.uid < b.uid ? -1 : 1)).map((t) => strip(t)),
    fog,
    ambient: doc.ambient,
  };
}
