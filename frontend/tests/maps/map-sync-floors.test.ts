import { describe, expect, it, vi } from 'vitest';
import { MapSync } from '../../src/editor/sync/MapSync';
import { gridOf } from '../../src/editor/sync/wire';
import { EditorSession } from '../../src/editor/ui/session';
import { MemoryChunkCacheStore, MemoryPendingOpsStore } from '../../src/lib/persistence/map-stores';
import type { MapOpsResult } from '../../src/lib/types';
import { light } from '../editor/scene-helpers';
import { makeMap } from './fixtures';

const floors = [
  { id: '10', uid: 'ground', level: 0, name: 'RdC', sort_order: 0 },
  { id: '11', uid: 'upper', level: 1, name: 'Étage', sort_order: 1 },
];

function setup() {
  const map = makeMap({
    id: 'm1',
    floors,
    objects: [{ ...light('l', 2, 2), floor: '11' }],
  });
  const session = new EditorSession({
    grid: gridOf(map),
    floor: 'ground',
    floors: map.floors,
    editable: false,
  });
  const stores = { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() };
  const chunks = vi.fn((_id: string, _q: { floor: string }) =>
    Promise.resolve({ records: [], revision: 0 }),
  );
  const fog = vi.fn((_id: string, floor: string) => Promise.resolve({ floor, chunks: [] }));
  const sendOps = vi.fn((_id: string, body: { ops: readonly unknown[] }): Promise<MapOpsResult> =>
    Promise.resolve({ revision: 1, applied: body.ops.length, conflicts: [] }),
  );
  const sync = new MapSync({ session, map, stores, client: { chunks, fog, sendOps } });
  return { session, stores, chunks, fog, sync };
}

describe('MapSync with several floors', () => {
  it('loads the shown floor first and the others only when asked', async () => {
    const { session, chunks, fog, sync } = setup();
    await sync.start(null);
    expect(chunks.mock.calls.map((c) => c[1].floor)).toEqual(['ground']);
    expect(fog.mock.calls.map((c) => c[1])).toEqual(['ground']);
    // The scene of every floor comes with the map.
    expect(session.doc.objectsOf('upper').map((o) => o.uid)).toEqual(['l']);
    expect(session.doc.floorMeta('upper')?.loaded).toBe(false);

    expect(await session.floors.select('upper')).toBe(true);
    expect(chunks.mock.calls.map((c) => c[1].floor)).toEqual(['ground', 'upper']);
    expect(fog.mock.calls.map((c) => c[1])).toEqual(['ground', 'upper']);
    expect(session.doc.floor).toBe('upper');
    expect(session.doc.floorMeta('upper')?.loaded).toBe(true);
    sync.dispose();
  });

  it('loads a floor before replaying ops left in the queue for it', async () => {
    const { session, stores, chunks, sync } = setup();
    await stores.pending.put({
      mapId: 'm1',
      seq: 1,
      clientOpId: 'left',
      ops: [{ type: 'tiles.set', floor: 'upper', layer: 'ground', cells: [[1, 1, 0, 0, 0]] }],
      baseRevision: null,
      sealed: false,
    });
    const started = await sync.start(null);
    expect(started.replayFailed).toBe(0);
    expect(chunks.mock.calls.map((c) => c[1].floor)).toContain('upper');
    expect(session.doc.floorMeta('upper')?.loaded).toBe(true);
    sync.dispose();
  });

  it('refuses to delete a floor it cannot read, and deletes it once it can', async () => {
    const { session, chunks, sync } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await sync.start(null);
    chunks.mockRejectedValueOnce(new Error('offline'));
    expect(await session.floors.remove('upper')).toBe(false);
    expect(session.doc.floorMeta('upper')).toBeDefined();
    expect(await session.floors.remove('upper')).toBe(true);
    expect(session.doc.floorMeta('upper')).toBeUndefined();
    sync.dispose();
  });
});
