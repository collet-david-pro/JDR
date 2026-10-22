import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkKey, TileLayerId } from '../../src/editor/contracts';
import { allChunkKeys, loadMapChunks, visibleChunkKeys } from '../../src/editor/sync/chunk-loader';
import { MapSync, type LifecycleTarget } from '../../src/editor/sync/MapSync';
import { gridOf, layersFromWire, paletteFromWire } from '../../src/editor/sync/wire';
import { EditorSession } from '../../src/editor/ui/session';
import { createChunkCells, encodeChunk } from '../../src/formats/chunk-codec';
import { encodeChunkStream, parseChunkStream } from '../../src/formats/chunk-stream';
import { MapsTabModel } from '../../src/lib/maps/maps-tab.svelte';
import {
  MemoryChunkCacheStore,
  MemoryPendingOpsStore,
  type MapStores,
} from '../../src/lib/persistence/map-stores';
import type { MapDetail, MapOpsRequest } from '../../src/lib/types';
import { makeDoc } from '../editor/helpers';
import { FakeOpsServer } from './fake-server';
import { makeMap, makeSummary } from './fixtures';

async function block(layer: TileLayerId, index: number): Promise<Uint8Array> {
  const cells = createChunkCells();
  cells[0] = index;
  return (await encodeChunk(layer, cells))!;
}

/** GET /maps/{id}/chunks over a set of stored blocks. */
function chunkServer(
  blocks: { cx: number; cy: number; layer: TileLayerId; data: Uint8Array }[],
  revision = 0,
) {
  const requests: (readonly ChunkKey[] | null)[] = [];
  const fetch = (cells: readonly ChunkKey[] | null) => {
    requests.push(cells);
    const wanted = cells === null ? null : new Set<string>(cells);
    const stream = encodeChunkStream(
      blocks.filter((b) => wanted === null || wanted.has(`${b.cx}:${b.cy}`)),
    );
    return Promise.resolve({ records: parseChunkStream(stream), revision });
  };
  return { fetch, requests };
}

describe('chunk loading', () => {
  it('computes the visible blocks of a camera', () => {
    const grid = { width: 200, height: 100, cellPx: 50, unitLabel: 'ft', unitPerCell: 5 };
    expect(allChunkKeys(grid)).toHaveLength(7 * 4);
    // 640×320 px at zoom 1 = 12.8 × 6.4 cells around (40, 40).
    expect(visibleChunkKeys(grid, { x: 40, y: 40, zoom: 1 }, { width: 640, height: 320 })).toEqual([
      '1:1',
    ]);
    expect(
      visibleChunkKeys(grid, { x: 0, y: 0, zoom: 0.05 }, { width: 1000, height: 800 }),
    ).toHaveLength(28);
  });

  it('loads the visible blocks first, then the others nearest first, and fills the cache', async () => {
    const doc = makeDoc(160, 96, 4); // 5 × 3 blocks
    const blocks = [
      { cx: 2, cy: 1, layer: 'ground' as const, data: await block('ground', 1) },
      { cx: 4, cy: 2, layer: 'decor' as const, data: await block('decor', 3) },
      { cx: 0, cy: 0, layer: 'terrain' as const, data: await block('terrain', 2) },
    ];
    const server = chunkServer(blocks, 5);
    const cache = new MemoryChunkCacheStore();
    const progress: number[] = [];
    const result = await loadMapChunks({
      doc,
      mapId: 'm',
      floor: 'f1',
      revision: 5,
      fetch: server.fetch,
      cache,
      visible: ['2:1', '3:1'],
      groupSize: 6,
      onProgress: (done) => progress.push(done),
    });
    expect(result).toEqual({ source: 'network', errors: 0, revisionMismatch: false });
    expect(server.requests[0]).toEqual(['2:1', '3:1']);
    expect(server.requests.slice(1).flat()).toHaveLength(13);
    expect(server.requests[1]!.slice(0, 2)).toEqual(['2:0', '3:0']); // nearest to (2.5, 1)
    expect(progress).toEqual([0, 1, 2, 3, 4]);
    expect(doc.getCell('ground', 64, 32).index).toBe(1);
    expect(doc.getCell('decor', 128, 64).index).toBe(3);
    expect((await cache.get('m'))?.chunks).toHaveLength(3);

    // Same revision: from the cache, no request.
    const doc2 = makeDoc(160, 96, 4);
    const again = await loadMapChunks({
      doc: doc2,
      mapId: 'm',
      floor: 'f1',
      revision: 5,
      fetch: server.fetch,
      cache,
    });
    expect(again.source).toBe('cache');
    expect(server.requests).toHaveLength(4);
    expect(doc2.getCell('terrain', 0, 0).index).toBe(2);
  });

  it('does not cache blocks answered with another revision', async () => {
    const doc = makeDoc(32, 32, 4);
    const server = chunkServer([], 9);
    const cache = new MemoryChunkCacheStore();
    const r = await loadMapChunks({
      doc,
      mapId: 'm',
      floor: 'f1',
      revision: 5,
      fetch: server.fetch,
      cache,
    });
    expect(r.revisionMismatch).toBe(true);
    expect(server.requests).toEqual([null]);
    expect(await cache.get('m')).toBeNull();
  });
});

class FakeTarget implements LifecycleTarget {
  visibilityState = 'visible';
  private readonly listeners = new Map<string, Set<(e: Event) => void>>();
  addEventListener(type: string, fn: (e: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): Event {
    const event = new Event(type, { cancelable: true });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function makeSession(map: MapDetail): EditorSession {
  return new EditorSession({
    grid: gridOf(map),
    floor: map.floors[0]!.id,
    layers: layersFromWire(map.layers),
    palette: paletteFromWire(map.palette),
    editable: false,
  });
}

describe('MapSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const map = makeMap({
    id: 'm1',
    revision: 3,
    palette: [null, { asset_id: 'a', name: 'A', url: null, thumb_url: null, autotile: null }],
  });

  async function start(stores: MapStores, server: FakeOpsServer) {
    const session = makeSession(map);
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const blocks = chunkServer(
      [{ cx: 0, cy: 0, layer: 'ground', data: await block('ground', 1) }],
      3,
    );
    const sync = new MapSync({
      session,
      map,
      stores,
      win,
      doc,
      client: {
        chunks: (_id, q) =>
          blocks.fetch((q.cells as readonly ChunkKey[] | undefined) ?? null) as never,
        sendOps: (_id, body: MapOpsRequest, o) =>
          server.send(body, { keepalive: o?.keepalive === true }),
      },
    });
    const started = await sync.start(null);
    return { session, sync, win, doc, started };
  }

  it('loads, replays the local queue, then saves the history ops', async () => {
    const stores = { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() };
    await stores.pending.put({
      mapId: 'm1',
      seq: 1,
      clientOpId: 'left-over',
      ops: [{ type: 'tiles.set', floor: '91', layer: 'ground', cells: [[5, 5, 1, 0, 0]] }],
      baseRevision: null,
      sealed: false,
    });
    const server = new FakeOpsServer();
    server.revision = 3;
    const { session, sync, win, started } = await start(stores, server);
    expect(started).toMatchObject({ replayed: 1, replayFailed: 0 });
    expect(session.ui.editable).toBe(true);
    expect(session.doc.getCell('ground', 0, 0).index).toBe(1); // server block
    expect(session.doc.getCell('ground', 5, 5).index).toBe(1); // replayed op
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests[0]!.body.client_op_id).toBe('left-over');

    session.history.execute({
      label: 'paint',
      ops: [{ type: 'tiles.set', floor: '91', layer: 'ground', cells: [[7, 7, 1, 0, 0]] }],
      inverseOps: [],
    });
    expect(session.ui.save).toMatchObject({ state: 'saving', pending: 1 });
    // beforeunload is refused while ops are unconfirmed.
    expect(win.fire('beforeunload').defaultPrevented).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.cell('ground', 7, 7)).toBe(1);
    expect(session.ui.save).toMatchObject({ state: 'saved', pending: 0 });
    expect(win.fire('beforeunload').defaultPrevented).toBe(false);
    sync.dispose();
    expect(win.count('online')).toBe(0);
  });

  it('gives a free palette index to a replayed palette.add whose index was taken', async () => {
    const stores = { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() };
    await stores.pending.put({
      mapId: 'm1',
      seq: 1,
      clientOpId: 'stale',
      baseRevision: 2,
      sealed: true,
      ops: [
        { type: 'palette.add', index: 1, asset_id: 'b' }, // index 1 is now asset 'a'
        { type: 'tiles.set', floor: '91', layer: 'ground', cells: [[4, 4, 1, 0, 0]] },
        { type: 'tiles.set', floor: 'nope', layer: 'ground', cells: [[1, 1, 1, 0, 0]] },
      ],
    });
    const server = new FakeOpsServer();
    server.revision = 3;
    const { session, sync, started } = await start(stores, server);
    expect(started).toMatchObject({ replayed: 2, replayFailed: 1 });
    expect(session.doc.palette[2]).toMatchObject({ assetId: 'b' });
    expect(session.doc.getCell('ground', 4, 4).index).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    const sent = server.requests[0]!.body;
    expect(sent.client_op_id).not.toBe('stale');
    expect(sent.base_revision).toBe(3);
    expect(sent.ops).toEqual([
      { type: 'palette.add', index: 2, asset_id: 'b' },
      { type: 'tiles.set', floor: '91', layer: 'ground', cells: [[4, 4, 2, 0, 0]] },
    ]);
    sync.dispose();
  });

  it('follows the network and the page visibility', async () => {
    const stores = { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() };
    const server = new FakeOpsServer();
    server.revision = 3;
    const { session, sync, win, doc } = await start(stores, server);
    server.defaultMode = 'offline';
    const paint = (x: number) =>
      session.history.execute({
        label: 'paint',
        ops: [{ type: 'tiles.set', floor: '91', layer: 'ground', cells: [[x, 1, 1, 0, 0]] }],
        inverseOps: [],
      });
    paint(1);
    win.fire('offline');
    expect(session.ui.save).toMatchObject({ state: 'offline', pending: 1 });
    paint(2);
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests.at(-1)!.keepalive).toBe(true);
    expect(session.ui.save?.state).toBe('offline');
    server.defaultMode = 'ok';
    win.fire('online');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.ui.save).toMatchObject({ state: 'saved', pending: 0 });
    expect(server.applied).toBe(1);
    expect([server.cell('ground', 1, 1), server.cell('ground', 2, 1)]).toEqual([1, 1]);
    sync.dispose();
  });

  it('refreshes the chunk cache once everything is saved', async () => {
    const stores = { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() };
    const server = new FakeOpsServer();
    server.revision = 3;
    const { session, sync } = await start(stores, server);
    expect((await stores.chunks.get('m1'))?.revision).toBe(3);
    session.history.execute({
      label: 'paint',
      ops: [{ type: 'tiles.set', floor: '91', layer: 'decor', cells: [[33, 1, 1, 0, 0]] }],
      inverseOps: [],
    });
    await vi.advanceTimersByTimeAsync(1500 + 3000);
    // Compression streams run on the real event loop.
    vi.useRealTimers();
    await vi.waitFor(async () => expect((await stores.chunks.get('m1'))?.revision).toBe(4));
    const cached = await stores.chunks.get('m1');
    expect(cached?.chunks.map((c) => `${c.layer}/${c.key}`).sort()).toEqual([
      'decor/1:0',
      'ground/0:0',
    ]);
    sync.dispose();
  });
});

describe('MapsTabModel', () => {
  it('loads, creates, renames, duplicates, trashes and restores', async () => {
    const calls: string[] = [];
    let list = [makeSummary({ id: '1', name: 'A' })];
    const client = {
      list: (_g: string, state = 'active') => {
        calls.push(`list:${state}`);
        return Promise.resolve(state === 'trash' ? [] : list);
      },
      create: () => Promise.resolve(makeMap({ id: '2', name: 'B' })),
      update: (id: string, p: { name?: string }) =>
        Promise.resolve(makeSummary({ id, name: p.name ?? '' })),
      remove: () => Promise.resolve(),
      restore: () => Promise.resolve(),
      duplicate: () => Promise.resolve(makeMap({ id: '3', name: 'A (copie)' })),
    };
    const model = new MapsTabModel(client, '7');
    await model.load();
    expect(model.status).toBe('ready');
    await model.create({ name: 'B', width: 2, height: 2 });
    await model.update('1', { name: 'A2' });
    await model.duplicate('1');
    expect(model.maps.map((m) => m.name)).toEqual(['A2', 'B', 'A (copie)']);
    expect(model.maps[1]!.grid).toEqual({ width: 40, height: 30 });
    await model.trash('2');
    expect(model.maps.map((m) => m.id)).toEqual(['1', '3']);
    list = [];
    await model.load('trash');
    expect(model.view).toBe('trash');
    expect(calls).toEqual(['list:active', 'list:trash']);
  });
});
