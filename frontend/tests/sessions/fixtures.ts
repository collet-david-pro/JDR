import type { MapObject, PlacedToken } from '../../src/editor/contracts';
import type { MapDetail, Token } from '../../src/lib/types';
import type { Session, SessionSnapshot } from '../../src/lib/sessions/types';
import type { WireEvent } from '../../src/lib/realtime/types';

export const door = (uid: string, state: 'open' | 'closed' = 'closed'): MapObject => ({
  uid,
  floor: '35',
  layer: 'walls',
  visibility: 'all',
  locked: false,
  sort_order: 0,
  rev: 1,
  type: 'door',
  geometry: { a: [1, 1], b: [2, 1] },
  props: { state, locked: false, secret: false, asset_open: null, asset_closed: null, swing: 'a' },
});

export const wall = (uid: string): MapObject => ({
  uid,
  floor: '35',
  layer: 'walls',
  visibility: 'all',
  locked: false,
  sort_order: 0,
  rev: 1,
  type: 'wall',
  geometry: {
    points: [
      [0, 0],
      [5, 0],
    ],
    closed: false,
  },
  props: {
    kind: 'stone',
    thickness: 0.2,
    blocks_vision: true,
    blocks_light: true,
    blocks_move: true,
    texture_asset: null,
    height: null,
  },
});

export const placed = (uid: string, tokenId = '21', x = 3, y = 4): PlacedToken => ({
  uid,
  floor: '35',
  token_id: tokenId,
  x,
  y,
  rotation: 0,
  scale: 1,
  hidden: false,
  light_override: null,
  rev: 1,
});

export const definition = (id = '21'): Token =>
  ({
    id,
    game_id: '3',
    name: 'Bob',
    asset_id: null,
    image: null,
    kind: 'pc',
    size_w: 1,
    size_h: 1,
    default_owner_user_id: null,
    vision: { enabled: true, range: 6, dark: 0 },
    light: null,
    ring_color: null,
    created_at: '',
    updated_at: '',
  }) as Token;

export function mapDetail(overrides: Partial<MapDetail> = {}): MapDetail {
  return {
    id: '34',
    game_id: '3',
    name: 'Crypte',
    folder: null,
    sort_order: 0,
    kind: 'battle',
    grid: {
      type: 'square',
      cell_px: 70,
      width: 40,
      height: 30,
      unit_label: 'm',
      unit_per_cell: 1.5,
    },
    thumb_url: null,
    revision: 7,
    updated_at: '',
    deleted_at: null,
    theme: 'parchment',
    ambient: {
      darkness: 0.2,
      tint: null,
      time_of_day: null,
      weather: { type: 'none', intensity: 0 },
    },
    palette: [null],
    layers: [],
    floors: [{ id: '35', level: 0, name: 'RdC', sort_order: 0 }],
    format_version: 1,
    objects: [door('d1'), wall('w1')],
    notes: [],
    tokens_placed: [placed('t1'), placed('t2', '22', 8, 8)],
    ...overrides,
  };
}

export function session(role: 'gm' | 'player', overrides: Partial<Session> = {}): Session {
  return {
    id: '12',
    game_id: '3',
    name: 'Séance 4',
    ...(role === 'gm' ? { code: 'K7F2QM9X' } : {}),
    state: 'running',
    current_map_id: '34',
    current_floor_id: '35',
    camera: null,
    pause_screen: null,
    created_at: '',
    started_at: '',
    ended_at: null,
    players: [
      { user_id: '7', username: 'bob', status: 'connected', ready: true },
      { user_id: '8', username: 'eve', status: 'disconnected', ready: false },
    ],
    assignments: [{ token_id: '21', user_id: '7' }],
    settings: {
      fog_strict: true,
      players_blocked_by_walls: true,
      players_can_move_own_tokens: true,
      players_see_other_pcs: true,
    },
    role,
    last_event_id: '100',
    ...overrides,
  };
}

export function snapshot(
  role: 'gm' | 'player' = 'gm',
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    session: session(role),
    map: mapDetail(),
    tokens: [definition('21'), definition('22')],
    fog: { floor: '35', chunks: [] },
    revealed: [],
    last_event_id: '100',
    ...overrides,
  };
}

export function event(
  id: number,
  type: string,
  payload: unknown,
  channel = 'session:12',
): WireEvent {
  return { id: String(id), channel, type, payload, actor: null, client_op_id: null, at: '' };
}
