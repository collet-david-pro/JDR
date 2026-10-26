import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/api';
import type { SyncClient, SyncHandlers, SyncStatus } from '../../src/lib/realtime/types';
import { SessionRun } from '../../src/lib/sessions/session-run.svelte';
import type { SessionApi } from '../../src/lib/sessions';
import type { TileSource } from '../../src/lib/sessions/scene';
import { event, snapshot } from '../sessions/fixtures';

class FakeSync implements SyncClient {
  handlers: SyncHandlers[] = [];
  status: SyncStatus = { mode: 'sse', state: 'online', leader: true, lastEventId: null };
  subscribe(_c: string[], _s: string, h: SyncHandlers): () => void {
    this.handlers.push(h);
    return () => undefined;
  }
  setActivity(): void {}
  onStatus(): () => void {
    return () => undefined;
  }
  close(): void {}
}

const api = (fail = false): SessionApi => ({
  snapshot: async () => {
    if (fail) throw new ApiError({ code: 'forbidden', message: 'x', status: 403, requestId: null });
    return snapshot('gm', {
      fog: { floor: '35', chunks: [] },
    });
  },
  get: async () => snapshot('gm').session,
  presence: async () => undefined,
  actions: async () => ({ results: [], last_event_id: '1' }),
});

const tiles = { chunks: async () => ({ records: [], revision: 7 }) } as unknown as TileSource;

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('SessionRun', () => {
  it('loads the snapshot and builds the scene', async () => {
    const sync = new FakeSync();
    const run = new SessionRun({ sessionId: '12', userId: '1', api: api(), sync, tiles });
    expect(run.phase).toBe('loading');
    await run.start();
    await flush();
    expect(run.phase).toBe('ready');
    expect(run.state?.session.id).toBe('12');
    expect(run.scene?.mapId).toBe('34');
    expect(run.tilesLoading).toBe(false);
    run.stop();
  });

  it('reports a failing snapshot', async () => {
    const run = new SessionRun({
      sessionId: '12',
      userId: '1',
      api: api(true),
      sync: new FakeSync(),
      tiles,
    });
    await run.start();
    expect(run.phase).toBe('error');
    expect(run.error).toBeInstanceOf(ApiError);
    run.stop();
  });

  it('asks for a reload on a server notice', async () => {
    const sync = new FakeSync();
    const run = new SessionRun({ sessionId: '12', userId: '1', api: api(), sync, tiles });
    await run.start();
    sync.handlers[0]!.onEvent(event(101, 'server.notice', { kind: 'reload', message: 'x' }));
    expect(run.reloadAsked).toBe(true);
    run.stop();
  });
});
