import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../src/editor/contracts';
import type {
  PlayerNote,
  MapNote,
  SecretObject,
  TrapObject,
} from '../../src/editor/contracts-notes';
import { applyEvent, createSessionState, type SessionState } from '../../src/lib/sessions';
import { applyMapOps } from '../../src/lib/sessions/scene-ops';
import { SessionScene } from '../../src/lib/sessions/scene';
import { isOccluderObject } from '../../src/vision/core';
import { rawPieces } from '../../src/vision/occluders';
import { shadowSegments } from '../../src/engine/scene/shadows';
import { event, snapshot } from './fixtures';

const gm = (): SessionState => createSessionState(snapshot('gm'), '1');
const player = (): SessionState => createSessionState(snapshot('player'), '7');
let n = 500;
const ev = (s: SessionState, type: string, payload: unknown) =>
  applyEvent(s, event(n++, type, payload, 'session:12'));

const pnote: PlayerNote = { uid: 'n1', title: 'Hello', body: 'Body', asset_id: null };
const mnote: MapNote = {
  ...pnote,
  audience: 'gm',
  audience_users: [],
  read_aloud: false,
};

const base = { floor: '35', layer: 'walls', locked: false, sort_order: 0, rev: 1 } as const;
const passage = (props: Partial<SecretObject['props']> = {}): SecretObject => ({
  ...base,
  uid: 's1',
  visibility: 'hidden_until_revealed',
  type: 'secret',
  geometry: { a: [1, 1], b: [3, 1] },
  props: { kind: 'passage', note: null, ...props },
});
const trap = (effect: 'pulse' | 'none' = 'pulse'): TrapObject => ({
  ...base,
  layer: 'props',
  uid: 'tr1',
  visibility: 'hidden_until_revealed',
  type: 'trap',
  geometry: { x: 2, y: 2 },
  props: { note: null, reveal_effect: effect },
});

describe('note events', () => {
  it('note.shared adds then replaces, without the view tag', () => {
    const a = ev(player(), 'note.shared', { note: pnote, view: 'player' });
    expect(a.state.notes['n1']).toEqual(pnote);
    const b = ev(a.state, 'note.shared', { note: { ...pnote, body: 'New' }, view: 'player' });
    expect(b.state.notes['n1']).toMatchObject({ body: 'New' });
  });
  it('note.hidden removes; unknown uid changes nothing', () => {
    const a = ev(player(), 'note.shared', { note: pnote, view: 'player' });
    const b = ev(a.state, 'note.hidden', { uid: 'n1', view: 'player' });
    expect(b.state.notes).toEqual({});
    expect(ev(b.state, 'note.hidden', { uid: 'zz', view: 'player' }).state.notes).toEqual({});
  });
  it('audience of the version: a player ignores the gm one, the gm the player one', () => {
    expect(ev(player(), 'note.shared', { note: mnote, view: 'gm' }).state.notes).toEqual({});
    expect(ev(gm(), 'note.shared', { note: pnote, view: 'player' }).state.notes).toEqual({});
    expect(ev(gm(), 'note.shared', { note: mnote, view: 'gm' }).state.notes['n1']).toEqual(mnote);
  });
  it('zone.entered gives a suggestion to the GM only', () => {
    const p = { zone_uid: 'z1', note_uid: 'n1', title: 'T', token_uid: 't1', view: 'gm' };
    expect(ev(gm(), 'zone.entered', p).effects).toEqual([
      { kind: 'zone.suggest', zoneUid: 'z1', noteUid: 'n1', title: 'T' },
    ]);
    expect(ev(player(), 'zone.entered', p).effects).toEqual([]);
  });
  it('a revealed trap with the pulse effect asks for a pulse', () => {
    const r = ev(player(), 'object.revealed', { ...trap(), view: 'player' });
    expect(r.effects).toEqual([{ kind: 'trap.pulse', uid: 'tr1' }]);
    expect(r.state.revealed).toContain('tr1');
    expect(ev(player(), 'object.revealed', { ...trap('none'), view: 'player' }).effects).toEqual(
      [],
    );
  });
});

describe('scene ops of the notes', () => {
  it('note.add, update, remove', () => {
    let s = gm();
    const add = applyMapOps(s, '1', [
      {
        type: 'note.add',
        note: { uid: 'n2', title: 'A', body: 'b', audience: 'players', audience_users: ['7'] },
      },
    ]);
    expect(add.notes['n2']).toMatchObject({ audience: 'players', audience_users: ['7'] });
    s = { ...s, notes: add.notes };
    const upd = applyMapOps(s, '1', [
      { type: 'note.update', uid: 'n2', patch: { title: 'B', audience: 'all' } },
    ]);
    expect(upd.notes['n2']).toMatchObject({ title: 'B', audience: 'all', audience_users: [] });
    const rm = applyMapOps({ ...s, notes: upd.notes }, '1', [{ type: 'note.remove', uid: 'n2' }]);
    expect(rm.notes).toEqual({});
  });
  it('secrets.reset forgets revealed traps and secrets only', () => {
    const s: SessionState = {
      ...gm(),
      objects: { s1: passage(), tr1: trap() } as Record<string, MapObject>,
      revealed: ['s1', 'tr1', 'd1'],
    };
    expect(applyMapOps(s, '1', [{ type: 'secrets.reset' }]).revealed).toEqual(['d1']);
  });
});

describe('revealed objects in the player scene', () => {
  const sceneOf = (role: 'gm' | 'player', objects: MapObject[]): SessionScene => {
    const s = createSessionState(snapshot(role), '7');
    return new SessionScene(
      { ...s, objects: Object.fromEntries(objects.map((o) => [o.uid, o])) },
      '35',
    );
  };
  it('a player gets a visible, open passage and a visible trap; the GM keeps them as they are', () => {
    const p = sceneOf('player', [passage(), trap()]);
    expect(p.doc.object('s1')).toMatchObject({ visibility: 'all', props: { revealed: true } });
    expect(p.doc.object('tr1')).toMatchObject({ visibility: 'all' });
    const g = sceneOf('gm', [passage()]);
    expect(g.doc.object('s1')).toMatchObject({ visibility: 'hidden_until_revealed' });
  });
  it('wall to revealed passage and back at the same uid', () => {
    const state = player();
    const w = { ...(passage() as object), type: 'wall' } as unknown as MapObject;
    const wallObj: MapObject = {
      ...base,
      uid: 's1',
      visibility: 'all',
      type: 'wall',
      geometry: {
        points: [
          [1, 1],
          [3, 1],
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
    };
    void w;
    const scene = new SessionScene({ ...state, objects: { s1: wallObj } }, '35');
    expect(scene.doc.object('s1')?.type).toBe('wall');
    scene.sync({ ...state, objects: { s1: passage() } });
    expect(scene.doc.object('s1')?.type).toBe('secret');
    scene.sync({ ...state, objects: { s1: wallObj } });
    expect(scene.doc.object('s1')?.type).toBe('wall');
  });
  it('a revealed passage is no occluder, casts no shadow and blocks nothing', () => {
    const closed = passage();
    const open = passage({ revealed: true });
    const lit = { ...open, visibility: 'all' } as MapObject;
    expect(isOccluderObject(closed)).toBe(true);
    expect(isOccluderObject(lit)).toBe(false);
    expect(rawPieces([closed], 'player')).toHaveLength(1);
    expect(rawPieces([lit], 'player')).toHaveLength(0);
    expect(shadowSegments([closed], 'player')).toHaveLength(1);
    expect(shadowSegments([lit], 'player')).toHaveLength(0);
  });
});
