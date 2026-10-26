/**
 * `applyEvent(state, event)`: pure reducer of the session events (etapes/P06 catalogue, "P6c
 * terminé" for the payloads). Returns the next state and the effects the UI / SessionSync must
 * perform (snapshot, tile blocks, fog bits, text to read...). No network, no clock, no mutation.
 *
 * Rules:
 * - an event whose id is ≤ `state.lastEventId` was already applied (or is in the snapshot):
 *   nothing changes (same state object, no effect) ⇒ replays are harmless;
 * - a GM reads every audience: events tagged `payload.view === "player"` are ignored (and the
 *   GM never receives "gm" ones from a player's point of view, ignored too);
 * - unknown types only move the cursor.
 */
import type { MapObject, PlacedToken } from '../../editor/contracts';
import type { WireEvent } from '../realtime/types';
import { compareIds, isEventId } from '../realtime/util';
import { NO_EFFECTS, type SessionEffect } from './effects';
import type {
  AmbientPayload,
  AssignmentPayload,
  CameraPayload,
  DoorToggledPayload,
  FogUpdatedPayload,
  MapChangedPayload,
  MapOpsPayload,
  MapOpsPublicPayload,
  NoticePayload,
  NotePayload,
  ReadyPayload,
  SessionStatePayload,
  TokenMovedPayload,
  UserPayload,
} from './event-payloads';
import { applyMapOps } from './scene-ops';
import type { SessionState } from './state';
import type { Session, SessionPlayer } from './types';

export interface Reduction {
  readonly state: SessionState;
  readonly effects: readonly SessionEffect[];
}

type Handler = (s: SessionState, e: WireEvent, p: Record<string, unknown>) => Reduction | null;

const same = (state: SessionState): Reduction => ({ state, effects: NO_EFFECTS });
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
const withSession = (s: SessionState, patch: Partial<Session>): SessionState => ({
  ...s,
  session: { ...s.session, ...patch },
});
const reload = (
  reason: 'started' | 'resumed' | 'map_changed' | 'map_reload' | 'unknown_token' | 'assignment',
) => ({ kind: 'reload.snapshot', reason }) as const;

/** Moves the cursor without changing anything else (events of no interest, other audience). */
export function advanceCursor(state: SessionState, id: string): SessionState {
  return isEventId(id) && compareIds(id, state.lastEventId) > 0
    ? { ...state, lastEventId: id }
    : state;
}

export function applyEvent(state: SessionState, e: WireEvent): Reduction {
  if (!isEventId(e.id) || compareIds(e.id, state.lastEventId) <= 0) return same(state);
  const p = rec(e.payload);
  const view = p['view'];
  const foreign = state.role === 'gm' ? view === 'player' : view === 'gm';
  const handler = foreign ? undefined : HANDLERS[e.type];
  const out = handler?.(state, e, p) ?? same(state);
  return { state: { ...out.state, lastEventId: e.id }, effects: out.effects };
}

/** Applies a batch in order; the effects are concatenated. */
export function applyEvents(state: SessionState, events: readonly WireEvent[]): Reduction {
  let current = state;
  const effects: SessionEffect[] = [];
  for (const e of events) {
    const r = applyEvent(current, e);
    current = r.state;
    effects.push(...r.effects);
  }
  return { state: current, effects: effects.length === 0 ? NO_EFFECTS : effects };
}

// ---- session / players -------------------------------------------------------------------------

const onState: Handler = (s, _e, p) => {
  const x = p as unknown as SessionStatePayload;
  const map = str(x.current_map_id);
  const floor = str(x.floor_id);
  const mapChanged = map !== s.session.current_map_id;
  let state = withSession(s, {
    state: x.state,
    current_map_id: map,
    current_floor_id: floor,
    pause_screen: x.pause_screen ?? null,
  });
  const effects: SessionEffect[] = [];
  const entersRunning = x.state === 'running' && s.session.state !== 'running';
  // D5: a player was cut off from the map events while paused (and had no map in the lobby).
  if (s.role === 'player' && entersRunning) {
    effects.push(reload(s.session.state === 'paused' ? 'resumed' : 'started'));
  } else if (mapChanged && x.state !== 'ended') {
    effects.push(reload('map_changed'));
  }
  if (mapChanged)
    state = { ...state, map: null, mapRevision: null, objects: {}, tokens: {}, revealed: [] };
  return { state, effects };
};

const onCode: Handler = (s, _e, p) =>
  typeof p['code'] === 'string' ? same(withSession(s, { code: p['code'] })) : null;

const upsertPlayer = (
  s: SessionState,
  userId: string,
  patch: (old: SessionPlayer | undefined) => SessionPlayer,
): SessionState => {
  const players = s.session.players;
  const i = players.findIndex((x) => x.user_id === userId);
  const list = [...players];
  if (i >= 0) list[i] = patch(players[i]);
  else list.push(patch(undefined));
  return withSession(s, { players: list });
};

const onJoined: Handler = (s, _e, p) => {
  const x = p as unknown as UserPayload;
  const id = str(x.user_id);
  if (id === null) return null;
  return same(
    upsertPlayer(s, id, (old) => ({
      user_id: id,
      username: str(x.username) ?? old?.username ?? '',
      status: old?.status === 'kicked' ? 'kicked' : 'connected',
      ready: old?.ready ?? false,
    })),
  );
};

const onLeft: Handler = (s, _e, p) => {
  const id = str((p as unknown as UserPayload).user_id);
  if (id === null) return null;
  if (!s.session.players.some((x) => x.user_id === id)) return null;
  return same(
    upsertPlayer(s, id, (old) => ({
      user_id: id,
      username: old?.username ?? '',
      status: old?.status === 'kicked' ? 'kicked' : 'disconnected',
      ready: false,
    })),
  );
};

const onReady: Handler = (s, _e, p) => {
  const x = p as unknown as ReadyPayload;
  const id = str(x.user_id);
  if (id === null) return null;
  return same(
    upsertPlayer(s, id, (old) => ({
      user_id: id,
      username: old?.username ?? '',
      status: old?.status ?? 'connected',
      ready: x.ready === true,
    })),
  );
};

const onKicked: Handler = (s) => ({
  state: { ...s, kicked: true },
  effects: [{ kind: 'kicked' }],
});

const onAssignment: Handler = (s, _e, p) => {
  const x = p as unknown as AssignmentPayload;
  const tokenId = str(x.token_id);
  if (tokenId === null) return null;
  const userId = str(x.user_id);
  const before = s.session.assignments.find((a) => a.token_id === tokenId)?.user_id ?? null;
  const rest = s.session.assignments.filter((a) => a.token_id !== tokenId);
  const assignments = userId === null ? rest : [...rest, { token_id: tokenId, user_id: userId }];
  const state = withSession(s, { assignments });
  // Debt of P6c: no event pushes the zone a token gives (fog_strict, other PCs hidden), so a
  // player whose own tokens changed - or who does not see the other PCs - reloads.
  const concerned = before === s.me || userId === s.me || !s.session.settings.players_see_other_pcs;
  return { state, effects: s.role === 'player' && concerned ? [reload('assignment')] : NO_EFFECTS };
};

const onMapChanged: Handler = (s, _e, p) => {
  const x = p as unknown as MapChangedPayload;
  const map = str(x.map_id);
  if (map === null) return null;
  const state: SessionState = {
    ...withSession(s, {
      current_map_id: map,
      current_floor_id: str(x.floor_id),
      players: s.session.players.map((pl) => (pl.ready ? { ...pl, ready: false } : pl)),
    }),
    map: null,
    mapRevision: null,
    objects: {},
    tokens: {},
    revealed: [],
  };
  const effects: SessionEffect[] = [reload('map_changed')];
  if (s.role === 'player') effects.push({ kind: 'reload.preload' });
  return { state, effects };
};

// ---- tokens ------------------------------------------------------------------------------------

const withoutView = <T extends object>(payload: T): Omit<T, 'view'> => {
  const { view: _view, ...rest } = payload as T & { view?: unknown };
  return rest;
};

const onTokenMoved: Handler = (s, _e, p) => {
  const x = p as unknown as TokenMovedPayload;
  const current = s.tokens[x.uid];
  if (current === undefined) return null;
  const moved: PlacedToken = {
    ...current,
    x: x.x,
    y: x.y,
    rotation: x.rotation ?? current.rotation,
    floor: x.floor ?? current.floor,
  };
  return same({ ...s, tokens: { ...s.tokens, [x.uid]: moved } });
};

const onTokenSet: Handler = (s, _e, p) => {
  const token = withoutView(p) as unknown as PlacedToken;
  if (typeof token.uid !== 'string') return null;
  const state = { ...s, tokens: { ...s.tokens, [token.uid]: token } };
  const unknown = s.definitions[token.token_id] === undefined;
  return { state, effects: unknown ? [reload('unknown_token')] : NO_EFFECTS };
};

const onTokenRemoved: Handler = (s, _e, p) => {
  const uid = str(p['uid']);
  if (uid === null || !(uid in s.tokens)) return null;
  const tokens = { ...s.tokens };
  delete tokens[uid];
  return same({ ...s, tokens });
};

// ---- objects, fog, ambient -----------------------------------------------------------------------

const onDoor: Handler = (s, _e, p) => {
  const x = p as unknown as DoorToggledPayload;
  const current = s.objects[x.uid];
  if (current?.type !== 'door' || current.props.state === x.state) return null;
  const door: MapObject = {
    ...current,
    props: { ...current.props, state: x.state },
    rev: current.rev + 1,
  };
  return same({ ...s, objects: { ...s.objects, [x.uid]: door } });
};

const onObject: Handler = (s, _e, p) => {
  const object = withoutView(p) as unknown as MapObject;
  if (typeof object.uid !== 'string') return null;
  return same({ ...s, objects: { ...s.objects, [object.uid]: object } });
};

const onRevealed: Handler = (s, e, p) => {
  const r = onObject(s, e, p);
  const uid = str(p['uid']);
  if (r === null || uid === null || s.revealed.includes(uid)) return r;
  return same({ ...r.state, revealed: [...s.revealed, uid] });
};

const onFog: Handler = (s, _e, p) => {
  const x = p as unknown as FogUpdatedPayload;
  if (str(x.map_id) !== s.session.current_map_id || !Array.isArray(x.chunks)) return null;
  const floorId = str(x.floor_id);
  if (floorId === null) return null;
  return {
    state: s,
    effects: [
      {
        kind: 'fog',
        mapId: str(x.map_id) ?? '',
        floorId,
        op: x.op === 'hide' ? 'hide' : 'reveal',
        chunks: x.chunks,
      },
    ],
  };
};

const onAmbient: Handler = (s, _e, p) => {
  const ambient = (p as unknown as AmbientPayload).ambient;
  return typeof ambient === 'object' && ambient !== null ? same({ ...s, ambient }) : null;
};

const onCamera: Handler = (s, _e, p) => {
  const x = p as unknown as CameraPayload;
  if (typeof x.x !== 'number' || typeof x.y !== 'number') return null;
  const camera = {
    x: x.x,
    y: x.y,
    zoom: typeof x.zoom === 'number' ? x.zoom : 1,
    floor_id: str(x.floor_id),
    follow: x.follow !== false,
  };
  return same(withSession(s, { camera }));
};

const onNote: Handler = (s, e, p) => {
  const x = p as unknown as NotePayload;
  return {
    state: s,
    effects: [
      { kind: 'read_aloud', eventId: e.id, title: str(x.title) ?? '', body: str(x.body) ?? '' },
    ],
  };
};

const onNotice: Handler = (s, _e, p) => {
  const x = p as unknown as NoticePayload;
  return {
    state: s,
    effects: [{ kind: 'notice', notice: str(x.kind) ?? '', message: str(x.message) ?? '' }],
  };
};

// ---- map content ops -----------------------------------------------------------------------------

const onMapOps: Handler = (s, _e, p) => {
  const x = p as unknown as MapOpsPayload;
  const mapId = str(x.map_id);
  if (mapId === null || mapId !== s.session.current_map_id || !Array.isArray(x.ops)) return null;
  const r = applyMapOps(s, mapId, x.ops);
  return {
    state: {
      ...s,
      objects: r.objects,
      tokens: r.tokens,
      ambient: r.ambient,
      mapRevision: x.revision,
    },
    effects: r.effects,
  };
};

const onOpsPublic: Handler = (s, _e, p) => {
  const x = p as unknown as MapOpsPublicPayload;
  const mapId = str(x.map_id);
  if (mapId === null || mapId !== s.session.current_map_id) return null;
  let objects = s.objects;
  const upsert = x.objects?.upsert ?? [];
  const remove = x.objects?.remove ?? [];
  if (upsert.length > 0 || remove.length > 0) {
    const copy = { ...objects } as Record<string, MapObject>;
    for (const o of upsert) copy[o.uid] = withoutView(o) as MapObject;
    for (const uid of remove) delete copy[uid];
    objects = copy;
  }
  const effects: SessionEffect[] = [];
  const chunks = (x.chunks ?? []).map(([floor, cx, cy]) => ({ floor: String(floor), cx, cy }));
  if (chunks.length > 0) effects.push({ kind: 'reload.chunks', mapId, chunks });
  if (x.reload === true) effects.push(reload('map_reload'));
  return { state: { ...s, objects, mapRevision: x.revision }, effects };
};

const HANDLERS: Readonly<Record<string, Handler>> = {
  'session.state': onState,
  'session.code': onCode,
  'player.joined': onJoined,
  'player.left': onLeft,
  'player.ready': onReady,
  'player.kicked': onKicked,
  'assignment.set': onAssignment,
  'map.changed': onMapChanged,
  'maptoken.moved': onTokenMoved,
  'maptoken.added': onTokenSet,
  'maptoken.updated': onTokenSet,
  'maptoken.removed': onTokenRemoved,
  'door.toggled': onDoor,
  'object.revealed': onRevealed,
  'fog.updated': onFog,
  'light.changed': onObject,
  'ambient.changed': onAmbient,
  'camera.moved': onCamera,
  'note.read_aloud': onNote,
  'map.ops': onMapOps,
  'map.ops.public': onOpsPublic,
  'server.notice': onNotice,
};
