import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/api';
import { MapsClient } from '../../src/lib/maps/maps-client';
import { encodeChunkStream } from '../../src/formats/chunk-stream';
import { fail, json, mockApi, noContent, ok } from '../fixtures/games';
import { makeMap, makeSummary } from './fixtures';

function call(fetchMock: ReturnType<typeof mockApi>['fetchMock'], index = 0) {
  const init = fetchMock.mock.calls[index]?.[1] ?? {};
  const headers = new Headers(init.headers);
  return {
    url: String(fetchMock.mock.calls[index]?.[0]),
    method: init.method,
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    csrf: headers.get('X-CSRF-Token'),
    accept: headers.get('Accept'),
    keepalive: init.keepalive === true,
  };
}

describe('MapsClient', () => {
  it('lists active maps and the trash of a game', async () => {
    const { api, fetchMock } = mockApi(() => json(ok([makeSummary()])));
    const client = new MapsClient(api);
    expect(await client.list('7')).toEqual([makeSummary()]);
    await client.list('7', 'trash');
    expect(call(fetchMock, 0).url).toBe('/api/v1/games/7/maps?state=active');
    expect(call(fetchMock, 1).url).toBe('/api/v1/games/7/maps?state=trash');
  });

  it('creates, reads, patches, trashes, restores and duplicates', async () => {
    const { api, fetchMock } = mockApi((url, init) => {
      if (init.method === 'DELETE' || url.endsWith('/restore')) return noContent();
      if (init.method === 'PATCH') return json(ok(makeSummary({ name: 'B' })));
      return json(ok(makeMap()), init.method === 'POST' ? 201 : 200);
    });
    const client = new MapsClient(api);
    await client.create('7', { name: 'A', width: 10, height: 12, folder: 'Acte 1' });
    expect(await client.get('11')).toEqual(makeMap());
    expect((await client.update('11', { folder: null })).name).toBe('B');
    await client.remove('11');
    await client.restore('11');
    await client.duplicate('a/b');
    expect(
      [0, 1, 2, 3, 4, 5].map((i) => [call(fetchMock, i).method, call(fetchMock, i).url]),
    ).toEqual([
      ['POST', '/api/v1/games/7/maps'],
      ['GET', '/api/v1/maps/11'],
      ['PATCH', '/api/v1/maps/11'],
      ['DELETE', '/api/v1/maps/11'],
      ['POST', '/api/v1/maps/11/restore'],
      ['POST', '/api/v1/maps/a%2Fb/duplicate'],
    ]);
    expect(call(fetchMock, 0).body).toEqual({ name: 'A', width: 10, height: 12, folder: 'Acte 1' });
    expect(call(fetchMock, 2).body).toEqual({ folder: null });
    expect(call(fetchMock, 3).csrf).toBe('tok');
  });

  it('sends ops with the CSRF token, optionally with keepalive', async () => {
    const { api, fetchMock } = mockApi(() => json(ok({ revision: 4, applied: 1, conflicts: [] })));
    const client = new MapsClient(api);
    const body = {
      base_revision: 3,
      client_op_id: 'abc',
      ops: [{ type: 'tiles.set' as const, floor: '91', layer: 'ground', cells: [[1, 2, 3, 0, 0]] }],
    };
    expect(await client.sendOps('11', body)).toEqual({ revision: 4, applied: 1, conflicts: [] });
    await client.sendOps('11', body, { keepalive: true });
    expect(call(fetchMock, 0)).toMatchObject({
      url: '/api/v1/maps/11/ops',
      method: 'POST',
      body,
      csrf: 'tok',
      keepalive: false,
    });
    expect(call(fetchMock, 1).keepalive).toBe(true);
  });

  it('reports ops refusals as ApiError (422, 409 revision_conflict)', async () => {
    const answers = [json(fail('validation_failed'), 422), json(fail('revision_conflict'), 409)];
    const { api } = mockApi(() => answers.shift()!);
    const client = new MapsClient(api);
    const body = { base_revision: 0, client_op_id: 'x', ops: [] };
    await expect(client.sendOps('11', body)).rejects.toMatchObject({
      code: 'validation_failed',
      status: 422,
    });
    await expect(client.sendOps('11', body)).rejects.toMatchObject({
      code: 'revision_conflict',
      status: 409,
    });
  });

  it('reads the binary chunk stream and the revision header', async () => {
    const stream = encodeChunkStream([
      { cx: 1, cy: 2, layer: 'decor', data: new Uint8Array([9, 8, 7]) },
    ]);
    const { api, fetchMock } = mockApi(
      () =>
        new Response(stream.slice().buffer, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream', 'X-Map-Revision': '12' },
        }),
    );
    const client = new MapsClient(api);
    const answer = await client.chunks('11', { floor: '91', cells: ['0:0', '1:2'] });
    expect(answer.revision).toBe(12);
    expect(answer.records.map((r) => [r.key, r.layer, [...r.data]])).toEqual([
      ['1:2', 'decor', [9, 8, 7]],
    ]);
    expect(call(fetchMock).url).toBe(
      '/api/v1/maps/11/chunks?floor=91&layers=ground%2Cterrain%2Cdecor&cells=0%3A0%2C1%3A2',
    );
    expect(call(fetchMock).accept).toBe('application/octet-stream');
    await client.chunks('11', { floor: '91' });
    expect(call(fetchMock, 1).url).toBe(
      '/api/v1/maps/11/chunks?floor=91&layers=ground%2Cterrain%2Cdecor',
    );
  });

  it('turns a corrupt stream or an error envelope into ApiError', async () => {
    const answers = [
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
      json(fail('forbidden'), 403),
    ];
    const { api } = mockApi(() => answers.shift()!);
    const client = new MapsClient(api);
    await expect(client.chunks('11', { floor: '91' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
    const error = await client.chunks('11', { floor: '91' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'forbidden', status: 403 });
  });
});
