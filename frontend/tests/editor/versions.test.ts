import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapSync, type LifecycleTarget } from '../../src/editor/sync/MapSync';
import { gridOf, layersFromWire, paletteFromWire } from '../../src/editor/sync/wire';
import { EditorSession } from '../../src/editor/ui/session';
import { versionKindLabel } from '../../src/editor/versions/labels';
import {
  normalizeVersionLabel,
  PendingOpsError,
  VERSION_LABEL_MAX,
  VersionsModel,
} from '../../src/editor/versions/versions.svelte';
import { resolveShortcut } from '../../src/editor/shortcuts';
import { ApiError } from '../../src/lib/api';
import { MemoryChunkCacheStore, MemoryPendingOpsStore } from '../../src/lib/persistence/map-stores';
import type { MapRestoreResult, MapVersion } from '../../src/lib/types';
import { FakeOpsServer } from '../maps/fake-server';
import { makeMap } from '../maps/fixtures';

function version(id: string, kind: MapVersion['kind'] = 'auto', label: string | null = null) {
  return {
    id,
    map_id: 'm1',
    revision: Number(id),
    kind,
    label,
    size_bytes: 100,
    created_by: null,
    created_at: '2026-10-22T10:00:00Z',
  } satisfies MapVersion;
}

function fakeClient(log: string[] = []) {
  const restored: MapRestoreResult = { revision: 9, map: makeMap({ id: 'm1', revision: 9 }) };
  return {
    log,
    restoreIds: [] as string[],
    restoreError: null as unknown,
    versions: vi.fn(() => {
      log.push('list');
      return Promise.resolve([version('2'), version('1', 'manual', 'Début')]);
    }),
    createVersion: vi.fn((_id: string, label: string | null) => {
      log.push(`create:${label}`);
      return Promise.resolve(version('3', 'manual', label));
    }),
    restoreVersion(
      this: { restoreIds: string[]; restoreError: unknown },
      _m: string,
      v: string,
      opId: string,
    ) {
      log.push(`restore:${v}`);
      this.restoreIds.push(opId);
      if (this.restoreError !== null) {
        const e = this.restoreError;
        this.restoreError = null;
        return Promise.reject(e);
      }
      return Promise.resolve(restored);
    },
  };
}

describe('VersionsModel', () => {
  it('loads the versions', async () => {
    const client = fakeClient();
    const model = new VersionsModel({
      mapId: 'm1',
      client,
      settle: () => Promise.resolve(true),
      onRestored: () => undefined,
    });
    await model.load();
    expect(model.status).toBe('ready');
    expect(model.versions.map((v) => v.id)).toEqual(['2', '1']);
  });

  it('keeps the load error', async () => {
    const model = new VersionsModel({
      mapId: 'm1',
      client: { ...fakeClient(), versions: () => Promise.reject(new Error('down')) },
      settle: () => Promise.resolve(true),
      onRestored: () => undefined,
    });
    await model.load();
    expect(model.status).toBe('error');
    expect(model.error).toBeInstanceOf(Error);
  });

  it('sends the pending ops before a manual snapshot, then lists it first', async () => {
    const log: string[] = [];
    const client = fakeClient(log);
    const model = new VersionsModel({
      mapId: 'm1',
      client,
      settle: () => {
        log.push('settle');
        return Promise.resolve(true);
      },
      onRestored: () => undefined,
    });
    await model.load();
    const created = await model.snapshot('  Avant la crypte  ');
    expect(created.label).toBe('Avant la crypte');
    expect(log).toEqual(['list', 'settle', 'create:Avant la crypte']);
    expect(model.versions.map((v) => v.id)).toEqual(['3', '2', '1']);
    expect(model.busy).toBeNull();
    await model.snapshot('');
    expect(log.at(-1)).toBe('create:null');
  });

  it('restores only after the queue is empty, then reloads', async () => {
    const log: string[] = [];
    const client = fakeClient(log);
    const editable: boolean[] = [];
    const restored: string[] = [];
    const model = new VersionsModel({
      mapId: 'm1',
      client,
      settle: () => {
        log.push('settle');
        return Promise.resolve(true);
      },
      setEditable: (e) => editable.push(e),
      onRestored: (result, v) => {
        log.push('reload');
        restored.push(`${v.id}@${result.revision}`);
      },
      newId: () => 'op-1',
    });
    const result = await model.restore(version('1', 'manual'));
    expect(result.revision).toBe(9);
    expect(log).toEqual(['settle', 'restore:1', 'reload']);
    expect(restored).toEqual(['1@9']);
    expect(editable).toEqual([false]); // stays blocked: the editor reloads
  });

  it('refuses the restoration while modifications cannot be confirmed', async () => {
    const client = fakeClient();
    const editable: boolean[] = [];
    const model = new VersionsModel({
      mapId: 'm1',
      client,
      settle: () => Promise.resolve(false),
      setEditable: (e) => editable.push(e),
      onRestored: () => undefined,
    });
    await expect(model.restore(version('1'))).rejects.toBeInstanceOf(PendingOpsError);
    await expect(model.snapshot('x')).rejects.toBeInstanceOf(PendingOpsError);
    expect(client.log).toEqual([]);
    expect(editable).toEqual([false, true]);
    expect(model.busy).toBeNull();
  });

  it('retries a restoration lost on the network with the same client_op_id', async () => {
    const client = fakeClient();
    let n = 0;
    const model = new VersionsModel({
      mapId: 'm1',
      client,
      settle: () => Promise.resolve(true),
      onRestored: () => undefined,
      newId: () => `op-${++n}`,
    });
    client.restoreError = new ApiError({ code: 'network_error', message: 'x', status: 0 });
    await expect(model.restore(version('1'))).rejects.toThrow();
    await model.restore(version('1'));
    client.restoreError = new ApiError({ code: 'not_found', message: 'x', status: 404 });
    await expect(model.restore(version('2'))).rejects.toThrow();
    await model.restore(version('2'));
    expect(client.restoreIds).toEqual(['op-1', 'op-1', 'op-2', 'op-3']);
  });

  it('normalizes labels and names the kinds', () => {
    expect(normalizeVersionLabel('  ')).toBeNull();
    expect(normalizeVersionLabel(null)).toBeNull();
    expect(normalizeVersionLabel('é'.repeat(200))).toHaveLength(VERSION_LABEL_MAX);
    const t = (key: string) => key;
    expect(versionKindLabel('pre_restore', t)).toBe('editor.versions.kinds.pre_restore');
    expect(versionKindLabel('other', t)).toBe('other');
  });

  it('binds Cmd/Ctrl+Shift+S to the named snapshot', () => {
    const key = {
      key: 'S',
      code: 'KeyS',
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    };
    expect(resolveShortcut(key, 'other')).toBe('snapshot');
    expect(resolveShortcut({ ...key, ctrlKey: false, metaKey: true }, 'mac')).toBe('snapshot');
    expect(resolveShortcut({ ...key, shiftKey: false }, 'other')).toBeNull();
  });
});

class FakeTarget implements LifecycleTarget {
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('restoration with the real save queue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('empties the ops queue before calling restore', async () => {
    const map = makeMap({
      id: 'm1',
      revision: 3,
      palette: [null, { asset_id: 'a', name: 'A', url: null, thumb_url: null, autotile: null }],
    });
    const session = new EditorSession({
      grid: gridOf(map),
      floor: map.floors[0]!.id,
      layers: layersFromWire(map.layers),
      palette: paletteFromWire(map.palette),
      editable: false,
    });
    const server = new FakeOpsServer();
    server.revision = 3;
    const saved: number[] = [];
    const sync = new MapSync({
      session,
      map,
      stores: { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() },
      win: new FakeTarget(),
      doc: new FakeTarget(),
      client: {
        chunks: () => Promise.resolve({ records: [], revision: 3 }),
        sendOps: (_id, body, o) => server.send(body, { keepalive: o?.keepalive === true }),
      },
      onSaved: (revision) => saved.push(revision),
    });
    await sync.start(null);
    session.history.execute({
      label: 'paint',
      ops: [{ type: 'tiles.set', floor: '91', layer: 'ground', cells: [[7, 7, 1, 0, 0]] }],
      inverseOps: [],
    });
    expect(sync.queue.hasUnconfirmed).toBe(true);
    const client = fakeClient();
    let cellAtRestore: number | undefined;
    const model = new VersionsModel({
      mapId: 'm1',
      client: {
        ...client,
        restoreVersion: (...args: [string, string, string]) => {
          cellAtRestore = server.cell('ground', 7, 7);
          return client.restoreVersion(...args);
        },
      },
      settle: () => sync.settle(),
      setEditable: (e) => session.setEditable(e),
      onRestored: () => undefined,
    });
    await model.restore(version('1'));
    expect(cellAtRestore).toBe(1); // the paint reached the server before the restoration
    expect(sync.queue.hasUnconfirmed).toBe(false);
    expect(saved).toEqual([4]);
    expect(session.ui.editable).toBe(false);

    // Offline: the restoration is refused, edits come back.
    session.setEditable(true);
    server.defaultMode = 'offline';
    session.history.execute({
      label: 'paint',
      ops: [{ type: 'tiles.set', floor: '91', layer: 'ground', cells: [[8, 8, 1, 0, 0]] }],
      inverseOps: [],
    });
    await expect(model.restore(version('1'))).rejects.toBeInstanceOf(PendingOpsError);
    expect(session.ui.editable).toBe(true);
    sync.dispose();
    expect(await sync.settle()).toBe(false);
  });
});
