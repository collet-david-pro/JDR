import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapObject, MapOp, PlacedToken } from '../../src/editor/contracts';
import { History } from '../../src/editor/history/History';
import { OpsQueue } from '../../src/editor/sync/OpsQueue';
import type { OpsTransport } from '../../src/editor/sync/OpsQueue';
import { MemoryPendingOpsStore } from '../../src/lib/persistence/map-stores';
import type { MapOpConflict, MapOpsRequest, MapOpsResult } from '../../src/lib/types';
import { light, makeSceneDoc, placed, wall } from '../editor/scene-helpers';
import { TransportFailure } from './fake-server';

/** In-memory server of the P5 object / token ops (rev rule and individual conflicts). */
class FakeSceneServer implements OpsTransport {
  revision = 0;
  offline = false;
  readonly objects = new Map<string, MapObject>();
  readonly tokens = new Map<string, PlacedToken>();
  readonly processed = new Map<string, MapOpsResult>();
  readonly requests: MapOpsRequest[] = [];
  fogOps = 0;

  send(body: MapOpsRequest): Promise<MapOpsResult> {
    this.requests.push(structuredClone(body));
    if (this.offline) return Promise.reject(new TransportFailure('network_error', 0));
    const known = this.processed.get(body.client_op_id);
    if (known !== undefined) return Promise.resolve(known);
    const conflicts: MapOpConflict[] = [];
    let applied = 0;
    body.ops.forEach((op, i) => {
      const c = this.apply(op as MapOp, i);
      if (c === null) applied++;
      else conflicts.push(c);
    });
    if (applied > 0) this.revision++;
    const result = { revision: this.revision, applied, conflicts };
    this.processed.set(body.client_op_id, result);
    return Promise.resolve(result);
  }

  /** Someone else edits an object (rev + 1). */
  foreignUpdate(uid: string, patch: Partial<MapObject>): void {
    const o = this.objects.get(uid)!;
    this.objects.set(uid, { ...o, ...patch, rev: o.rev + 1 } as MapObject);
  }

  private apply(op: MapOp, i: number): MapOpConflict | null {
    switch (op.type) {
      case 'object.add':
        if (this.objects.has(op.object.uid)) {
          const current = this.objects.get(op.object.uid)!;
          return { op_index: i, kind: 'object', uid: op.object.uid, reason: 'exists', current };
        }
        this.objects.set(op.object.uid, { ...op.object, rev: 1 });
        return null;
      case 'object.update': {
        const cur = this.objects.get(op.uid);
        if (cur === undefined) {
          return { op_index: i, kind: 'object', uid: op.uid, reason: 'gone', current: null };
        }
        if (op.rev < cur.rev) {
          return { op_index: i, kind: 'object', uid: op.uid, reason: 'stale', current: cur };
        }
        this.objects.set(op.uid, { ...cur, ...op.patch, rev: cur.rev + 1 } as MapObject);
        return null;
      }
      case 'object.remove':
        this.objects.delete(op.uid);
        return null;
      case 'maptoken.add':
        this.tokens.set(op.token.uid, { ...op.token, rev: 1 });
        return null;
      case 'maptoken.update': {
        const cur = this.tokens.get(op.uid);
        if (cur === undefined) {
          return { op_index: i, kind: 'maptoken', uid: op.uid, reason: 'gone', current: null };
        }
        if (op.rev < cur.rev) {
          return { op_index: i, kind: 'maptoken', uid: op.uid, reason: 'stale', current: cur };
        }
        this.tokens.set(op.uid, { ...cur, ...op.patch, rev: cur.rev + 1 });
        return null;
      }
      case 'maptoken.remove':
        this.tokens.delete(op.uid);
        return null;
      case 'fog.reveal':
      case 'fog.hide':
        this.fogOps++;
        return null;
      default:
        return null;
    }
  }
}

function setup() {
  const server = new FakeSceneServer();
  const doc = makeSceneDoc();
  const history = new History(doc);
  const store = new MemoryPendingOpsStore();
  let n = 0;
  const conflicts: MapOpConflict[][] = [];
  const queue = new OpsQueue({
    mapId: 'm1',
    revision: 0,
    store,
    transport: server,
    isOnline: () => !server.offline,
    newId: () => `op-${++n}`,
    onConflicts: (c) => {
      conflicts.push([...c]);
      for (const x of c) {
        if (x.kind === 'object') doc.replaceObject(x.uid, x.current);
        else doc.replaceToken(x.uid, x.current);
      }
    },
  });
  history.onOps((ops) => queue.push(ops));
  const exec = (ops: MapOp[]) => history.execute({ label: 'x', ops, inverseOps: [] });
  return { server, doc, history, queue, store, conflicts, exec };
}

/** Local objects / tokens equal the server ones (revs included). */
function expectInSync(env: ReturnType<typeof setup>): void {
  const sort = <T extends { uid: string }>(l: T[]) => l.sort((a, b) => (a.uid < b.uid ? -1 : 1));
  expect(sort([...env.doc.objects()]).map((o) => ({ ...o }))).toEqual(
    sort([...env.server.objects.values()]).map((o) => ({ ...o })),
  );
  expect(sort([...env.doc.tokens()]).map((t) => ({ ...t }))).toEqual(
    sort([...env.server.tokens.values()]).map((t) => ({ ...t })),
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('OpsQueue with P5 ops', () => {
  it('offline edits, undo and redo replay with the right revs (no conflict)', async () => {
    const env = setup();
    env.server.offline = true;
    env.exec([
      {
        type: 'object.add',
        object: wall('w', [
          [0, 0],
          [4, 0],
        ]),
      },
    ]);
    env.exec([{ type: 'object.update', uid: 'w', rev: 1, patch: { locked: true } }]);
    env.exec([{ type: 'maptoken.add', token: placed('k', 1.5, 1.5) }]);
    env.exec([{ type: 'maptoken.update', uid: 'k', rev: 1, patch: { x: 3.5 } }]);
    env.history.undo();
    env.history.redo();
    env.exec([{ type: 'object.update', uid: 'w', rev: 1, patch: { sort_order: 3 } }]);
    await env.queue.flush();
    expect(env.queue.status.state).toBe('offline');
    env.server.offline = false;
    env.queue.online();
    await vi.runAllTimersAsync();
    await env.queue.flush();
    expect(env.queue.hasUnconfirmed).toBe(false);
    expect(env.conflicts).toEqual([]);
    expectInSync(env);
    expect(env.doc.object('w')!.rev).toBe(3);
    expect(env.doc.token('k')!.rev).toBe(4);
  });

  it('a replayed batch (lost answer) is idempotent', async () => {
    const env = setup();
    env.exec([{ type: 'object.add', object: light('l', 2, 2) }]);
    const send = env.server.send.bind(env.server);
    let lose = true;
    env.server.send = async (body) => {
      const r = await send(body);
      if (lose) {
        lose = false;
        throw new TransportFailure('network_error', 0);
      }
      return r;
    };
    await env.queue.flush();
    await vi.runAllTimersAsync();
    await env.queue.flush();
    expect(env.server.requests.map((r) => r.client_op_id)).toEqual(['op-1', 'op-1']);
    expect(env.server.revision).toBe(1);
    expectInSync(env);
  });

  it('a stale update is refused individually: the server state replaces the local one', async () => {
    const env = setup();
    env.exec([
      {
        type: 'object.add',
        object: wall('w', [
          [0, 0],
          [4, 0],
        ]),
      },
      { type: 'object.add', object: light('l', 2, 2) },
    ]);
    await env.queue.flush();
    env.server.foreignUpdate('w', { sort_order: 9 });
    env.exec([
      { type: 'object.update', uid: 'w', rev: 1, patch: { locked: true } },
      { type: 'object.update', uid: 'l', rev: 1, patch: { locked: true } },
    ]);
    await env.queue.flush();
    expect(env.conflicts).toHaveLength(1);
    expect(env.conflicts[0]![0]).toMatchObject({ op_index: 0, uid: 'w', reason: 'stale' });
    expect(env.queue.status.state).toBe('conflict');
    expectInSync(env);
    expect(env.doc.object('w')).toMatchObject({ sort_order: 9, locked: false, rev: 2 });
    expect(env.doc.object('l')).toMatchObject({ locked: true, rev: 2 });
    // Undo of the refused edit leaves the object as the server has it.
    env.history.undo();
    expect(env.history.lastUndoSkipped).toBe(1);
    expect(env.doc.object('w')).toMatchObject({ sort_order: 9 });
  });

  it('an update of an object deleted meanwhile: removal wins', async () => {
    const env = setup();
    env.exec([
      {
        type: 'object.add',
        object: wall('w', [
          [0, 0],
          [4, 0],
        ]),
      },
    ]);
    await env.queue.flush();
    env.server.objects.delete('w');
    env.exec([{ type: 'object.update', uid: 'w', rev: 1, patch: { locked: true } }]);
    await env.queue.flush();
    expect(env.conflicts[0]![0]).toMatchObject({ reason: 'gone', current: null });
    expect(env.doc.object('w')).toBeUndefined();
  });

  it('fog ops go through the queue like the others', async () => {
    const env = setup();
    const { fogOps } = await import('../../src/editor/model/fog-wire');
    const { fogRasterizers } = await import('../../src/vision/index');
    env.history.applyUntracked(fogOps('fog.reveal', 'f1', fogRasterizers.rect(0, 0, 3, 3, 64, 64)));
    await env.queue.flush();
    expect(env.server.fogOps).toBe(1);
    expect(env.history.state.undoSize).toBe(0);
  });
});
