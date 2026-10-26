import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api';
import type {
  SyncActivity,
  SyncClient,
  SyncHandlers,
  SyncStatus,
  WireEvent,
} from '../../src/lib/realtime/types';
import {
  PRESENCE_MS,
  SessionSync,
  type SessionApi,
  type SessionEffect,
  type SessionState,
} from '../../src/lib/sessions';
import type { SessionSnapshot } from '../../src/lib/sessions/types';
import { event, session, snapshot } from './fixtures';

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

interface Sub {
  channels: string[];
  since: string;
  h: SyncHandlers;
  active: boolean;
}

class FakeSync implements SyncClient {
  subs: Sub[] = [];
  activities: SyncActivity[] = [];
  log: string[] = [];
  status: SyncStatus = { mode: 'sse', state: 'online', leader: true, lastEventId: null };

  subscribe(channels: string[], since: string, h: SyncHandlers): () => void {
    const sub: Sub = { channels, since, h, active: true };
    this.subs.push(sub);
    this.log.push(`sub ${channels.join('+')}@${since}`);
    return () => {
      sub.active = false;
      this.log.push(`unsub ${channels.join('+')}@${since}`);
    };
  }

  setActivity(a: SyncActivity): void {
    this.activities.push(a);
  }

  onStatus(): () => void {
    return () => undefined;
  }

  close(): void {}

  get live(): Sub[] {
    return this.subs.filter((s) => s.active);
  }

  /** Delivers like the real client: only to active subscriptions. */
  emit(e: WireEvent): void {
    for (const s of this.live) s.h.onEvent(e);
  }
}

class FakeApi implements SessionApi {
  snapshots: (() => Promise<SessionSnapshot>)[] = [];
  snapshotCalls = 0;
  presenceCalls = 0;
  getCalls = 0;
  header = session('player', { state: 'paused', last_event_id: '150' });

  snapshot = (): Promise<SessionSnapshot> => {
    this.snapshotCalls++;
    const next = this.snapshots.shift();
    return next === undefined ? Promise.resolve(snapshot('gm')) : next();
  };

  get = () => {
    this.getCalls++;
    return Promise.resolve(this.header);
  };

  presence = () => {
    this.presenceCalls++;
    return Promise.resolve();
  };

  actions = () => Promise.resolve({ results: [], last_event_id: '1' });
}

let sync: FakeSync;
let api: FakeApi;
let states: SessionState[];
let effects: SessionEffect[];
let errors: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  sync = new FakeSync();
  api = new FakeApi();
  states = [];
  effects = [];
  errors = [];
});
afterEach(() => {
  vi.useRealTimers();
});

function make(userId = '1') {
  return new SessionSync({
    sessionId: '12',
    userId,
    api,
    sync,
    random: () => 0.5,
    onState: (s) => states.push(s),
    onEffect: (e) => effects.push(e),
    onError: (e) => errors.push(e),
  });
}

describe('start', () => {
  it('loads the snapshot, subscribes from its cursor (GM: session and map channels) and pings the presence', async () => {
    const s = make();
    const state = await s.start();
    expect(state.lastEventId).toBe('100');
    expect(sync.log).toEqual(['sub session:12+map:34@100']);
    expect(api.presenceCalls).toBe(1);
    await tick(PRESENCE_MS);
    expect(api.presenceCalls).toBe(2);
    await tick(PRESENCE_MS * 2);
    expect(api.presenceCalls).toBe(4);
    expect(states).toHaveLength(1);
    s.stop();
    await tick(PRESENCE_MS * 3);
    expect(api.presenceCalls).toBe(4);
  });

  it('a player follows the session channel only', async () => {
    api.snapshots.push(() => Promise.resolve(snapshot('player')));
    await make('7').start();
    expect(sync.log).toEqual(['sub session:12@100']);
  });

  it('applies the events to the state and notifies once per tick', async () => {
    const s = make();
    await s.start();
    await tick(0);
    states.length = 0;
    sync.emit(event(101, 'maptoken.moved', { uid: 't1', x: 8, y: 8, view: 'gm' }));
    sync.emit(event(102, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'gm' }));
    sync.emit(event(103, 'player.ready', { user_id: '8', ready: true }));
    await tick(0);
    expect(states).toHaveLength(1);
    expect(s.state!.tokens['t1']).toMatchObject({ x: 9, y: 9 });
    expect(s.state!.lastEventId).toBe('103');
    // Replayed ids change nothing.
    sync.emit(event(102, 'maptoken.moved', { uid: 't1', x: 1, y: 1, view: 'gm' }));
    expect(s.state!.tokens['t1']).toMatchObject({ x: 9 });
  });

  it('forwards the effects (fog, text to read, tile blocks)', async () => {
    const s = make();
    await s.start();
    sync.emit(
      event(101, 'fog.updated', {
        map_id: '34',
        floor_id: '35',
        op: 'reveal',
        chunks: [[0, 0, 'QQ']],
        view: 'gm',
      }),
    );
    sync.emit(event(102, 'note.read_aloud', { title: 'T', body: 'B' }));
    expect(effects.map((e) => e.kind)).toEqual(['fog', 'read_aloud']);
    s.stop();
  });

  it('start rejects on a refusal and retries network failures with backoff', async () => {
    api.snapshots.push(() =>
      Promise.reject(new ApiError({ code: 'forbidden', message: 'x', status: 403 })),
    );
    await expect(make().start()).rejects.toMatchObject({ status: 403 });

    api.snapshots.push(
      () => Promise.reject(new ApiError({ code: 'network_error', message: 'x', status: 0 })),
      () => Promise.reject(new ApiError({ code: 'network_error', message: 'x', status: 0 })),
    );
    const before = api.snapshotCalls;
    const started = make().start();
    await tick(5000);
    await started;
    expect(api.snapshotCalls - before).toBe(3);
  });
});

describe('reloads', () => {
  it('map.changed (GM): snapshot reloaded, new channels subscribed before the old ones are dropped', async () => {
    const s = make();
    await s.start();
    api.snapshots.push(() =>
      Promise.resolve(
        snapshot('gm', {
          session: session('gm', { current_map_id: '35', last_event_id: '120' }),
          map: { ...snapshot('gm').map!, id: '35' },
          last_event_id: '120',
        }),
      ),
    );
    sync.emit(event(110, 'map.changed', { map_id: '35', floor_id: '36' }));
    await tick(0);
    expect(api.snapshotCalls).toBe(2);
    expect(sync.log).toEqual([
      'sub session:12+map:34@100',
      'sub session:12+map:35@120',
      'unsub session:12+map:34@100',
    ]);
    expect(s.state!.map?.id).toBe('35');
    expect(s.state!.lastEventId).toBe('120');
    // Late events of the dropped subscription are ignored.
    sync.subs[0]!.h.onEvent(event(130, 'player.ready', { user_id: '8', ready: true }));
    expect(s.state!.lastEventId).toBe('120');
  });

  it('reloads are coalesced: one request at a time, one more when asked meanwhile', async () => {
    const s = make();
    await s.start();
    let release: (v: SessionSnapshot) => void = () => undefined;
    api.snapshots.push(() => new Promise((resolve) => (release = resolve)));
    const first = s.reload();
    const second = s.reload();
    const third = s.reload();
    await tick(0);
    expect(api.snapshotCalls).toBe(2);
    release(snapshot('gm'));
    await tick(0);
    await Promise.all([first, second, third]);
    expect(api.snapshotCalls).toBe(3);
  });

  it('onGone (410) reloads the snapshot and subscribes again from its cursor', async () => {
    const s = make();
    await s.start();
    api.snapshots.push(() =>
      Promise.resolve(
        snapshot('gm', { last_event_id: '900', session: session('gm', { last_event_id: '900' }) }),
      ),
    );
    sync.subs[0]!.h.onGone('session:12');
    await tick(0);
    expect(api.snapshotCalls).toBe(2);
    expect(sync.live).toHaveLength(1);
    expect(sync.live[0]!.since).toBe('900');
    expect(s.state!.lastEventId).toBe('900');
  });

  it('a player entering running reloads the snapshot (D5); a failed reload is reported', async () => {
    api.snapshots.push(() =>
      Promise.resolve(
        snapshot('player', {
          session: session('player', { state: 'lobby' }),
          map: null,
          tokens: [],
        }),
      ),
    );
    const s = make('7');
    await s.start();
    api.snapshots.push(() => Promise.resolve(snapshot('player')));
    sync.emit(
      event(101, 'session.state', {
        state: 'running',
        current_map_id: '34',
        floor_id: '35',
        pause_screen: null,
      }),
    );
    await tick(0);
    expect(api.snapshotCalls).toBe(2);
    expect(s.state!.map).not.toBeNull();
    api.snapshots.push(() =>
      Promise.reject(new ApiError({ code: 'forbidden', message: 'x', status: 403 })),
    );
    await s.reload();
    expect(errors).toHaveLength(1);
  });

  it('a player cannot read the snapshot while paused: the state comes from the header', async () => {
    api.snapshots.push(() =>
      Promise.reject(new ApiError({ code: 'session_paused', message: 'x', status: 409 })),
    );
    const s = make('7');
    const state = await s.start();
    expect(api.getCalls).toBe(1);
    expect(state.session.state).toBe('paused');
    expect(state.map).toBeNull();
    expect(sync.live[0]!.since).toBe('150');
    // Resumed: the snapshot is readable again.
    api.snapshots.push(() => Promise.resolve(snapshot('player')));
    sync.emit(
      event(151, 'session.state', {
        state: 'running',
        current_map_id: '34',
        floor_id: '35',
        pause_screen: null,
      }),
    );
    await tick(0);
    expect(s.state!.map).not.toBeNull();
    expect(s.state!.session.state).toBe('running');
  });
});

describe('life cycle', () => {
  it('kicked: forwarded, then everything stops', async () => {
    api.snapshots.push(() => Promise.resolve(snapshot('player')));
    const s = make('7');
    await s.start();
    sync.emit(event(101, 'player.kicked', { reason: null }));
    expect(effects).toEqual([{ kind: 'kicked' }]);
    expect(sync.live).toHaveLength(0);
    const calls = api.presenceCalls;
    await tick(PRESENCE_MS * 2);
    expect(api.presenceCalls).toBe(calls);
    expect(s.state!.kicked).toBe(true);
  });

  it('tells the sync client the activity: running, lobby, paused, hidden', async () => {
    api.snapshots.push(() =>
      Promise.resolve(snapshot('gm', { session: session('gm', { state: 'lobby' }) })),
    );
    const s = make();
    await s.start();
    expect(sync.activities.at(-1)).toBe('lobby');
    s.setHidden(true);
    expect(sync.activities.at(-1)).toBe('hidden');
    s.setHidden(false);
    expect(sync.activities.at(-1)).toBe('lobby');
    api.snapshots.push(() => Promise.resolve(snapshot('gm')));
    await s.reload();
    expect(sync.activities.at(-1)).toBe('running');
    api.snapshots.push(() =>
      Promise.resolve(snapshot('gm', { session: session('gm', { state: 'paused' }) })),
    );
    await s.reload();
    expect(sync.activities.at(-1)).toBe('paused');
  });

  it('a move refused by a wall puts the token back in the state', async () => {
    const blocked: unknown[] = [];
    const s = new SessionSync({
      sessionId: '12',
      userId: '1',
      api: {
        ...api,
        snapshot: api.snapshot,
        get: api.get,
        presence: api.presence,
        actions: () =>
          Promise.resolve({
            results: [
              {
                index: 0,
                ok: false as const,
                error: 'blocked_by_wall' as const,
                position: { x: 2.5, y: 3 },
              },
            ],
            last_event_id: '1',
          }),
      },
      sync,
      onState: (st) => states.push(st),
      onBlocked: (m) => blocked.push(m),
    });
    await s.start();
    s.actions.moveToken('t1', 9, 9);
    await s.actions.flush();
    expect(s.state!.tokens['t1']).toMatchObject({ x: 2.5, y: 3 });
    expect(blocked).toEqual([{ uid: 't1', position: { x: 2.5, y: 3 } }]);
  });
});
