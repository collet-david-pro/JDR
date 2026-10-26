import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, SyncClientImpl, TAB_EXPIRY_MS } from '../../src/lib/realtime/sync-client';
import type { WireEvent } from '../../src/lib/realtime/types';
import { ev, harness, type Harness } from './helpers';

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers();
  h = harness();
});
afterEach(() => {
  vi.useRealTimers();
});

const tab = () => new SyncClientImpl(h.deps({ locks: h.locks, broadcast: h.bus.make }));

function join(c: SyncClientImpl, channels = ['session:1'], since = '0') {
  const events: WireEvent[] = [];
  const gone: string[] = [];
  const stop = c.subscribe(channels, since, {
    onEvent: (e) => events.push(e),
    onGone: (x) => gone.push(x),
  });
  return { events, gone, stop };
}

const ids = (events: WireEvent[]) => events.map((e) => e.id);

describe('one stream for six tabs', () => {
  it('opens a single stream on the union of the channels and rebroadcasts to every tab', async () => {
    const tabs = Array.from({ length: 6 }, tab);
    const subs = tabs.map((t, i) => join(t, i === 1 ? ['map:2'] : ['session:1']));
    await tick(0);
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0]!.params.get('channels')).toBe('session:1,map:2');
    expect(tabs.map((t) => t.status.leader)).toEqual([true, false, false, false, false, false]);

    const source = h.sources[0]!;
    source.ping();
    source.event(ev(1));
    source.event(ev(2, 'map:2'));
    source.event(ev(3));
    expect(subs.map((s) => ids(s.events).join(','))).toEqual([
      '1,3',
      '2',
      '1,3',
      '1,3',
      '1,3',
      '1,3',
    ]);
    expect(h.sources).toHaveLength(1);
    // The followers see the leader's network state and the cursor.
    expect(tabs[3]!.status).toMatchObject({
      mode: 'sse',
      state: 'online',
      leader: false,
      lastEventId: '3',
    });
  });

  it('a tab opened later joins the stream (no second connection)', async () => {
    const first = tab();
    join(first);
    await tick(0);
    const late = tab();
    const l = join(late, ['session:1'], '0');
    await tick(0);
    h.sources[0]!.ping();
    h.sources[0]!.event(ev(1));
    expect(h.sources).toHaveLength(1);
    expect(ids(l.events)).toEqual(['1']);
    expect(late.status.leader).toBe(false);
  });

  it('a new subscriber that needs older events makes the leader read again from there', async () => {
    const first = tab();
    const a = join(first, ['session:1'], '0');
    await tick(0);
    h.sources[0]!.ping();
    h.sources[0]!.event(ev(5));
    h.sources[0]!.event(ev(6));
    const second = tab();
    const b = join(second, ['session:1'], '4');
    expect(h.sources).toHaveLength(2);
    expect(h.sources[1]!.params.get('since')).toBe('4');
    h.sources[1]!.ping();
    h.sources[1]!.event(ev(5));
    h.sources[1]!.event(ev(6));
    expect(ids(a.events)).toEqual(['5', '6']);
    expect(ids(b.events)).toEqual(['5', '6']);
  });

  it('when the leader closes another tab takes over from the cursor, without loss nor duplicate', async () => {
    const tabs = Array.from({ length: 3 }, tab);
    const subs = tabs.map((t) => join(t));
    await tick(0);
    const first = h.sources[0]!;
    first.ping();
    first.event(ev(1));
    first.event(ev(2));
    tabs[0]!.close();
    await tick(0);
    expect(first.closed).toBe(true);
    expect(h.sources).toHaveLength(2);
    const second = h.sources[1]!;
    expect(second.params.get('since')).toBe('2');
    expect(tabs[1]!.status.leader).toBe(true);
    expect(tabs[2]!.status.leader).toBe(false);
    second.ping();
    second.event(ev(2));
    second.event(ev(3));
    expect(ids(subs[1]!.events)).toEqual(['1', '2', '3']);
    expect(ids(subs[2]!.events)).toEqual(['1', '2', '3']);
    expect(h.sources).toHaveLength(2);
  });

  it('the stream follows the channels of the tabs: a tab that leaves removes its channel', async () => {
    const a = tab();
    join(a, ['session:1']);
    const b = tab();
    const sb = join(b, ['map:2']);
    await tick(0);
    expect(h.sources.at(-1)!.params.get('channels')).toBe('session:1,map:2');
    sb.stop();
    expect(h.sources.at(-1)!.params.get('channels')).toBe('session:1');
  });

  it('a tab that vanished without saying goodbye expires after 90 s', async () => {
    const a = tab();
    join(a, ['session:1']);
    const b = tab();
    join(b, ['map:2']);
    await tick(0);
    h.sources.at(-1)!.ping();
    expect(h.sources.at(-1)!.params.get('channels')).toBe('session:1,map:2');
    // b crashed: it neither announces nor answers any more.
    h.bus.instances[1]!.muted = true;
    await tick(TAB_EXPIRY_MS + HEARTBEAT_MS);
    expect(h.sources.at(-1)!.params.get('channels')).toBe('session:1');
  });

  it('a 410 reaches the subscriptions of every tab', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    h.server.mode = 'gone';
    const a = tab();
    const sa = join(a);
    const b = tab();
    const sb = join(b);
    await tick(0);
    expect(sa.gone).toEqual(['session:1']);
    expect(sb.gone).toEqual(['session:1']);
  });

  it('the polling interval is the fastest of the tabs', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'poll');
    const a = tab();
    join(a);
    const b = tab();
    join(b);
    a.setActivity('paused');
    b.setActivity('paused');
    await tick(1);
    const before = h.server.requests.length;
    await tick(16_000);
    const slow = h.server.requests.length - before;
    b.setActivity('running');
    await tick(1);
    const mid = h.server.requests.length;
    await tick(16_000);
    expect(slow).toBeLessThanOrEqual(4);
    expect(h.server.requests.length - mid).toBeGreaterThanOrEqual(15);
  });
});

describe('fallback without Web Locks or BroadcastChannel', () => {
  it('one stream per tab without Web Locks', async () => {
    const tabs = Array.from(
      { length: 3 },
      () => new SyncClientImpl(h.deps({ locks: null, broadcast: h.bus.make })),
    );
    const subs = tabs.map((t) => join(t));
    expect(h.sources).toHaveLength(3);
    h.sources.forEach((s) => {
      s.ping();
      s.event(ev(1));
    });
    expect(subs.map((s) => ids(s.events))).toEqual([['1'], ['1'], ['1']]);
    expect(tabs.every((t) => t.status.leader)).toBe(true);
  });

  it('one stream per tab without BroadcastChannel', async () => {
    const tabs = Array.from(
      { length: 2 },
      () => new SyncClientImpl(h.deps({ locks: h.locks, broadcast: null })),
    );
    tabs.forEach((t) => join(t));
    await tick(0);
    expect(h.sources).toHaveLength(2);
  });

  it('falls back to its own stream when the lock request is refused', async () => {
    const refusing = { request: () => Promise.reject(new Error('SecurityError')) };
    const c = new SyncClientImpl(h.deps({ locks: refusing, broadcast: h.bus.make }));
    join(c);
    await tick(0);
    expect(c.status.leader).toBe(true);
    expect(h.sources).toHaveLength(1);
  });

  it('close() stops the stream and the status listeners', async () => {
    const c = tab();
    join(c);
    await tick(0);
    const seen: string[] = [];
    c.onStatus((s) => seen.push(s.state));
    c.close();
    expect(h.sources[0]!.closed).toBe(true);
    expect(seen).toEqual([]);
  });
});
