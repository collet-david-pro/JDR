import { describe, expect, it } from 'vitest';
import { applyEvent, createSessionState, type SessionState } from '../../src/lib/sessions';
import { applyMapOps } from '../../src/lib/sessions/scene-ops';
import { event, mapDetail, snapshot } from './fixtures';

const gm = (): SessionState => createSessionState(snapshot('gm'), '1');
const player = (): SessionState => createSessionState(snapshot('player'), '7');
let next = 300;
const apply = (s: SessionState, type: string, payload: unknown) =>
  applyEvent(s, event(next++, type, payload));

describe('map.changed on the same map (a floor change)', () => {
  it('keeps the scene and the ready flags, asks the snapshot, no preload', () => {
    const s = player();
    const r = apply(s, 'map.changed', { map_id: 34, floor_id: 36 });
    // The floor is taken from the snapshot, the scene stays meanwhile.
    expect(r.state.map).toBe(s.map);
    expect(r.state.objects).toBe(s.objects);
    expect(r.state.session.current_floor_id).toBe(s.session.current_floor_id);
    expect(r.state.session.players).toEqual(s.session.players);
    expect(r.effects).toEqual([{ kind: 'reload.snapshot', reason: 'map_changed' }]);
    expect(apply(gm(), 'map.changed', { map_id: '34', floor_id: '36' }).effects).toEqual([
      { kind: 'reload.snapshot', reason: 'map_changed' },
    ]);
  });

  it('another map still resets everything and makes the players preload', () => {
    const r = apply(player(), 'map.changed', { map_id: 99, floor_id: null });
    expect(r.state.map).toBeNull();
    expect(r.state.session.players.every((p) => !p.ready)).toBe(true);
    expect(r.effects).toEqual([
      { kind: 'reload.snapshot', reason: 'map_changed' },
      { kind: 'reload.preload' },
    ]);
  });

  it('the camera moved right after is kept for the snapshot to come', () => {
    const changed = apply(player(), 'map.changed', { map_id: 99, floor_id: 40 }).state;
    const r = apply(changed, 'camera.moved', { x: 12, y: 8, zoom: 1, floor_id: 40, follow: false });
    expect(r.state.session.camera).toEqual({ x: 12, y: 8, zoom: 1, floor_id: '40', follow: false });
  });
});

describe('map.ops with floor ops (GM replica)', () => {
  const s = createSessionState(
    snapshot('gm', {
      map: mapDetail({
        floors: [
          { id: '35', uid: 'f1', level: 0, name: 'RdC', sort_order: 0 },
          { id: '36', uid: 'f2', level: 1, name: 'Étage', sort_order: 1 },
        ],
      }),
    }),
    '1',
  );

  it('reads the snapshot again when the floors change', () => {
    for (const op of [
      { type: 'floor.add', floor: { uid: 'x', name: 'X', level: 4 } },
      { type: 'floor.update', uid: 'f2', patch: { name: 'Haut' } },
      { type: 'floor.remove', uid: 'f2' },
    ] as const) {
      expect(applyMapOps(s, '34', [op]).effects).toEqual([
        { kind: 'reload.snapshot', reason: 'map_reload' },
      ]);
    }
  });

  it('stores the floor id when an op designates the floor by uid', () => {
    const r = applyMapOps(s, '34', [
      {
        type: 'maptoken.add',
        token: {
          uid: 'k',
          floor: 'f2',
          token_id: '21',
          x: 1,
          y: 1,
          rotation: 0,
          scale: 1,
          hidden: false,
          light_override: null,
          rev: 1,
        },
      },
      { type: 'tiles.set', floor: 'f2', layer: 'ground', cells: [[1, 1, 1, 0, 0]] },
    ]);
    expect(r.tokens['k']?.floor).toBe('36');
    expect(r.effects).toEqual([
      { kind: 'reload.chunks', mapId: '34', chunks: [{ floor: '36', cx: 0, cy: 0 }] },
    ]);
  });
});
