import { describe, expect, it } from 'vitest';
import { applyEvent, createSessionState, type SessionState } from '../../src/lib/sessions';
import { event, placed, session, snapshot } from '../sessions/fixtures';

const make = (role: 'gm' | 'player' | 'display'): SessionState =>
  createSessionState(
    snapshot(role === 'gm' ? 'gm' : 'player', {
      session: { ...session(role === 'gm' ? 'gm' : 'player'), role },
    }),
    role === 'display' ? 'display:1' : '1',
  );

const moved = (id: number, view: string | undefined, x = 9) =>
  event(id, 'maptoken.moved', { uid: 't1', x, y: 9, ...(view === undefined ? {} : { view }) });

describe('audiences of the reducer', () => {
  it('lets the GM ignore the display (and player) versions', () => {
    const gm = make('gm');
    expect(applyEvent(gm, moved(101, 'display')).state.tokens['t1']!.x).toBe(3);
    expect(applyEvent(gm, moved(101, 'player')).state.tokens['t1']!.x).toBe(3);
    expect(applyEvent(gm, moved(101, 'gm')).state.tokens['t1']!.x).toBe(9);
    expect(applyEvent(gm, moved(101, undefined)).state.tokens['t1']!.x).toBe(9);
  });

  it('lets a player ignore the display (and gm) versions', () => {
    const p = make('player');
    expect(applyEvent(p, moved(101, 'display')).state.tokens['t1']!.x).toBe(3);
    expect(applyEvent(p, moved(101, 'gm')).state.tokens['t1']!.x).toBe(3);
    expect(applyEvent(p, moved(101, 'player')).state.tokens['t1']!.x).toBe(9);
  });

  it('applies to a screen only the display version and the events without view', () => {
    const d = make('display');
    expect(applyEvent(d, moved(101, 'player')).state.tokens['t1']!.x).toBe(3);
    expect(applyEvent(d, moved(101, 'gm')).state.tokens['t1']!.x).toBe(3);
    expect(applyEvent(d, moved(101, 'display')).state.tokens['t1']!.x).toBe(9);
    expect(applyEvent(d, moved(101, undefined)).state.tokens['t1']!.x).toBe(9);
    // a filtered event still moves the cursor
    expect(applyEvent(d, moved(105, 'player')).state.lastEventId).toBe('105');
  });

  it('applies a display token added / removed / door / public ops', () => {
    const d = make('display');
    const added = applyEvent(
      d,
      event(101, 'maptoken.added', { ...placed('t9', '21', 1, 1), view: 'display' }),
    );
    expect(added.state.tokens['t9']).toBeDefined();
    expect(added.state.tokens['t9']).not.toHaveProperty('view');
    const removed = applyEvent(
      added.state,
      event(102, 'maptoken.removed', { uid: 't9', view: 'display' }),
    );
    expect(removed.state.tokens['t9']).toBeUndefined();
    const door = applyEvent(
      d,
      event(103, 'door.toggled', { uid: 'd1', state: 'open', view: 'display' }),
    );
    expect(door.state.objects['d1']!.props).toMatchObject({ state: 'open' });
  });

  it('follows the GM camera (camera.moved has no view)', () => {
    const d = make('display');
    const r = applyEvent(
      d,
      event(101, 'camera.moved', { x: 5, y: 6, zoom: 2, floor_id: '35', follow: true }),
    );
    expect(r.state.session.camera).toEqual({ x: 5, y: 6, zoom: 2, floor_id: '35', follow: true });
  });

  it('reloads the snapshot when the session resumes, like a player (no map while paused)', () => {
    const paused = {
      ...make('display'),
      session: { ...make('display').session, state: 'paused' as const },
    };
    const r = applyEvent(
      paused,
      event(101, 'session.state', {
        state: 'running',
        current_map_id: '34',
        floor_id: '35',
        pause_screen: null,
      }),
    );
    expect(r.effects).toEqual([{ kind: 'reload.snapshot', reason: 'resumed' }]);
    // and does not ask a preload when the map changes
    const changed = applyEvent(
      make('display'),
      event(102, 'map.changed', { map_id: '40', floor_id: '41' }),
    );
    expect(changed.effects).toEqual([{ kind: 'reload.snapshot', reason: 'map_changed' }]);
  });
});
