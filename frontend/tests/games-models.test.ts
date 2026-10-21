import { describe, expect, it } from 'vitest';
import { DashboardGames, splitByRole } from '../src/lib/games/dashboard.svelte';
import { GamePageModel } from '../src/lib/games/game-page.svelte';
import { GamesClient } from '../src/lib/games/games-client';
import { optimistic } from '../src/lib/games/optimistic';
import {
  fail,
  json,
  makeEncounter,
  makeGame,
  makeMember,
  makeToken,
  mockApi,
  noContent,
  ok,
} from './fixtures/games';

const members = [makeMember('1', 'Alice', 'gm'), makeMember('2', 'Bob', 'player')];

/** Routes of a GM game; `writes` overrides the answer of non-GET requests. */
function gameApi(
  game = makeGame(),
  writes: (url: string, init: RequestInit) => Response | null = () => null,
) {
  return mockApi((url, init) => {
    if (init.method !== 'GET') {
      const answer = writes(url, init);
      if (answer !== null) return answer;
    }
    if (url.endsWith('/members')) return json(ok(members));
    if (url.endsWith('/tokens')) return json(ok([makeToken()]));
    if (url.endsWith('/encounters')) return json(ok([makeEncounter()]));
    if (init.method === 'DELETE') return noContent();
    return json(ok(game));
  });
}

describe('optimistic', () => {
  it('keeps the change on success and rolls back on failure', async () => {
    let value = 1;
    await optimistic(
      () => {
        const previous = value;
        value = 2;
        return previous;
      },
      () => Promise.resolve('ok'),
      (previous) => (value = previous),
    );
    expect(value).toBe(2);
    await expect(
      optimistic(
        () => {
          const previous = value;
          value = 3;
          return previous;
        },
        () => Promise.reject(new Error('refused')),
        (previous) => (value = previous),
      ),
    ).rejects.toThrow('refused');
    expect(value).toBe(2);
  });
});

describe('GamePageModel', () => {
  it('loads the game, then members, tokens and encounters (GM)', async () => {
    const { api, fetchMock } = gameApi();
    const model = new GamePageModel(new GamesClient(api), '7');
    await model.load();
    expect(model.status).toBe('ready');
    expect(model.role).toBe('gm');
    expect(model.members).toEqual(members);
    expect(model.tokens).toHaveLength(1);
    expect(model.encounters).toHaveLength(1);
    expect(model.listsLoaded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not ask a player for the encounters', async () => {
    const { api, fetchMock } = gameApi(makeGame({ my_role: 'player' }));
    const model = new GamePageModel(new GamesClient(api), '7');
    await model.load();
    expect(model.encounters).toEqual([]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('encounters'))).toBe(false);
  });

  it('maps a 404 to not_found and other errors to error', async () => {
    const missing = mockApi(() => json(fail('not_found'), 404));
    const model = new GamePageModel(new GamesClient(missing.api), '9');
    await model.load();
    expect(model.status).toBe('not_found');

    const broken = mockApi(() => json(fail('internal_error'), 500));
    const other = new GamePageModel(new GamesClient(broken.api), '9');
    await other.load();
    expect(other.status).toBe('error');
  });

  it('renames optimistically and keeps the server answer', async () => {
    const { api } = gameApi(makeGame(), (_url, init) =>
      init.method === 'PATCH' ? json(ok(makeGame({ name: 'Serveur' }))) : null,
    );
    const model = new GamePageModel(new GamesClient(api), '7');
    await model.load();
    const pending = model.updateGame({ name: 'Local' });
    expect(model.game?.name).toBe('Local');
    await pending;
    expect(model.game?.name).toBe('Serveur');
  });

  it('rolls a refused rename back', async () => {
    const { api } = gameApi(makeGame(), (_url, init) =>
      init.method === 'PATCH' ? json(fail('forbidden'), 403) : null,
    );
    const model = new GamePageModel(new GamesClient(api), '7');
    await model.load();
    const pending = model.updateGame({ name: 'Local' });
    expect(model.game?.name).toBe('Local');
    await expect(pending).rejects.toMatchObject({ code: 'forbidden' });
    expect(model.game?.name).toBe('Campagne');
  });

  it('changes a role optimistically and rolls it back when refused', async () => {
    let refuse = false;
    const { api } = gameApi(makeGame(), (_url, init) =>
      init.method === 'PATCH'
        ? refuse
          ? json(fail('forbidden'), 403)
          : json(ok(makeMember('2', 'Bob', 'co_gm')))
        : null,
    );
    const model = new GamePageModel(new GamesClient(api), '7');
    await model.load();

    const pending = model.setRole('2', 'co_gm');
    expect(model.members.find((m) => m.user.id === '2')?.role).toBe('co_gm');
    await pending;
    expect(model.members.find((m) => m.user.id === '2')?.role).toBe('co_gm');

    refuse = true;
    const refused = model.setRole('2', 'player');
    expect(model.members.find((m) => m.user.id === '2')?.role).toBe('player');
    await expect(refused).rejects.toMatchObject({ status: 403 });
    expect(model.members.find((m) => m.user.id === '2')?.role).toBe('co_gm');
  });

  it('updates lists and counts after token and member changes', async () => {
    const created = makeToken({ id: '31', name: 'Orc' });
    const { api } = gameApi(makeGame(), (url, init) => {
      if (init.method === 'POST' && url.endsWith('/tokens')) return json(ok(created), 201);
      if (init.method === 'POST' && url.endsWith('/members'))
        return json(ok(makeMember('5', 'Eve', 'player')), 201);
      return null;
    });
    const model = new GamePageModel(new GamesClient(api), '7');
    await model.load();

    await model.createToken({ ...created });
    expect(model.tokens.map((t) => t.id)).toEqual(['30', '31']);
    expect(model.game?.counts.tokens).toBe(2);

    await model.deleteToken('30');
    expect(model.tokens.map((t) => t.id)).toEqual(['31']);
    expect(model.encounters[0]?.tokens).toEqual([]);
    expect(model.game?.counts.tokens).toBe(1);

    await model.addMember('Eve', 'player');
    expect(model.game?.counts.members).toBe(3);
    await model.removeMember('5');
    expect(model.members.map((m) => m.user.id)).toEqual(['1', '2']);
  });

  it('archives and restores (204 or game answer)', async () => {
    const { api } = gameApi(makeGame(), (url) =>
      url.endsWith('/archive')
        ? noContent()
        : url.endsWith('/restore')
          ? json(ok(makeGame({ archived_at: null })))
          : null,
    );
    const model = new GamePageModel(new GamesClient(api), '7');
    await model.load();
    await model.archive();
    expect(model.game?.archived_at).not.toBeNull();
    await model.restore();
    expect(model.game?.archived_at).toBeNull();
  });
});

describe('DashboardGames', () => {
  it('splits my games by role and sorts them by name', () => {
    const { gm, player } = splitByRole([
      makeGame({ id: '1', name: 'Zeta' }),
      makeGame({ id: '2', name: 'Alpha', my_role: 'player' }),
      makeGame({ id: '3', name: 'Étoile', my_role: 'co_gm' }),
      makeGame({ id: '4', name: 'Beta' }),
    ]);
    expect(gm.map((g) => g.id)).toEqual(['4', '1']);
    expect(player.map((g) => g.id)).toEqual(['2', '3']);
  });

  it('loads, creates and restores games', async () => {
    const trashed = makeGame({ id: '8', name: 'Ancienne', deleted_at: '2026-10-20T08:00:00Z' });
    const { api, fetchMock } = mockApi((url, init) => {
      if (url.includes('state=trash')) return json(ok([trashed]));
      if (url.endsWith('/restore')) return noContent();
      if (init.method === 'POST') return json(ok(makeGame({ id: '9', name: 'Neuve' })), 201);
      return json(ok([makeGame(), makeGame({ id: '2', name: 'Autre', my_role: 'player' })]));
    });
    const dashboard = new DashboardGames(new GamesClient(api));
    await dashboard.load();
    expect(dashboard.loaded).toBe(true);
    expect(dashboard.gm.map((g) => g.id)).toEqual(['7']);
    expect(dashboard.player.map((g) => g.id)).toEqual(['2']);

    await dashboard.create({ name: 'Neuve' });
    expect(dashboard.gm.map((g) => g.name)).toEqual(['Campagne', 'Neuve']);

    await dashboard.loadShelf('trash');
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe('/api/v1/games?role=gm&state=trash');
    expect(dashboard.shelf.trash).toEqual([trashed]);

    await dashboard.restore(trashed, 'trash');
    expect(dashboard.shelf.trash).toEqual([]);
    expect(dashboard.gm.find((g) => g.id === '8')?.deleted_at).toBeNull();
  });

  it('keeps the error of a failed load', async () => {
    const { api } = mockApi(() => json(fail('internal_error'), 500));
    const dashboard = new DashboardGames(new GamesClient(api));
    await dashboard.load();
    expect(dashboard.error).toMatchObject({ code: 'internal_error' });
    expect(dashboard.loading).toBe(false);
  });
});
