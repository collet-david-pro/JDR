import { describe, expect, it } from 'vitest';
import { EVENT_TYPES } from '../../src/lib/realtime/event-types';
import {
  advanceCursor,
  applyEvent,
  applyEvents,
  assignedTo,
  createSessionState,
  ownTokens,
  sessionChannels,
  type SessionState,
} from '../../src/lib/sessions';
import { door, event, placed, snapshot, wall } from './fixtures';

const gm = (): SessionState => createSessionState(snapshot('gm'), '1');
const player = (): SessionState => createSessionState(snapshot('player'), '7');

const covered = new Set<string>();
let next = 101;
function apply(state: SessionState, type: string, payload: unknown, channel = 'session:12') {
  covered.add(type);
  return applyEvent(state, event(next++, type, payload, channel));
}

describe('createSessionState', () => {
  it('splits the snapshot: header, scene by uid, definitions, cursor', () => {
    const s = gm();
    expect(s.lastEventId).toBe('100');
    expect(Object.keys(s.objects)).toEqual(['d1', 'w1']);
    expect(Object.keys(s.tokens)).toEqual(['t1', 't2']);
    expect(Object.keys(s.definitions)).toEqual(['21', '22']);
    expect(s.map).toMatchObject({ id: '34', revision: 7 });
    expect(s.map).not.toHaveProperty('objects');
    expect(s.ambient).toMatchObject({ darkness: 0.2 });
    expect(assignedTo(s, '21')).toBe('7');
    expect(ownTokens(player()).map((t) => t.uid)).toEqual(['t1']);
    expect(ownTokens(s)).toHaveLength(2);
  });

  it('a player without map (lobby): empty scene', () => {
    const s = createSessionState(snapshot('player', { map: null, tokens: [] }), '7');
    expect(s.map).toBeNull();
    expect(s.objects).toEqual({});
  });

  it('channels: the GM also follows the map', () => {
    expect(sessionChannels(gm())).toEqual(['session:12', 'map:34']);
    expect(sessionChannels(player())).toEqual(['session:12']);
  });
});

describe('replay and audiences', () => {
  it('an event already applied (id ≤ cursor, snapshot included) changes nothing', () => {
    const s = gm();
    const e = event(100, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'gm' });
    const r = applyEvent(s, e);
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);
    const once = applyEvent(s, event(101, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'gm' }));
    const twice = applyEvent(
      once.state,
      event(101, 'maptoken.moved', { uid: 't1', x: 1, y: 1, view: 'gm' }),
    );
    expect(twice.state).toBe(once.state);
    expect(once.state.tokens['t1']).toMatchObject({ x: 9, y: 9 });
  });

  it('a GM ignores the player versions (payload.view = player) but moves its cursor', () => {
    const s = gm();
    const r = applyEvent(
      s,
      event(101, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'player' }),
    );
    expect(r.state.tokens).toBe(s.tokens);
    expect(r.state.lastEventId).toBe('101');
    const mine = applyEvent(
      r.state,
      event(102, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'gm' }),
    );
    expect(mine.state.tokens['t1']).toMatchObject({ x: 9 });
  });

  it('a player ignores the gm versions', () => {
    const s = player();
    const r = applyEvent(s, event(101, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'gm' }));
    expect(r.state.tokens['t1']).toMatchObject({ x: 3 });
  });

  it('unknown types and ids only move the cursor; advanceCursor never goes back', () => {
    const s = gm();
    expect(applyEvent(s, event(101, 'future.thing', {})).state.lastEventId).toBe('101');
    expect(advanceCursor(s, '90')).toBe(s);
    expect(advanceCursor(s, '150').lastEventId).toBe('150');
  });

  it('applyEvents folds a batch in order and gathers the effects', () => {
    const r = applyEvents(player(), [
      event(101, 'note.read_aloud', { title: 'A', body: 'a' }),
      event(102, 'note.read_aloud', { title: 'B', body: 'b' }),
    ]);
    expect(r.effects.map((e) => (e.kind === 'read_aloud' ? e.title : ''))).toEqual(['A', 'B']);
    expect(r.state.lastEventId).toBe('102');
  });

  it('is pure: the previous state is never modified', () => {
    const s = gm();
    const frozen = JSON.stringify(s);
    apply(s, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'gm' });
    apply(s, 'door.toggled', { uid: 'd1', state: 'open', view: 'gm' });
    apply(s, 'player.ready', { user_id: '8', ready: true });
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe('session and players', () => {
  it('session.state updates the header; a player entering running reloads (D5)', () => {
    const paused = createSessionState(
      snapshot('player', { session: { ...snapshot('player').session, state: 'paused' } }),
      '7',
    );
    const r = apply(paused, 'session.state', {
      state: 'running',
      current_map_id: '34',
      floor_id: '35',
      pause_screen: null,
    });
    expect(r.state.session.state).toBe('running');
    expect(r.effects).toEqual([{ kind: 'reload.snapshot', reason: 'resumed' }]);
    const lobby = createSessionState(
      snapshot('player', { session: { ...snapshot('player').session, state: 'lobby' }, map: null }),
      '7',
    );
    expect(
      apply(lobby, 'session.state', {
        state: 'running',
        current_map_id: '34',
        floor_id: '35',
        pause_screen: null,
      }).effects,
    ).toEqual([{ kind: 'reload.snapshot', reason: 'started' }]);
    // The GM read the events during the pause: no reload.
    expect(
      apply(gm(), 'session.state', {
        state: 'paused',
        current_map_id: '34',
        floor_id: '35',
        pause_screen: { asset_id: null, text: 'Pause' },
      }).effects,
    ).toEqual([]);
  });

  it('session.state with another map clears the scene and reloads', () => {
    const r = apply(gm(), 'session.state', {
      state: 'running',
      current_map_id: '99',
      floor_id: '1',
      pause_screen: null,
    });
    expect(r.state.session.current_map_id).toBe('99');
    expect(r.state.tokens).toEqual({});
    expect(r.effects).toEqual([{ kind: 'reload.snapshot', reason: 'map_changed' }]);
  });

  it('session.code', () => {
    expect(apply(gm(), 'session.code', { code: 'AAAABBBB' }).state.session.code).toBe('AAAABBBB');
  });

  it('player.joined adds or reconnects, player.left disconnects and clears ready', () => {
    let s = apply(gm(), 'player.joined', { user_id: 9, username: 'zed' }).state;
    expect(s.session.players.at(-1)).toMatchObject({
      user_id: '9',
      username: 'zed',
      status: 'connected',
      ready: false,
    });
    s = apply(s, 'player.joined', { user_id: '8', username: 'eve' }).state;
    expect(s.session.players.find((p) => p.user_id === '8')).toMatchObject({ status: 'connected' });
    s = apply(s, 'player.left', { user_id: '7', username: 'bob' }).state;
    expect(s.session.players.find((p) => p.user_id === '7')).toMatchObject({
      status: 'disconnected',
      ready: false,
    });
    expect(s.session.players).toHaveLength(3);
  });

  it('player.ready', () => {
    const s = apply(gm(), 'player.ready', { user_id: '8', ready: true }).state;
    expect(s.session.players.find((p) => p.user_id === '8')?.ready).toBe(true);
  });

  it('player.kicked marks the user and asks to leave', () => {
    const r = apply(player(), 'player.kicked', { reason: null });
    expect(r.state.kicked).toBe(true);
    expect(r.effects).toEqual([{ kind: 'kicked' }]);
  });

  it('assignment.set updates the list; a player concerned reloads (debt of P6c)', () => {
    const g = apply(gm(), 'assignment.set', { token_id: '22', user_id: '8' });
    expect(g.state.session.assignments).toEqual([
      { token_id: '21', user_id: '7' },
      { token_id: '22', user_id: '8' },
    ]);
    expect(g.effects).toEqual([]);
    const removed = apply(gm(), 'assignment.set', { token_id: 21, user_id: null });
    expect(removed.state.session.assignments).toEqual([]);

    expect(apply(player(), 'assignment.set', { token_id: '21', user_id: null }).effects).toEqual([
      { kind: 'reload.snapshot', reason: 'assignment' },
    ]);
    expect(apply(player(), 'assignment.set', { token_id: '22', user_id: '8' }).effects).toEqual([]);
    const hidden = createSessionState(
      snapshot('player', {
        session: {
          ...snapshot('player').session,
          settings: { ...snapshot('player').session.settings, players_see_other_pcs: false },
        },
      }),
      '7',
    );
    expect(apply(hidden, 'assignment.set', { token_id: '22', user_id: '8' }).effects).toHaveLength(
      1,
    );
  });

  it('map.changed resets ready, clears the scene, asks snapshot (+ preload for a player)', () => {
    const r = apply(player(), 'map.changed', { map_id: 35, floor_id: 40 });
    expect(r.state.session).toMatchObject({ current_map_id: '35', current_floor_id: '40' });
    expect(r.state.session.players.every((p) => !p.ready)).toBe(true);
    expect(r.state.tokens).toEqual({});
    expect(r.effects).toEqual([
      { kind: 'reload.snapshot', reason: 'map_changed' },
      { kind: 'reload.preload' },
    ]);
    expect(apply(gm(), 'map.changed', { map_id: '35', floor_id: '40' }).effects).toEqual([
      { kind: 'reload.snapshot', reason: 'map_changed' },
    ]);
    // The GM's channels follow the map.
    expect(
      sessionChannels(apply(gm(), 'map.changed', { map_id: '35', floor_id: '40' }).state),
    ).toEqual(['session:12', 'map:35']);
  });
});

describe('tokens', () => {
  it('maptoken.moved moves a known token (rotation and floor kept when absent), ignores unknown ones', () => {
    const r = apply(gm(), 'maptoken.moved', {
      uid: 't1',
      x: 5.5,
      y: 6,
      rotation: 90,
      floor: '35',
      view: 'gm',
    });
    expect(r.state.tokens['t1']).toMatchObject({ x: 5.5, y: 6, rotation: 90, rev: 1 });
    const same = apply(r.state, 'maptoken.moved', { uid: 'zz', x: 1, y: 1, view: 'gm' });
    expect(same.state.tokens).toBe(r.state.tokens);
  });

  it('maptoken.added adds the token without the view marker; unknown definition ⇒ reload', () => {
    const known = apply(player(), 'maptoken.added', {
      ...placed('t3', '22', 1, 1),
      view: 'player',
    });
    expect(known.state.tokens['t3']).toEqual(placed('t3', '22', 1, 1));
    expect(known.effects).toEqual([]);
    const unknown = apply(player(), 'maptoken.added', {
      ...placed('t9', '99', 1, 1),
      view: 'player',
    });
    expect(unknown.state.tokens['t9']).toBeDefined();
    expect(unknown.effects).toEqual([{ kind: 'reload.snapshot', reason: 'unknown_token' }]);
  });

  it('maptoken.updated replaces (reveal of a token), maptoken.removed deletes', () => {
    const hidden = createSessionState(
      snapshot('gm', {
        map: { ...snapshot('gm').map!, tokens_placed: [{ ...placed('t1'), hidden: true }] },
      }),
      '1',
    );
    const r = apply(hidden, 'maptoken.updated', {
      ...placed('t1'),
      hidden: false,
      rev: 2,
      view: 'gm',
    });
    expect(r.state.tokens['t1']).toMatchObject({ hidden: false, rev: 2 });
    expect(r.state.tokens['t1']).not.toHaveProperty('view');
    const gone = apply(r.state, 'maptoken.removed', { uid: 't1', view: 'gm' });
    expect(gone.state.tokens).toEqual({});
    expect(apply(gone.state, 'maptoken.removed', { uid: 't1' }).state.tokens).toBe(
      gone.state.tokens,
    );
  });
});

describe('objects, fog, ambient, camera, notes', () => {
  it('door.toggled changes the state once and bumps the revision (idempotent)', () => {
    const r = apply(gm(), 'door.toggled', { uid: 'd1', state: 'open', view: 'gm' });
    expect(r.state.objects['d1']).toMatchObject({ props: { state: 'open' }, rev: 2 });
    const again = apply(r.state, 'door.toggled', { uid: 'd1', state: 'open', view: 'gm' });
    expect(again.state.objects).toBe(r.state.objects);
    expect(apply(gm(), 'door.toggled', { uid: 'w1', state: 'open' }).state.objects).toBeDefined();
  });

  it('light.changed and object.revealed replace the object by uid (a secret door becomes a door)', () => {
    const light = {
      ...wall('l1'),
      type: 'light',
      geometry: { x: 1, y: 1 },
      props: { enabled: true },
      view: 'gm',
    };
    expect(apply(gm(), 'light.changed', light).state.objects['l1']).toMatchObject({
      type: 'light',
    });
    const s = createSessionState(snapshot('player'), '7');
    const revealed = apply(s, 'object.revealed', { ...door('w1'), view: 'player' });
    expect(revealed.state.objects['w1']).toMatchObject({ type: 'door' });
    expect(revealed.state.revealed).toEqual(['w1']);
    expect(revealed.state.objects['w1']).not.toHaveProperty('view');
  });

  it('fog.updated is an effect for the engine, only for the current map', () => {
    const chunks = [[0, 0, 'AAAA']];
    const r = apply(player(), 'fog.updated', {
      map_id: '34',
      floor_id: '35',
      op: 'reveal',
      chunks,
      view: 'player',
    });
    expect(r.effects).toEqual([{ kind: 'fog', mapId: '34', floorId: '35', op: 'reveal', chunks }]);
    expect(
      apply(player(), 'fog.updated', { map_id: '99', floor_id: '35', op: 'hide', chunks }).effects,
    ).toEqual([]);
    expect(
      apply(gm(), 'fog.updated', { map_id: 34, floor_id: 35, op: 'hide', chunks, view: 'gm' })
        .effects,
    ).toMatchObject([{ op: 'hide' }]);
  });

  it('ambient.changed replaces the ambient', () => {
    const ambient = {
      darkness: 0.9,
      tint: '#112233',
      time_of_day: null,
      weather: { type: 'rain', intensity: 0.5 },
    };
    expect(apply(player(), 'ambient.changed', { ambient }).state.ambient).toEqual(ambient);
  });

  it('camera.moved sets the session camera', () => {
    const r = apply(player(), 'camera.moved', {
      x: 10,
      y: 5,
      zoom: 2,
      floor_id: '35',
      follow: true,
    });
    expect(r.state.session.camera).toEqual({ x: 10, y: 5, zoom: 2, floor_id: '35', follow: true });
  });

  it('note.read_aloud and server.notice are effects', () => {
    const note = apply(player(), 'note.read_aloud', { title: 'Lire', body: 'Il fait noir.' });
    expect(note.effects).toMatchObject([
      { kind: 'read_aloud', title: 'Lire', body: 'Il fait noir.' },
    ]);
    const notice = apply(player(), 'server.notice', { kind: 'maintenance', message: 'bientôt' });
    expect(notice.effects).toEqual([{ kind: 'notice', notice: 'maintenance', message: 'bientôt' }]);
  });

  it('display.* events are left to the raw event hook (no state change, no effect)', () => {
    const before = player();
    for (const type of ['display.paired', 'display.updated', 'display.revoked']) {
      const r = apply(before, type, { display_id: '5' });
      expect(r.state.session).toBe(before.session);
      expect(r.state.tokens).toBe(before.tokens);
      expect(r.effects).toEqual([]);
    }
  });
});

describe('map content events', () => {
  const ops = (payload: Record<string, unknown>) => ({ map_id: '34', revision: 8, ...payload });

  it('map.ops.public: objects upsert / remove, chunks to reload, revision', () => {
    const r = apply(
      player(),
      'map.ops.public',
      ops({
        objects: {
          upsert: [{ ...wall('w2'), view: 'player' }, door('d1', 'open')],
          remove: ['w1'],
        },
        chunks: [
          ['35', 1, 2],
          [35, 0, 0],
        ],
        reload: false,
        view: 'player',
      }),
    );
    expect(Object.keys(r.state.objects).sort()).toEqual(['d1', 'w2']);
    expect(r.state.objects['d1']).toMatchObject({ props: { state: 'open' } });
    expect(r.state.objects['w2']).not.toHaveProperty('view');
    expect(r.state.mapRevision).toBe(8);
    expect(r.effects).toEqual([
      {
        kind: 'reload.chunks',
        mapId: '34',
        chunks: [
          { floor: '35', cx: 1, cy: 2 },
          { floor: '35', cx: 0, cy: 0 },
        ],
      },
    ]);
  });

  it('map.ops.public with reload ⇒ reload the snapshot; other map ⇒ ignored', () => {
    const r = apply(
      player(),
      'map.ops.public',
      ops({ objects: { upsert: [], remove: [] }, chunks: [], reload: true, view: 'player' }),
    );
    expect(r.effects).toEqual([{ kind: 'reload.snapshot', reason: 'map_reload' }]);
    const other = apply(player(), 'map.ops.public', {
      map_id: '99',
      revision: 1,
      objects: { upsert: [wall('x')], remove: [] },
      chunks: [],
    });
    expect(other.state.objects['x']).toBeUndefined();
  });

  it('map.ops (GM): applies the object and token ops, asks for the tile blocks and fog', () => {
    const r = apply(
      gm(),
      'map.ops',
      ops({
        ops: [
          { type: 'object.add', object: wall('w3') },
          { type: 'object.update', uid: 'd1', rev: 1, patch: { visibility: 'gm' } },
          { type: 'object.remove', uid: 'w1' },
          { type: 'maptoken.add', token: placed('t5', '22', 2, 2) },
          { type: 'maptoken.update', uid: 't1', rev: 1, patch: { x: 20 } },
          { type: 'maptoken.remove', uid: 't2' },
          {
            type: 'tiles.set',
            floor: '35',
            layer: 'ground',
            cells: [
              [33, 1, 1, 0, 0],
              [34, 2, 1, 0, 0],
              [1, 70, 1, 0, 0],
            ],
          },
          { type: 'fog.reveal', floor: '35', chunks: [[0, 0, 'QQ']] },
          { type: 'map.meta', ambient: { darkness: 0.8, weather: { intensity: 1 } } },
        ],
      }),
      'map:34',
    );
    expect(Object.keys(r.state.objects).sort()).toEqual(['d1', 'w3']);
    expect(r.state.objects['d1']).toMatchObject({ visibility: 'gm', rev: 2 });
    expect(Object.keys(r.state.tokens).sort()).toEqual(['t1', 't5']);
    expect(r.state.tokens['t1']).toMatchObject({ x: 20, rev: 2 });
    expect(r.state.ambient).toMatchObject({
      darkness: 0.8,
      weather: { type: 'none', intensity: 1 },
    });
    expect(r.effects).toEqual([
      { kind: 'fog', mapId: '34', floorId: '35', op: 'reveal', chunks: [[0, 0, 'QQ']] },
      {
        kind: 'reload.chunks',
        mapId: '34',
        chunks: [
          { floor: '35', cx: 1, cy: 0 },
          { floor: '35', cx: 0, cy: 2 },
        ],
      },
    ]);
    expect(r.state.mapRevision).toBe(8);
  });

  it('map.ops: layers / grid / theme / palette changes ask for the snapshot', () => {
    const r = apply(
      gm(),
      'map.ops',
      ops({
        ops: [
          { type: 'map.meta', theme: 'slate' },
          { type: 'palette.add', index: 1, asset_id: '9' },
        ],
      }),
      'map:34',
    );
    expect(r.effects).toEqual([{ kind: 'reload.snapshot', reason: 'map_reload' }]);
  });

  it('fog_strict: a token entering the zone arrives as map.ops.public + maptoken.added, leaving as maptoken.removed', () => {
    let s = player();
    const entering = [
      event(
        101,
        'map.ops.public',
        ops({
          objects: { upsert: [wall('w9')], remove: [] },
          chunks: [['35', 2, 2]],
          reload: false,
          view: 'player',
        }),
      ),
      event(102, 'maptoken.added', { ...placed('t7', '22', 70, 70), view: 'player' }),
    ];
    const r = applyEvents(s, entering);
    expect(r.state.objects['w9']).toBeDefined();
    expect(r.state.tokens['t7']).toBeDefined();
    expect(r.effects).toEqual([
      { kind: 'reload.chunks', mapId: '34', chunks: [{ floor: '35', cx: 2, cy: 2 }] },
    ]);
    s = r.state;
    const leaving = applyEvents(s, [
      event(103, 'maptoken.removed', { uid: 't7', view: 'player' }),
      event(
        104,
        'map.ops.public',
        ops({ objects: { upsert: [], remove: ['w9'] }, chunks: [], reload: false, view: 'player' }),
      ),
    ]);
    expect(leaving.state.tokens['t7']).toBeUndefined();
    expect(leaving.state.objects['w9']).toBeUndefined();
  });
});

describe('catalogue coverage', () => {
  it('every type of the catalogue is exercised by this file', () => {
    expect([...covered].sort()).toEqual([...EVENT_TYPES].sort());
  });
});
