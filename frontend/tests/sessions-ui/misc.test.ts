import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api';
import { fogActionsFor, rectRaster } from '../../src/lib/sessions/console/fog-actions';
import {
  addTokenOp,
  hideTokenOp,
  newPlacedToken,
  removeTokenOp,
  sendMapOps,
} from '../../src/lib/sessions/console/map-ops';
import {
  assignablePlayers,
  playerRows,
  readiness,
  unassignedTokens,
} from '../../src/lib/sessions/console/players';
import { activeSessions, MAX_GAMES_LISTED } from '../../src/lib/sessions/active';
import { createSessionState } from '../../src/lib/sessions/state';
import { createFogBitmap } from '../../src/formats/fog-codec';
import { definition, session, snapshot } from '../sessions/fixtures';

const state = () => {
  const base = createSessionState(snapshot('gm'), '1');
  return {
    ...base,
    session: {
      ...base.session,
      players: [
        ...base.session.players,
        { user_id: '9', username: 'abe', status: 'kicked' as const, ready: false },
      ],
    },
  };
};

describe('players helpers', () => {
  it('lists players with their tokens, the kicked ones last', () => {
    const rows = playerRows(state());
    expect(rows.map((r) => r.player.username)).toEqual(['bob', 'eve', 'abe']);
    expect(rows[0]!.tokens.map((t) => t.id)).toEqual(['21']);
    expect(rows[1]!.tokens).toEqual([]);
  });

  it('finds the tokens without owner and the assignable players', () => {
    expect(unassignedTokens(state()).map((t) => t.id)).toEqual(['22']);
    expect(assignablePlayers(state()).map((p) => p.user_id)).toEqual(['7', '8']);
  });

  it('counts the connected and ready players', () => {
    expect(readiness(state())).toEqual({ connected: 1, ready: 1 });
  });
});

describe('fog actions', () => {
  const grid = { floor: '35', width: 40, height: 30, fogChunk: () => null };

  it('builds actions only for bits that change the fog', () => {
    const raster = rectRaster(grid, [1, 1], [4, 4])!;
    const actions = fogActionsFor('fog.reveal', grid, raster);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'fog.reveal', floor: '35' });
    expect(fogActionsFor('fog.hide', grid, raster)).toEqual([]);
    const full = { ...grid, fogChunk: () => new Uint8Array(2048).fill(0xff) };
    expect(fogActionsFor('fog.reveal', full, raster)).toEqual([]);
    expect(createFogBitmap()).toHaveLength(2048);
  });

  it('refuses an empty rectangle', () => {
    expect(rectRaster(grid, [1, 1], [1, 5])).toBeNull();
  });
});

describe('map ops', () => {
  it('places a token inside the map, centred on its footprint', () => {
    const token = newPlacedToken({ id: '21', sizeW: 2, sizeH: 2 }, 'u1', '35', 39, 29, {
      width: 40,
      height: 30,
    });
    expect(token).toMatchObject({
      uid: 'u1',
      floor: '35',
      token_id: '21',
      x: 39,
      y: 29,
      hidden: false,
    });
    expect(addTokenOp(token)).toEqual({ type: 'maptoken.add', token });
    expect(removeTokenOp('u1')).toEqual({ type: 'maptoken.remove', uid: 'u1' });
    expect(hideTokenOp(token, true)).toEqual({
      type: 'maptoken.update',
      uid: 'u1',
      rev: 1,
      patch: { hidden: true },
    });
  });

  it('sends the ops with the base revision and an operation id', async () => {
    const sendOps = vi.fn(async () => ({ revision: 9, conflicts: [] }));
    const revision = await sendMapOps({ sendOps }, '34', 8, [removeTokenOp('u1')]);
    expect(revision).toBe(9);
    expect(sendOps).toHaveBeenCalledWith('34', {
      base_revision: 8,
      client_op_id: expect.any(String),
      ops: [removeTokenOp('u1')],
    });
  });
});

describe('activeSessions', () => {
  it('keeps the open sessions, ignores failing games and caps the requests', async () => {
    const list = vi.fn(async (id: string) => {
      if (id === 'bad')
        throw new ApiError({ code: 'forbidden', message: 'x', status: 403, requestId: null });
      return {
        items: [
          session('gm', { id: `s-${id}`, state: 'running' }),
          session('gm', { id: `e-${id}`, state: 'ended' }),
        ],
        nextCursor: null,
      };
    });
    const found = await activeSessions({ list }, [
      { id: 'a', name: 'A' },
      { id: 'bad', name: 'B' },
      { id: 'a', name: 'A' },
    ]);
    expect(found.map((f) => f.session.id)).toEqual(['s-a']);
    expect(list).toHaveBeenCalledTimes(2);
    const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), name: 'g' }));
    list.mockClear();
    await activeSessions({ list }, many);
    expect(list).toHaveBeenCalledTimes(MAX_GAMES_LISTED);
    expect(definition().id).toBe('21');
  });
});
