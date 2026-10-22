import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/api';
import { dispositionFileName, exportFileName, MapsClient } from '../../src/lib/maps/maps-client';
import type { MapVersion } from '../../src/lib/types';
import { FakeXhr } from '../fixtures/fake-xhr';
import { fail, json, mockApi, ok } from '../fixtures/games';
import { makeMap } from './fixtures';

function call(fetchMock: ReturnType<typeof mockApi>['fetchMock'], index = 0) {
  const init = fetchMock.mock.calls[index]?.[1] ?? {};
  const headers = new Headers(init.headers);
  return {
    url: String(fetchMock.mock.calls[index]?.[0]),
    method: init.method,
    body: init.body,
    json: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    csrf: headers.get('X-CSRF-Token'),
    accept: headers.get('Accept'),
    contentType: headers.get('Content-Type'),
  };
}

const version: MapVersion = {
  id: '5',
  map_id: '11',
  revision: 7,
  kind: 'manual',
  label: 'Avant la crypte',
  size_bytes: 2048,
  created_by: { id: '1', username: 'Alice' },
  created_at: '2026-10-22T10:00:00Z',
};

describe('MapsClient (P4c)', () => {
  it('lists, creates and restores versions', async () => {
    const { api, fetchMock } = mockApi((url, init) => {
      if (url.endsWith('/restore')) return json(ok({ revision: 9, map: makeMap({ revision: 9 }) }));
      if (init.method === 'POST') return json(ok(version), 201);
      return json(ok([version]));
    });
    const client = new MapsClient(api);
    expect(await client.versions('11')).toEqual([version]);
    expect(await client.createVersion('11', '  Avant la crypte ')).toEqual(version);
    await client.createVersion('11', '   ');
    await client.createVersion('11');
    const restored = await client.restoreVersion('11', 'v/5', 'op-1');
    expect(restored.revision).toBe(9);
    expect(restored.map.revision).toBe(9);
    expect([0, 1, 4].map((i) => [call(fetchMock, i).method, call(fetchMock, i).url])).toEqual([
      ['GET', '/api/v1/maps/11/versions'],
      ['POST', '/api/v1/maps/11/versions'],
      ['POST', '/api/v1/maps/11/versions/v%2F5/restore'],
    ]);
    expect(call(fetchMock, 1).json).toEqual({ label: 'Avant la crypte' });
    expect(call(fetchMock, 2).json).toEqual({});
    expect(call(fetchMock, 3).json).toEqual({});
    expect(call(fetchMock, 4).json).toEqual({ client_op_id: 'op-1' });
    expect(call(fetchMock, 4).csrf).toBe('tok');
  });

  it('reports refusals as ApiError', async () => {
    const { api } = mockApi(() => json(fail('forbidden'), 403));
    await expect(new MapsClient(api).versions('11')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
  });

  it('downloads the JSON and ZIP exports with their file name', async () => {
    const { api, fetchMock } = mockApi((url) =>
      url.includes('assets=1')
        ? new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
            status: 200,
            headers: { 'Content-Type': 'application/zip' },
          })
        : new Response('{"format":"jdr-map"}', {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="crypte.json"; filename*=UTF-8''Crypte%20oubli%C3%A9e.json`,
            },
          }),
    );
    const client = new MapsClient(api);
    const jsonFile = await client.exportFile('11', false, 'Crypte');
    expect(jsonFile.fileName).toBe('Crypte oubliée.json');
    expect(await jsonFile.blob.text()).toBe('{"format":"jdr-map"}');
    const zip = await client.exportFile('11', true, 'Crypte / niveau 2');
    expect(zip.fileName).toBe('Crypte niveau 2.zip');
    expect(zip.blob.size).toBe(4);
    expect(call(fetchMock, 0)).toMatchObject({
      method: 'GET',
      url: '/api/v1/maps/11/export?assets=0',
      accept: 'application/json',
    });
    expect(call(fetchMock, 1)).toMatchObject({
      url: '/api/v1/maps/11/export?assets=1',
      accept: 'application/zip',
    });
  });

  it('throws the error envelope of a refused export', async () => {
    const { api } = mockApi(() => json(fail('not_found'), 404));
    await expect(new MapsClient(api).exportFile('11', false)).rejects.toBeInstanceOf(ApiError);
  });

  it('reads Content-Disposition file names and builds safe ones', () => {
    expect(dispositionFileName(null)).toBeNull();
    expect(dispositionFileName('attachment')).toBeNull();
    expect(dispositionFileName('attachment; filename=plain.zip')).toBe('plain.zip');
    expect(dispositionFileName('attachment; filename="a b.json"')).toBe('a b.json');
    expect(dispositionFileName("attachment; filename*=UTF-8''%C3%A9t%C3%A9.json")).toBe('été.json');
    expect(dispositionFileName("attachment; filename*=UTF-8''%E0%A4%A; filename=x.json")).toBe(
      'x.json',
    );
    expect(exportFileName('  ', false)).toBe('map.json');
    expect(exportFileName('a:b*c?\u0001d', true)).toBe('a b c d.zip');
  });

  it('imports a file with upload progress (multipart, CSRF)', async () => {
    const { api } = mockApi(() => json(ok({})));
    const xhrs: FakeXhr[] = [];
    const client = new MapsClient(api, () => {
      const x = new FakeXhr();
      xhrs.push(x);
      return x;
    });
    const progress: number[] = [];
    const file = new Blob(['{}'], { type: 'application/json' });
    const pending = client.importFile('7', file, 'map.json', {
      onProgress: (loaded, total) => progress.push(loaded / total),
      clientOpId: 'imp-1',
    });
    const xhr = xhrs[0]!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/v1/games/7/maps/import');
    expect(xhr.headers['X-CSRF-Token']).toBe('tok');
    expect((xhr.body?.get('file') as File).name).toBe('map.json');
    expect(xhr.body?.get('client_op_id')).toBe('imp-1');
    xhr.progress(1, 2);
    xhr.respond({
      status: 201,
      body: ok({ map: makeMap({ id: '12' }), missing_assets: [{ ref: 'sha256:aa', name: 'A' }] }),
    });
    const result = await pending;
    expect(result.map.id).toBe('12');
    expect(result.missing_assets).toEqual([{ ref: 'sha256:aa', name: 'A' }]);
    expect(progress).toEqual([0.5]);
  });

  it('retries an import once after csrf_invalid and reports other refusals', async () => {
    const { api } = mockApi(() => json(ok({ user: null, csrf_token: 'new' })));
    let renewed = 0;
    api.renewCsrf = () => {
      renewed++;
      return Promise.resolve(true);
    };
    const xhrs: FakeXhr[] = [];
    const client = new MapsClient(api, () => {
      const x = new FakeXhr();
      x.onSend = (self) => {
        if (xhrs.length === 1) self.respond({ status: 403, body: fail('csrf_invalid') });
        else if (xhrs.length === 2) self.respond({ status: 201, body: ok({ map: makeMap() }) });
        else self.respond({ status: 422, body: fail('unsupported_format_version') });
      };
      xhrs.push(x);
      return x;
    });
    const result = await client.importFile('7', new Blob(['{}']), 'a.json');
    expect(renewed).toBe(1);
    expect(result.missing_assets).toEqual([]);
    await expect(client.importFile('7', new Blob(['{}']), 'a.json')).rejects.toMatchObject({
      code: 'unsupported_format_version',
      status: 422,
    });
  });

  it('sends a thumbnail as the raw request body', async () => {
    const { api, fetchMock } = mockApi(() => json(ok({ thumb_url: '/files/t.webp' })));
    const client = new MapsClient(api);
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    expect(await client.putThumbnail('11', image)).toEqual({ thumb_url: '/files/t.webp' });
    expect(call(fetchMock)).toMatchObject({
      method: 'PUT',
      url: '/api/v1/maps/11/thumbnail',
      contentType: 'image/webp',
      csrf: 'tok',
    });
    expect(call(fetchMock).body).toBe(image);
    await client.putThumbnail('11', new Blob([new Uint8Array([1])]));
    expect(call(fetchMock, 1).contentType).toBe('image/png');
  });
});
