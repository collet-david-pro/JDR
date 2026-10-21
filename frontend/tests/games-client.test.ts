import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { GamesClient } from '../src/lib/games/games-client';
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

function call(fetchMock: ReturnType<typeof mockApi>['fetchMock'], index = 0) {
  const args = fetchMock.mock.calls[index];
  const init = args?.[1] ?? {};
  const headers = new Headers(init.headers);
  return {
    url: String(args?.[0]),
    method: init.method,
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    csrf: headers.get('X-CSRF-Token'),
  };
}

describe('GamesClient URLs and payloads', () => {
  it('lists games with optional role and state filters', async () => {
    const { api, fetchMock } = mockApi(() => json(ok([makeGame()])));
    const client = new GamesClient(api);
    expect(await client.list()).toEqual([makeGame()]);
    await client.list({ role: 'gm', state: 'trash' });
    expect(call(fetchMock, 0).url).toBe('/api/v1/games');
    expect(call(fetchMock, 1).url).toBe('/api/v1/games?role=gm&state=trash');
  });

  it('works in query routing mode and encodes identifiers', async () => {
    const { api, fetchMock } = mockApi(() => json(ok(makeGame())), '/jdr/index.php?r=/api/v1');
    const client = new GamesClient(api);
    await client.get('7');
    await client.list({ role: 'player' });
    await client.get('a/b');
    expect(call(fetchMock, 0).url).toBe('/jdr/index.php?r=/api/v1/games/7');
    expect(call(fetchMock, 1).url).toBe('/jdr/index.php?r=/api/v1/games&role=player');
    expect(call(fetchMock, 2).url).toBe('/jdr/index.php?r=/api/v1/games/a%2Fb');
  });

  it('creates, updates, archives, restores and deletes a game', async () => {
    const { api, fetchMock } = mockApi((url, init) => {
      if (init.method === 'DELETE') return noContent();
      if (url.endsWith('/archive')) return noContent();
      return json(ok(makeGame()), init.method === 'POST' ? 201 : 200);
    });
    const client = new GamesClient(api);
    await client.create({ name: 'Campagne', description: 'x' });
    await client.update('7', { settings: { fog_strict: false } });
    expect(await client.archive('7')).toBeNull();
    expect(await client.restore('7')).toEqual(makeGame());
    await client.remove('7');

    expect(call(fetchMock, 0)).toMatchObject({
      url: '/api/v1/games',
      method: 'POST',
      body: { name: 'Campagne', description: 'x' },
      csrf: 'tok',
    });
    expect(call(fetchMock, 1)).toMatchObject({
      url: '/api/v1/games/7',
      method: 'PATCH',
      body: { settings: { fog_strict: false } },
    });
    expect(call(fetchMock, 2)).toMatchObject({ url: '/api/v1/games/7/archive', method: 'POST' });
    expect(call(fetchMock, 3)).toMatchObject({ url: '/api/v1/games/7/restore', method: 'POST' });
    expect(call(fetchMock, 4)).toMatchObject({ url: '/api/v1/games/7', method: 'DELETE' });
  });

  it('manages members', async () => {
    const member = makeMember('2', 'Bob', 'player');
    const { api, fetchMock } = mockApi((_url, init) =>
      init.method === 'DELETE' ? noContent() : json(ok(init.method === 'GET' ? [member] : member)),
    );
    const client = new GamesClient(api);
    expect(await client.members('7')).toEqual([member]);
    await client.addMember('7', 'bob@example.org');
    await client.addMember('7', 'Bob', 'co_gm');
    await client.setMemberRole('7', '2', 'co_gm');
    await client.removeMember('7', '2');
    expect(call(fetchMock, 0).url).toBe('/api/v1/games/7/members');
    expect(call(fetchMock, 1).body).toEqual({ identifier: 'bob@example.org' });
    expect(call(fetchMock, 2).body).toEqual({ identifier: 'Bob', role: 'co_gm' });
    expect(call(fetchMock, 3)).toMatchObject({
      url: '/api/v1/games/7/members/2',
      method: 'PATCH',
      body: { role: 'co_gm' },
    });
    expect(call(fetchMock, 4)).toMatchObject({
      url: '/api/v1/games/7/members/2',
      method: 'DELETE',
    });
  });

  it('manages tokens and encounters', async () => {
    const token = makeToken();
    const encounter = makeEncounter();
    const { api, fetchMock } = mockApi((url, init) => {
      if (init.method === 'DELETE') return noContent();
      const isEncounter = url.includes('encounter');
      const item = isEncounter ? encounter : token;
      return json(ok(init.method === 'GET' ? [item] : item));
    });
    const client = new GamesClient(api);
    expect(await client.tokens('7')).toEqual([token]);
    await client.createToken('7', { ...token, asset_id: null });
    await client.updateToken('30', { name: 'Orc' });
    await client.deleteToken('30');
    expect(await client.encounters('7')).toEqual([encounter]);
    await client.createEncounter('7', { name: 'E', notes: '', tokens: [] });
    await client.updateEncounter('50', { name: 'F' });
    await client.deleteEncounter('50');

    expect(fetchMock.mock.calls.map((c) => `${c[1]?.method} ${String(c[0])}`)).toEqual([
      'GET /api/v1/games/7/tokens',
      'POST /api/v1/games/7/tokens',
      'PATCH /api/v1/tokens/30',
      'DELETE /api/v1/tokens/30',
      'GET /api/v1/games/7/encounters',
      'POST /api/v1/games/7/encounters',
      'PATCH /api/v1/encounters/50',
      'DELETE /api/v1/encounters/50',
    ]);
  });

  it('tolerates a non-array list body', async () => {
    const { api } = mockApi(() => json(ok(null)));
    expect(await new GamesClient(api).tokens('7')).toEqual([]);
  });
});

describe('GamesClient errors', () => {
  it('throws ApiError not_found (404) for a game of someone else', async () => {
    const { api } = mockApi(() => json(fail('not_found'), 404));
    const error = await new GamesClient(api).get('9').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'not_found', status: 404, requestId: 'rq' });
  });

  it('throws ApiError forbidden (403) on a GM write by a player', async () => {
    const { api } = mockApi(() => json(fail('forbidden'), 403));
    await expect(new GamesClient(api).deleteToken('30')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
  });

  it('exposes the 422 fields of an unknown member identifier', async () => {
    const { api } = mockApi(() =>
      json(fail('validation_failed', { identifier: 'not_found' }), 422),
    );
    await expect(new GamesClient(api).addMember('7', 'nobody')).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { identifier: 'not_found' },
    });
  });
});
