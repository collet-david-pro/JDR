import { describe, expect, it, vi } from 'vitest';
import { encodeFogData } from '../../src/editor/model/fog-wire';
import { createFogBitmap } from '../../src/formats/fog-codec';
import type { SessionEffect } from '../../src/lib/sessions/effects';
import { SceneHost, SessionScene, floorOf } from '../../src/lib/sessions/scene';
import type { TileSource } from '../../src/lib/sessions/scene';
import { createSessionState } from '../../src/lib/sessions/state';
import type { SessionState } from '../../src/lib/sessions/state';
import { definition, door, mapDetail, placed, session, snapshot } from '../sessions/fixtures';

const empty = { records: [], revision: 7 };
function source(): TileSource & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    chunks: vi.fn(async (_id: string, query: unknown) => {
      calls.push(query);
      return empty;
    }),
  } as unknown as TileSource & { calls: unknown[] };
}

const stateOf = (overrides = {}): SessionState =>
  createSessionState(snapshot('gm', overrides), '1');

function fogWire(cx = 0, cy = 0) {
  const bits = createFogBitmap();
  bits[0] = 0x80;
  return [cx, cy, encodeFogData(bits)] as const;
}

describe('floorOf', () => {
  it('uses the session floor, then the first floor, null without map', () => {
    expect(floorOf(stateOf())).toBe('35');
    const noFloor = stateOf();
    expect(floorOf({ ...noFloor, session: { ...noFloor.session, current_floor_id: null } })).toBe(
      '35',
    );
    expect(floorOf(stateOf({ map: null }))).toBeNull();
  });
});

describe('SessionScene', () => {
  it('shows the objects, tokens, definitions and ambient of the state', () => {
    const scene = new SessionScene(stateOf(), '35');
    const doc = scene.doc;
    expect(doc.grid.width).toBe(40);
    expect(doc.floor).toBe('35');
    expect(doc.object('d1')?.type).toBe('door');
    expect(
      doc
        .tokens()
        .map((t) => t.uid)
        .sort(),
    ).toEqual(['t1', 't2']);
    expect(doc.tokenDef('21')?.name).toBe('Bob');
    expect(doc.ambient.darkness).toBeCloseTo(0.2);
  });

  it('applies the differences of a new state (by identity)', () => {
    const state = stateOf();
    const scene = new SessionScene(state, '35');
    const events: unknown[] = [];
    scene.doc.onSceneChanged((e) => events.push(e));
    const moved = { ...state.tokens['t1']!, x: 9, y: 9 };
    const objects = { ...state.objects, d1: door('d1', 'open') };
    const { t2: _removed, ...rest } = state.tokens;
    scene.sync({
      ...state,
      tokens: { ...rest, t1: moved },
      objects,
      ambient: {
        darkness: 0.9,
        tint: '#112233',
        time_of_day: null,
        weather: { type: 'rain', intensity: 0.5 },
      },
    });
    expect(scene.doc.token('t1')?.x).toBe(9);
    expect(scene.doc.token('t2')).toBeUndefined();
    const d = scene.doc.object('d1');
    expect(d?.type === 'door' && d.props.state).toBe('open');
    expect(scene.doc.ambient.darkness).toBeCloseTo(0.9);
    expect(scene.doc.ambient.weather.type).toBe('rain');
    return Promise.resolve().then(() => expect(events.length).toBeGreaterThan(0));
  });

  it('ignores the objects and tokens of other floors', () => {
    const state = stateOf();
    const scene = new SessionScene(state, '35');
    const other = { ...placed('t9'), floor: '99' };
    scene.sync({ ...state, tokens: { ...state.tokens, t9: other } });
    expect(scene.doc.token('t9')).toBeUndefined();
  });

  it('keeps the drag preview until release, then follows the state', () => {
    const state = stateOf();
    const scene = new SessionScene(state, '35');
    scene.preview('t1', 5, 5);
    expect(scene.doc.token('t1')?.x).toBe(5);
    const server = { ...state.tokens['t1']!, x: 1, y: 1 };
    const next = { ...state, tokens: { ...state.tokens, t1: server } };
    scene.sync(next);
    expect(scene.doc.token('t1')?.x).toBe(5);
    scene.release('t1');
    scene.sync({ ...next, tokens: { ...next.tokens, t1: { ...server, x: 2, y: 2 } } });
    expect(scene.doc.token('t1')?.x).toBe(2);
  });

  it('matches the same map, floor and revision only', () => {
    const state = stateOf();
    const scene = new SessionScene(state, '35');
    expect(scene.matches(state, '35')).toBe(true);
    expect(scene.matches(state, '36')).toBe(false);
    expect(scene.matches(stateOf({ map: mapDetail({ id: '99' }) }), '35')).toBe(false);
    expect(scene.matches(stateOf({ map: mapDetail({ revision: 8 }) }), '35')).toBe(false);
  });

  it('loads the tiles of the floor and reloads the blocks of an effect', async () => {
    const src = source();
    const scene = new SessionScene(stateOf(), '35');
    const result = await scene.loadTiles(src);
    expect(result.errors).toBe(0);
    expect(src.calls[0]).toMatchObject({ floor: '35' });
    await scene.reloadChunks(src, [
      { floor: '35', cx: 0, cy: 1 },
      { floor: '36', cx: 5, cy: 5 },
    ]);
    expect(src.calls.at(-1)).toMatchObject({ floor: '35', cells: ['0:1'] });
    const before = src.calls.length;
    await scene.reloadChunks(src, [{ floor: '36', cx: 0, cy: 0 }]);
    expect(src.calls.length).toBe(before);
  });

  it('imports the snapshot fog, then reveals and hides bits', () => {
    const scene = new SessionScene(stateOf(), '35');
    scene.importFog({ floor: '35', chunks: [fogWire(0, 0)] });
    expect(scene.doc.fogChunk('0:0')?.[0]).toBe(0x80);
    scene.importFog({ floor: '36', chunks: [fogWire(1, 1)] });
    expect(scene.doc.fogChunk('1:1')).toBeNull();
    scene.applyFog('reveal', [fogWire(1, 0)]);
    expect(scene.doc.fogChunk('1:0')?.[0]).toBe(0x80);
    scene.applyFog('hide', [fogWire(1, 0)]);
    expect(scene.doc.fogChunk('1:0')).toBeNull();
    scene.importFog({ floor: '35', chunks: [] });
    expect(scene.doc.fogKeys()).toHaveLength(0);
  });

  it('applies fog effects of its map and floor only', () => {
    const src = source();
    const scene = new SessionScene(stateOf(), '35');
    const fog = (mapId: string, floorId: string): SessionEffect => ({
      kind: 'fog',
      mapId,
      floorId,
      op: 'reveal',
      chunks: [fogWire(0, 0)],
    });
    scene.applyEffect(fog('99', '35'), src);
    scene.applyEffect(fog('34', '36'), src);
    expect(scene.doc.fogKeys()).toHaveLength(0);
    scene.applyEffect(fog('34', '35'), src);
    expect(scene.doc.fogKeys()).toEqual(['0:0']);
  });
});

describe('SceneHost', () => {
  function make() {
    const src = source();
    const scenes: (SessionScene | null)[] = [];
    const host = new SceneHost({ source: src, onScene: (s) => scenes.push(s) });
    return { host, scenes, src };
  }

  it('creates a scene, keeps it for the same map and replaces it for another', async () => {
    const { host, scenes } = make();
    const state = stateOf();
    host.update(state);
    expect(scenes).toHaveLength(1);
    const first = host.scene!;
    host.update({ ...state, tokens: { ...state.tokens, t1: { ...state.tokens['t1']!, x: 7 } } });
    expect(scenes).toHaveLength(1);
    expect(first.doc.token('t1')?.x).toBe(7);
    const other = stateOf({ map: mapDetail({ id: '50', revision: 1 }) });
    host.update({ ...other, session: { ...other.session, current_map_id: '50' } });
    expect(scenes).toHaveLength(2);
    expect(host.scene).not.toBe(first);
    host.update({ ...state, map: null });
    expect(scenes.at(-1)).toBeNull();
    host.dispose();
  });

  it('injects the fog of the snapshots it saw through wrapApi', async () => {
    const { host } = make();
    const snap = snapshot('gm', { fog: { floor: '35', chunks: [fogWire(0, 0)] } });
    const api = host.wrapApi({
      snapshot: async () => snap,
      get: async () => snap.session,
      presence: async () => undefined,
      actions: async () => ({ results: [], last_event_id: '1' }),
    });
    await api.snapshot('12');
    host.update(createSessionState(snap, '1'));
    expect(host.scene?.doc.fogKeys()).toEqual(['0:0']);
    // A later snapshot replaces the fog of the kept scene.
    const later = snapshot('gm', { fog: { floor: '35', chunks: [fogWire(1, 0)] } });
    host.noteSnapshot(later);
    host.update(createSessionState(later, '1'));
    expect(host.scene?.doc.fogKeys()).toEqual(['1:0']);
  });

  it('sends reload.chunks effects to the scene', async () => {
    const { host, src } = make();
    host.update(stateOf());
    await Promise.resolve();
    const before = src.calls.length;
    host.effect({
      kind: 'reload.chunks',
      mapId: '34',
      chunks: [{ floor: '35', cx: 1, cy: 1 }],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(src.calls.length).toBe(before + 1);
    host.dispose();
  });
});

describe('fixtures sanity', () => {
  it('keeps the session role', () => {
    expect(session('gm').role).toBe('gm');
    expect(definition().name).toBe('Bob');
  });
});
