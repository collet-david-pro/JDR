import { describe, expect, it } from 'vitest';
import { MapFileError, type MapFilePreview } from '../../src/formats/map-document-file';
import { ApiError } from '../../src/lib/api';
import {
  importErrorText,
  importFailure,
  issueText,
  serverIssueCode,
} from '../../src/lib/maps/import-labels';
import { MapImportModel } from '../../src/lib/maps/map-import.svelte';
import { MapsTabModel } from '../../src/lib/maps/maps-tab.svelte';
import type { MapImportResult } from '../../src/lib/types';
import { makeMap, makeSummary } from './fixtures';

const preview = { name: 'Crypte', width: 10, height: 8, assets: 1 } as MapFilePreview;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

describe('MapImportModel', () => {
  it('reads, previews, uploads with progress and reports missing assets', async () => {
    const answer = deferred<MapImportResult>();
    let signal: AbortSignal | undefined;
    let progress: ((l: number, t: number) => void) | undefined;
    const model = new MapImportModel(
      {
        importFile: (gameId, _file, name, options) => {
          expect([gameId, name]).toEqual(['7', 'crypte.json']);
          signal = options?.signal;
          progress = options?.onProgress;
          return answer.promise;
        },
      },
      '7',
      () => Promise.resolve(preview),
    );
    await model.choose(new Blob(['{}']), 'crypte.json');
    expect(model.step).toBe('preview');
    expect(model.preview).toBe(preview);
    const pending = model.upload();
    expect(model.step).toBe('uploading');
    progress?.(25, 100);
    expect(model.progress).toBe(0.25);
    progress?.(25, 0);
    expect(model.progress).toBeNull();
    const result = {
      map: makeMap({ id: '12' }),
      missing_assets: [{ ref: 'sha256:aa', name: 'A' }],
    };
    answer.resolve(result);
    expect(await pending).toBe(result);
    expect(model.step).toBe('done');
    expect(model.result).toBe(result);
    expect(signal?.aborted).toBe(false);
    model.reset();
    expect(model.step).toBe('choose');
  });

  it('shows why a file is refused', async () => {
    const model = new MapImportModel(
      { importFile: () => Promise.reject(new Error('no')) },
      '7',
      () => Promise.reject(new MapFileError('unsupported_format_version', [], 4)),
    );
    await model.choose(new Blob(['x']), 'x.json');
    expect(model.step).toBe('invalid');
    expect(model.fileError?.code).toBe('unsupported_format_version');
    expect(await model.upload()).toBeNull();
  });

  it('keeps the preview after a refused or cancelled upload', async () => {
    const answers: ReturnType<typeof deferred<MapImportResult>>[] = [];
    const model = new MapImportModel(
      {
        importFile: (_g, _f, _n, options) => {
          const d = deferred<MapImportResult>();
          options?.signal?.addEventListener('abort', () => d.reject(new Error('aborted')));
          answers.push(d);
          return d.promise;
        },
      },
      '7',
      () => Promise.resolve(preview),
    );
    await model.choose(new Blob(['{}']), 'a.json');
    const refused = model.upload();
    answers[0]!.reject(Object.assign(new Error('quota'), { code: 'quota_exceeded' }));
    expect(await refused).toBeNull();
    expect(model.step).toBe('preview');
    expect(model.error).toBeInstanceOf(Error);
    const cancelled = model.upload();
    model.cancel();
    expect(await cancelled).toBeNull();
    expect(model.step).toBe('preview');
    expect(model.error).toBeNull();
  });

  it('ignores a stale reading when another file is chosen', async () => {
    const reads = [deferred<MapFilePreview>(), deferred<MapFilePreview>()];
    let i = 0;
    const model = new MapImportModel(
      { importFile: () => Promise.reject(new Error()) },
      '7',
      () => reads[i++]!.promise,
    );
    const first = model.choose(new Blob(['1']), 'a.json');
    const second = model.choose(new Blob(['2']), 'b.json');
    reads[1]!.resolve({ ...preview, name: 'B' });
    await second;
    reads[0]!.resolve({ ...preview, name: 'A' });
    await first;
    expect(model.preview?.name).toBe('B');
  });

  it('adds the imported map to the Maps tab list once', () => {
    const tab = new MapsTabModel(
      {
        list: () => Promise.resolve([]),
        create: () => Promise.reject(new Error()),
        update: () => Promise.reject(new Error()),
        remove: () => Promise.resolve(),
        restore: () => Promise.resolve(),
        duplicate: () => Promise.reject(new Error()),
      },
      '7',
    );
    tab.maps = [makeSummary({ id: '1' })];
    tab.added(makeMap({ id: '12' }));
    tab.added(makeMap({ id: '12' }));
    expect(tab.maps.map((m) => m.id)).toEqual(['1', '12']);
    tab.view = 'trash';
    tab.added(makeMap({ id: '13' }));
    expect(tab.maps).toHaveLength(2);
  });

  it('sends one client_op_id per chosen file, renewed after a server answer only', async () => {
    const ids: (string | undefined)[] = [];
    const answers: unknown[] = [
      new ApiError({ code: 'network_error', message: 'x', status: 0 }),
      new ApiError({ code: 'quota_exceeded', message: 'x', status: 413 }),
      { map: makeMap(), missing_assets: [] },
    ];
    let n = 0;
    const model = new MapImportModel(
      {
        importFile: (_g, _f, _n, options) => {
          ids.push(options?.clientOpId);
          const a = answers.shift();
          return a instanceof Error ? Promise.reject(a) : Promise.resolve(a as MapImportResult);
        },
      },
      '7',
      () => Promise.resolve(preview),
      () => `id-${++n}`,
    );
    await model.choose(new Blob(['{}']), 'a.json');
    await model.upload(); // network loss: same id next time
    await model.upload(); // 413: new id next time
    await model.upload();
    expect(ids).toEqual(['id-1', 'id-1', 'id-2']);
    await model.choose(new Blob(['{}']), 'b.json');
    expect(n).toBe(3);
  });

  it('explains the refusals of the server', () => {
    const t = (key: string, params?: Readonly<Record<string, string | number>>) =>
      `${key}${params ? JSON.stringify(params) : ''}`;
    const err = (code: string, status: number, fields: Record<string, string> = {}) =>
      new ApiError({ code, message: code, status, fields, requestId: 'rq-1' });
    expect(importFailure(err('invalid_map_file', 422, { file: 'missing_document' }), t)).toEqual({
      message: 'games.maps.import.errors.zip_without_map',
      issues: [],
      requestId: 'rq-1',
    });
    expect(importFailure(err('invalid_map_file', 422, { file: 'too_large' }), t).message).toBe(
      'games.maps.import.errors.too_large',
    );
    expect(importFailure(err('invalid_map_file', 422, { file: 'invalid' }), t).message).toBe(
      'games.maps.import.errors.unreadable',
    );
    const invalid = importFailure(
      err('validation_failed', 422, {
        'palette.3.asset': 'invalid',
        'chunks.f1.ground.0:0': 'bad_palette_index',
        'chunks.f9': 'not_found',
        objects: 'unsupported',
        'floors.0.name': 'too_long',
      }),
      t,
    );
    expect(invalid.message).toBe('games.maps.import.errors.invalid');
    expect(invalid.issues).toEqual([
      'games.maps.import.issues.value{"path":"palette.3.asset"}',
      'games.maps.import.issues.bad_block{"path":"chunks.f1.ground.0:0"}',
      'games.maps.import.issues.unknown_ref{"path":"chunks.f9"}',
      'games.maps.import.issues.unsupported{"path":"objects"}',
      'games.maps.import.issues.too_long{"path":"floors.0.name"}',
    ]);
    expect(importFailure(err('validation_failed', 422, { file: 'required' }), t).issues).toEqual(
      [],
    );
    expect(importFailure(err('unsupported_format_version', 422), t).message).toBe(
      'games.maps.import.errors.unsupported_format_version{"version":"?"}',
    );
    expect(importFailure(err('file_too_large', 413), t).message).toBe(
      'games.maps.import.errors.server_too_large',
    );
    expect(importFailure(err('quota_exceeded', 413), t).message).toBe(
      'games.maps.import.errors.quota_exceeded',
    );
    expect(importFailure(err('forbidden', 403), t).message).toBe('errors.unknown'); // the fake t returns the key itself;
    expect(importFailure(new Error('x'), t).requestId).toBeNull();
    expect(serverIssueCode('bad_flags')).toBe('bad_flags');
    expect(serverIssueCode('too_small')).toBe('range');
    expect(serverIssueCode('whatever')).toBe('pattern');
  });

  it('names the errors and issues', () => {
    const t = (key: string, params?: Readonly<Record<string, string | number>>) =>
      `${key}${params ? JSON.stringify(params) : ''}`;
    expect(importErrorText('missing_migration', 3, t)).toBe(
      'games.maps.import.errors.unsupported_format_version{"version":3}',
    );
    expect(issueText({ path: 'grid.width', code: 'out_of_bounds' }, t)).toBe(
      'games.maps.import.issues.range{"path":"grid.width"}',
    );
    expect(issueText({ path: '', code: 'type' }, t)).toBe(
      'games.maps.import.issues.type{"path":"/"}',
    );
  });
});
