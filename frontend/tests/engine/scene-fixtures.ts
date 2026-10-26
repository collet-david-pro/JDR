/** Small factories of P5 scene values for the engine tests. */
import type {
  DoorObject,
  LightObject,
  PlacedToken,
  TokenDefView,
  WallObject,
  WindowObject,
} from '../../src/editor/contracts';

const common = { floor: '1', visibility: 'all', locked: false, sort_order: 0, rev: 1 } as const;

export function wall(
  uid: string,
  points: [number, number][],
  props: Partial<WallObject['props']> = {},
  extra: Partial<WallObject> = {},
): WallObject {
  return {
    ...common,
    uid,
    layer: 'walls',
    type: 'wall',
    geometry: { points, closed: false },
    props: {
      kind: 'stone',
      thickness: 0.2,
      blocks_vision: true,
      blocks_light: true,
      blocks_move: true,
      texture_asset: null,
      height: null,
      ...props,
    },
    ...extra,
  };
}

export function door(
  uid: string,
  a: [number, number],
  b: [number, number],
  props: Partial<DoorObject['props']> = {},
): DoorObject {
  return {
    ...common,
    uid,
    layer: 'walls',
    type: 'door',
    geometry: { a, b },
    props: {
      state: 'closed',
      locked: false,
      secret: false,
      asset_open: null,
      asset_closed: null,
      swing: 'a',
      ...props,
    },
  };
}

export function windowObj(uid: string): WindowObject {
  return {
    ...common,
    uid,
    layer: 'walls',
    type: 'window',
    geometry: { a: [0, 0], b: [1, 0] },
    props: { kind: 'glass' },
  };
}

export function light(
  uid: string,
  x: number,
  y: number,
  props: Partial<LightObject['props']> = {},
  extra: Partial<LightObject> = {},
): LightObject {
  return {
    ...common,
    uid,
    layer: 'lighting',
    type: 'light',
    geometry: { x, y },
    props: {
      radius: 2,
      dim_radius: 4,
      color: '#ff8800',
      intensity: 1,
      flicker: { type: 'none', amp: 0, speed: 1 },
      cone: null,
      enabled: true,
      follows_token: null,
      ...props,
    },
    ...extra,
  };
}

export function token(
  uid: string,
  x: number,
  y: number,
  extra: Partial<PlacedToken> = {},
): PlacedToken {
  return {
    uid,
    floor: '1',
    token_id: 'def',
    x,
    y,
    rotation: 0,
    scale: 1,
    hidden: false,
    light_override: null,
    rev: 1,
    ...extra,
  };
}

export function tokenDef(extra: Partial<TokenDefView> = {}): TokenDefView {
  return {
    id: 'def',
    name: 'Gobelin archer',
    imageUrl: null,
    sizeW: 1,
    sizeH: 1,
    ringColor: null,
    kind: 'monster',
    vision: { enabled: true, range: 10, dark: 3 },
    light: null,
    ...extra,
  };
}

/** Square polygon (cells) centred on (x, y). */
export function square(x: number, y: number, half: number): Float32Array {
  return new Float32Array([
    x - half,
    y - half,
    x + half,
    y - half,
    x + half,
    y + half,
    x - half,
    y + half,
  ]);
}
