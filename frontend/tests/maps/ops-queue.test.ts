import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapOp } from '../../src/editor/contracts';
import {
  OpsQueue,
  SEND_IDLE_MS,
  SEND_MAX_WAIT_MS,
  type SaveStatus,
} from '../../src/editor/sync/OpsQueue';
import { MAX_CELLS_PER_OP, MAX_OPS_PER_BATCH, MAX_BODY_BYTES } from '../../src/editor/sync/batch';
import { MemoryPendingOpsStore, type PendingBatch } from '../../src/lib/persistence/map-stores';
import { FakeOpsServer, paint } from './fake-server';

let online = true;

function setup(options: { revision?: number; store?: MemoryPendingOpsStore } = {}) {
  const server = new FakeOpsServer();
  server.revision = options.revision ?? 0;
  const store = options.store ?? new MemoryPendingOpsStore();
  const events = {
    rejected: [] as string[],
    reloads: 0,
    confirmed: [] as [number, boolean][],
  };
  let n = 0;
  const queue = new OpsQueue({
    mapId: 'm1',
    revision: server.revision,
    store,
    transport: server,
    isOnline: () => online,
    newId: () => `op-${++n}`,
    onRejected: (_b, e) => events.rejected.push(e.code),
    onReloadRequired: () => events.reloads++,
    onConfirmed: (r, s) => events.confirmed.push([r, s]),
  });
  const statuses: SaveStatus[] = [];
  queue.onStatus((s) => statuses.push(s));
  return { server, store, queue, events, statuses };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  online = true;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('OpsQueue timing', () => {
  it('sends after 1.5 s without new ops', async () => {
    const { server, queue } = setup();
    queue.push([paint([[1, 1, 1]])]);
    await tick(SEND_IDLE_MS - 1);
    expect(server.requests).toHaveLength(0);
    expect(queue.status.state).toBe('saving');
    await tick(1);
    expect(server.requests).toHaveLength(1);
    expect(queue.status).toMatchObject({ state: 'saved', pending: 0 });
  });

  it('sends after 5 s at the latest while ops keep coming', async () => {
    const { server, queue } = setup();
    for (let t = 0; t < 6000; t += 500) {
      queue.push([paint([[t / 500, 0, 1]])]);
      await tick(500);
      if (t + 500 < SEND_MAX_WAIT_MS) expect(server.requests).toHaveLength(0);
    }
    expect(server.requests.length).toBeGreaterThanOrEqual(1);
    expect(server.requests[0]!.body.ops[0]).toMatchObject({ type: 'tiles.set' });
  });
});

describe('OpsQueue persistence', () => {
  it('writes the batch to the store before the request, removes it after confirmation', async () => {
    const { server, store, queue } = setup();
    const seen: PendingBatch[][] = [];
    const send = server.send.bind(server);
    server.send = async (body, opts) => {
      seen.push(await store.list('m1'));
      return send(body, opts);
    };
    queue.push([paint([[2, 3, 1]])]);
    expect(queue.hasUnconfirmed).toBe(true);
    await tick(SEND_IDLE_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]![0]).toMatchObject({ clientOpId: 'op-1', sealed: true, baseRevision: 0 });
    expect(seen[0]![0]!.ops).toEqual([paint([[2, 3, 1]])]);
    expect(store.size).toBe(0);
    expect(queue.hasUnconfirmed).toBe(false);
    expect(queue.serverRevision).toBe(1);
  });

  it('writes the open batch within a second, long before it is sent', async () => {
    const { server, store, queue } = setup();
    queue.push([paint([[0, 0, 1]])]);
    for (let i = 1; i <= 4; i++) {
      await tick(250);
      queue.push([paint([[i, 0, 1]])]);
    }
    // 1 s after the first op: stored, not sent.
    expect(server.requests).toHaveLength(0);
    const stored = await store.list('m1');
    expect(stored).toHaveLength(1);
    expect(stored[0]!.sealed).toBe(false);
    expect(stored[0]!.ops[0]!.type === 'tiles.set' && stored[0]!.ops[0]!.cells.length).toBe(4);
  });

  it('restores the batches of a previous page and sends them with the same identity', async () => {
    const store = new MemoryPendingOpsStore();
    await store.put({
      mapId: 'm1',
      seq: 5,
      clientOpId: 'old-1',
      ops: [paint([[1, 1, 2]])],
      baseRevision: 3,
      sealed: true,
    });
    await store.put({
      mapId: 'm1',
      seq: 6,
      clientOpId: 'old-2',
      ops: [paint([[2, 2, 2]])],
      baseRevision: null,
      sealed: false,
    });
    await store.put({
      mapId: 'other',
      seq: 1,
      clientOpId: 'x',
      ops: [],
      baseRevision: null,
      sealed: false,
    });
    const { server, queue } = setup({ store, revision: 4 });
    const replay = await queue.restore();
    expect(replay).toEqual([
      { seq: 5, ops: [paint([[1, 1, 2]])] },
      { seq: 6, ops: [paint([[2, 2, 2]])] },
    ]);
    expect(queue.status).toMatchObject({ state: 'saving', pending: 2 });
    await queue.flush();
    expect(server.requests.map((r) => [r.body.client_op_id, r.body.base_revision])).toEqual([
      ['old-1', 3],
      ['old-2', 5], // built against the revision answered for old-1
    ]);
    expect(store.size).toBe(1); // the other map's batch only
  });
});

describe('OpsQueue offline and replay', () => {
  it('keeps the batch while offline and replays it identically when the network is back', async () => {
    const { server, store, queue } = setup();
    server.defaultMode = 'offline';
    queue.push([
      paint([
        [1, 1, 1],
        [2, 1, 1],
      ]),
    ]);
    await tick(SEND_IDLE_MS);
    expect(queue.status).toMatchObject({ state: 'offline', pending: 2 });
    expect(store.size).toBe(1);
    // Still offline: retried with backoff, same body every time.
    await tick(1000);
    await tick(2000);
    expect(server.requests.length).toBe(3);
    // New ops while offline go to another batch.
    queue.push([paint([[5, 5, 1]])]);
    expect(queue.status).toMatchObject({ state: 'offline', pending: 3 });
    server.defaultMode = 'ok';
    queue.online();
    await tick(0);
    await tick(SEND_IDLE_MS);
    const ids = server.requests.map((r) => r.body.client_op_id);
    expect(new Set(server.requests.slice(0, 4).map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(ids.at(-1)).toBe('op-2');
    expect(server.applied).toBe(2);
    expect(server.revision).toBe(2);
    expect(store.size).toBe(0);
    expect(queue.status).toMatchObject({ state: 'saved', pending: 0 });
  });

  it('does not apply a batch twice when the answer was lost', async () => {
    const { server, queue, events } = setup();
    server.modes = ['lose-response'];
    queue.push([paint([[1, 1, 1]])]);
    await tick(SEND_IDLE_MS);
    expect(server.applied).toBe(1);
    expect(queue.hasUnconfirmed).toBe(true);
    await tick(1000); // backoff retry, same client_op_id ⇒ memorised answer
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]!.body).toEqual(server.requests[0]!.body);
    expect(server.applied).toBe(1);
    expect(server.revision).toBe(1);
    expect(queue.serverRevision).toBe(1);
    expect(queue.hasUnconfirmed).toBe(false);
    expect(events.confirmed).toEqual([[1, true]]);
  });

  it('sends in order, one request at a time; ops added meanwhile wait in a new batch', async () => {
    const { server, queue } = setup();
    let release!: () => void;
    let calls = 0;
    const send = server.send.bind(server);
    server.send = (body, opts) =>
      new Promise((resolve, reject) => {
        calls++;
        release = () => void send(body, opts).then(resolve, reject);
      });
    queue.push([paint([[1, 1, 1]])]);
    await tick(SEND_IDLE_MS);
    expect(calls).toBe(1);
    queue.push([paint([[1, 1, 2]])]);
    await tick(SEND_IDLE_MS * 2);
    expect(calls).toBe(1);
    release();
    await tick(0);
    await tick(SEND_IDLE_MS);
    expect(calls).toBe(2);
    release();
    await tick(0);
    expect(server.cell('ground', 1, 1)).toBe(2);
    expect(server.requests[0]!.body.base_revision).toBe(0);
    expect(server.requests[1]!.body.base_revision).toBe(1);
  });
});

describe('OpsQueue compaction and limits', () => {
  it('merges successive tiles.set ops (last value per cell) in an unsent batch', async () => {
    const { server, queue } = setup();
    queue.push([
      paint([
        [1, 1, 1],
        [2, 1, 1],
      ]),
    ]);
    queue.push([paint([[1, 1, 3]])]);
    queue.push([{ type: 'palette.add', index: 4, asset_id: 'a' }]);
    queue.push([paint([[3, 3, 4]])]);
    queue.push([paint([[3, 3, 0]], 'decor' as never)]);
    expect(queue.status.pending).toBe(5);
    await queue.flush();
    const ops = server.requests[0]!.body.ops;
    expect(ops).toEqual([
      paint([
        [1, 1, 3],
        [2, 1, 1],
      ]),
      { type: 'palette.add', index: 4, asset_id: 'a' },
      paint([[3, 3, 4]]),
      { ...paint([[3, 3, 0]]), layer: 'decor' },
    ]);
  });

  it('splits tiles.set ops at 5 000 cells and batches at 200 ops / 1 MB', async () => {
    const { server, queue } = setup();
    const cells: [number, number, number][] = [];
    for (let y = 0; y < 400; y++) for (let x = 0; x < 120; x++) cells.push([x, y, 65535]);
    queue.push([paint(cells)]);
    const palette: MapOp[] = [];
    for (let i = 1; i <= MAX_OPS_PER_BATCH + 5; i++) {
      palette.push({ type: 'palette.add', index: i, asset_id: `asset-${i}` });
    }
    queue.push(palette);
    await queue.flush();
    let total = 0;
    for (const { body } of server.requests) {
      expect(body.ops.length).toBeLessThanOrEqual(MAX_OPS_PER_BATCH);
      expect(JSON.stringify(body).length).toBeLessThan(MAX_BODY_BYTES);
      for (const op of body.ops) {
        if (op.type === 'tiles.set') {
          expect(op.cells.length).toBeLessThanOrEqual(MAX_CELLS_PER_OP);
          total += op.cells.length;
        }
      }
    }
    expect(total).toBe(48_000);
    expect(server.requests.length).toBeGreaterThanOrEqual(3);
    expect(new Set(server.requests.map((r) => r.body.client_op_id)).size).toBe(
      server.requests.length,
    );
    // Order kept: every cell sent, palette.add in order.
    const indexes = server.requests.flatMap((r) =>
      r.body.ops.flatMap((op) => (op.type === 'palette.add' ? [op.index] : [])),
    );
    expect(indexes).toEqual(palette.map((_, i) => i + 1));
  });
});

describe('OpsQueue server refusals', () => {
  it('drops and reports a batch refused with 422, then goes on', async () => {
    const { server, store, queue, events } = setup();
    server.modes = [{ status: 422, code: 'validation_failed' }];
    queue.push([paint([[1, 1, 9]])]);
    await queue.flush();
    expect(events.rejected).toEqual(['validation_failed']);
    expect(store.size).toBe(0);
    expect(queue.status).toMatchObject({ state: 'error', error: 'validation_failed' });
    queue.push([paint([[1, 1, 1]])]);
    await queue.flush();
    expect(queue.status.state).toBe('saved');
  });

  it('on 422, drops only the refused op (or cells) and resends the rest under a new id', async () => {
    const { server, store, queue, events } = setup();
    server.modes = [
      {
        status: 422,
        code: 'validation_failed',
        fields: { 'ops.1.asset_id': 'not_found', 'ops.2.cells.1': 'out_of_bounds' },
      },
    ];
    queue.push([paint([[1, 1, 1]])]);
    queue.push([{ type: 'palette.add', index: 2, asset_id: 'gone' }]);
    queue.push([
      paint([
        [2, 2, 1],
        [999, 0, 1],
        [3, 3, 1],
      ]),
    ]);
    await queue.flush();
    expect(server.requests).toHaveLength(2);
    const [first, second] = server.requests.map((r) => r.body);
    expect(second!.client_op_id).not.toBe(first!.client_op_id);
    expect(second!.ops).toEqual([
      paint([[1, 1, 1]]),
      paint([
        [2, 2, 1],
        [3, 3, 1],
      ]),
    ]);
    expect(events.rejected).toEqual(['validation_failed']);
    expect(server.applied).toBe(1);
    expect(store.size).toBe(0);
    expect(queue.hasUnconfirmed).toBe(false);
  });

  it('resends under a new id when the client_op_id is already used elsewhere', async () => {
    const { server, queue, events } = setup();
    server.modes = [
      { status: 422, code: 'validation_failed', fields: { client_op_id: 'already_used' } },
    ];
    queue.push([paint([[1, 1, 1]])]);
    await queue.flush();
    expect(server.requests.map((r) => r.body.client_op_id)).toEqual(['op-1', 'op-2']);
    expect(server.requests[1]!.body.ops).toEqual(server.requests[0]!.body.ops);
    expect(events.rejected).toEqual([]);
    expect(queue.status.state).toBe('saved');
  });

  it('pauses on 409 revision_conflict and asks for a reload; the batch gets a new id', async () => {
    const { server, store, queue, events } = setup();
    server.modes = [{ status: 409, code: 'revision_conflict' }];
    queue.push([paint([[1, 1, 1]])]);
    await queue.flush();
    expect(events.reloads).toBe(1);
    expect(queue.status).toMatchObject({ state: 'error', error: 'revision_conflict' });
    await tick(0);
    const stored = await store.list('m1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ clientOpId: 'op-2', sealed: false });
    queue.resume(7);
    await tick(0);
    expect(server.requests.at(-1)!.body).toMatchObject({ client_op_id: 'op-2', base_revision: 7 });
    expect(queue.status.state).toBe('saved');
  });

  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
  ])('pauses on %i and keeps the ops locally', async (status, code) => {
    const { server, store, queue } = setup();
    server.modes = [{ status, code }];
    queue.push([paint([[1, 1, 1]])]);
    await queue.flush();
    expect(queue.status).toMatchObject({ state: 'error', error: code });
    expect(store.size).toBe(1);
    expect(queue.hasUnconfirmed).toBe(true);
    await tick(60_000);
    expect(server.requests).toHaveLength(1);
  });

  it('splits a batch answered 413 into two new batches', async () => {
    const { server, queue } = setup();
    server.modes = [{ status: 413, code: 'payload_too_large' }];
    queue.push([
      paint([
        [1, 1, 1],
        [2, 2, 1],
        [3, 3, 1],
      ]),
    ]);
    await queue.flush();
    expect(server.requests).toHaveLength(3);
    expect(server.applied).toBe(2);
    expect([2, 3].map((x) => server.cell('ground', x, x))).toEqual([1, 1]);
  });

  it('shows "conflict resolved" for a while when the answer carries conflicts', async () => {
    const { server, queue } = setup();
    server.conflicts = [{ uid: 'o1' }];
    queue.push([paint([[1, 1, 1]])]);
    await queue.flush();
    expect(queue.status.state).toBe('conflict');
    await tick(4000);
    expect(queue.status.state).toBe('saved');
  });
});

describe('OpsQueue on page hide', () => {
  it('sends at once with keepalive when the body is ≤ 64 KB', async () => {
    const { server, queue } = setup();
    queue.push([paint([[1, 1, 1]])]);
    queue.flushOnHide();
    await tick(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.keepalive).toBe(true);
  });

  it('sends a larger batch without keepalive (it stays stored if the page dies)', async () => {
    const { server, store, queue } = setup();
    const cells: [number, number, number][] = [];
    for (let i = 0; i < 6000; i++) cells.push([i % 400, Math.floor(i / 400), 1]);
    queue.push([paint(cells)]);
    let stored: PendingBatch[] = [];
    const send = server.send.bind(server);
    server.send = async (body, opts) => {
      stored = await store.list('m1');
      return send(body, opts);
    };
    queue.flushOnHide();
    await tick(0);
    expect(server.requests[0]!.keepalive).toBe(false);
    expect(stored[0]!.sealed).toBe(true);
  });

  it('reports a memory-only store', () => {
    const { queue } = setup();
    expect(queue.status.durable).toBe(false);
  });
});
