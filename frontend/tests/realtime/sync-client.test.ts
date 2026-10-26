import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { SyncClientImpl } from '../../src/lib/realtime/sync-client';
import { BEST_MODE_RETRY_MS, POLL_INTERVAL_MS, type WireEvent } from '../../src/lib/realtime/types';
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

function client(overrides = {}) {
  return new SyncClientImpl(h.deps(overrides));
}

function listen(c: SyncClientImpl, channels = ['session:1'], since = '0') {
  const events: WireEvent[] = [];
  const gone: string[] = [];
  const stop = c.subscribe(channels, since, {
    onEvent: (e) => events.push(e),
    onGone: (ch) => gone.push(ch),
  });
  return { events, gone, stop };
}

describe('SSE', () => {
  it('opens one stream on the channels from the snapshot cursor and delivers the events once', async () => {
    const c = client();
    const l = listen(c, ['session:1', 'map:2'], '10');
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0]!.params.get('channels')).toBe('session:1,map:2');
    expect(h.sources[0]!.params.get('since')).toBe('10');
    expect(c.status).toMatchObject({ mode: 'sse', state: 'connecting', leader: true });
    h.sources[0]!.ping();
    expect(c.status.state).toBe('online');
    h.sources[0]!.event(ev(11));
    h.sources[0]!.event(ev(11));
    h.sources[0]!.event(ev(12, 'session:1', 'door.toggled'));
    expect(l.events.map((e) => e.id)).toEqual(['11', '12']);
    expect(c.status.lastEventId).toBe('12');
  });

  it('drops the events at or below the since of the subscription and of other channels', () => {
    const c = client();
    const l = listen(c, ['session:1'], '10');
    h.sources[0]!.ping();
    h.sources[0]!.event(ev(10));
    h.sources[0]!.event(ev(11, 'map:9'));
    h.sources[0]!.event(ev(12));
    expect(l.events.map((e) => e.id)).toEqual(['12']);
  });

  it('the cursor moves with a ping even without any event', () => {
    const c = client();
    listen(c);
    h.sources[0]!.ping('500');
    expect(c.status.lastEventId).toBe('500');
  });

  it('the voluntary end after 25 s reconnects at once from the cursor, without leaving SSE', async () => {
    const c = client();
    listen(c);
    h.sources[0]!.ping();
    h.sources[0]!.event(ev(5));
    await tick(25_000);
    h.sources[0]!.fail();
    expect(h.sources).toHaveLength(2);
    expect(h.sources[1]!.params.get('since')).toBe('5');
    expect(c.status.mode).toBe('sse');
    expect(c.status.state).toBe('online');
  });

  it('no message within 5 s (buffering proxy) ⇒ long polling, memorised', async () => {
    const c = client();
    const l = listen(c);
    await tick(4999);
    expect(c.status.mode).toBe('sse');
    await tick(1);
    expect(h.sources[0]!.closed).toBe(true);
    expect(c.status.mode).toBe('longpoll');
    expect(h.storage.map.get('jdr.sync.mode:test')).toBe('longpoll');
    expect(h.server.requests[0]).toMatchObject({ wait: 20 });
    h.server.push(ev(3));
    await tick(0);
    expect(l.events.map((e) => e.id)).toEqual(['3']);
  });

  it('4 quick cuts in a minute switch to long polling', async () => {
    const c = client();
    listen(c);
    for (let i = 0; i < 3; i++) {
      h.sources.at(-1)!.ping();
      h.sources.at(-1)!.fail();
      await tick(600);
    }
    expect(c.status.mode).toBe('sse');
    h.sources.at(-1)!.ping();
    h.sources.at(-1)!.fail();
    await tick(0);
    expect(c.status.mode).toBe('longpoll');
  });

  it('cuts while the browser is offline do not count against SSE', async () => {
    let online = false;
    const c = client({ isOnline: () => online });
    listen(c);
    for (let i = 0; i < 6; i++) {
      h.sources.at(-1)!.fail();
      await tick(16_000);
    }
    expect(c.status.mode).toBe('sse');
    expect(c.status.state).toBe('reconnecting');
    online = true;
    h.sources.at(-1)!.ping();
    expect(c.status.state).toBe('online');
  });
});

describe('long polling and short polling', () => {
  it('long polling re-asks from last_id and delivers in order', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    const c = client();
    const l = listen(c);
    expect(h.sources).toHaveLength(0);
    await tick(0);
    h.server.push(ev(1), ev(2));
    await tick(0);
    h.server.push(ev(3));
    await tick(0);
    expect(l.events.map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(h.server.requests.map((r) => r.since)).toEqual(['0', '2', '3']);
    expect(c.status).toMatchObject({ mode: 'longpoll', state: 'online', lastEventId: '3' });
  });

  it('3 long requests cut before `wait` ⇒ short polling', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    h.server.mode = 'down';
    h.server.failAfterMs = 10_000;
    const c = client();
    listen(c);
    await tick(10_000);
    expect(c.status.mode).toBe('longpoll');
    await tick(30_000);
    await tick(30_000);
    expect(c.status.mode).toBe('poll');
    expect(h.storage.map.get('jdr.sync.mode:test')).toBe('poll');
  });

  it('a full-length empty long poll resets the cut counter', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    const c = client();
    listen(c);
    await tick(20_000);
    expect(h.server.requests).toHaveLength(2);
    expect(c.status.mode).toBe('longpoll');
  });

  it('short polling interval follows the activity: 1 s, 3 s, 8 s', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'poll');
    const c = client();
    listen(c);
    await tick(0);
    const gaps = async (ms: number) => {
      const before = h.server.requests.length;
      await tick(ms * 10);
      return (h.server.requests.length - before) / 10;
    };
    expect(await gaps(POLL_INTERVAL_MS.running)).toBeCloseTo(1, 0);
    c.setActivity('lobby');
    await tick(3000);
    expect(await gaps(POLL_INTERVAL_MS.lobby)).toBeCloseTo(1, 0);
    c.setActivity('paused');
    await tick(8000);
    expect(await gaps(POLL_INTERVAL_MS.paused)).toBeCloseTo(1, 0);
    expect(h.server.requests.at(-1)).toMatchObject({ wait: 0 });
  });
});

describe('mode memory and retry of the best mode', () => {
  it('starts in the memorised mode and tries SSE again after 5 minutes', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    const c = client();
    listen(c);
    await tick(BEST_MODE_RETRY_MS - 1);
    expect(h.sources).toHaveLength(0);
    await tick(1);
    expect(h.sources).toHaveLength(1);
    expect(c.status.mode).toBe('sse');
    h.sources[0]!.ping();
    expect(h.storage.map.get('jdr.sync.mode:test')).toBe('sse');
    expect(c.status.state).toBe('online');
  });

  it('a failed SSE trial goes back to the memorised mode and tries again 5 minutes later', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'poll');
    const c = client();
    listen(c);
    await tick(BEST_MODE_RETRY_MS);
    expect(h.sources).toHaveLength(1);
    expect(c.status.mode).toBe('sse');
    h.server.mode = 'down';
    await tick(5000); // silent (buffered): next trial mode, long polling
    expect(c.status.mode).toBe('longpoll');
    await tick(1);
    // The long poll trial failed as well: back to the memorised short polling.
    expect(c.status.mode).toBe('poll');
    expect(h.storage.map.get('jdr.sync.mode:test')).toBe('poll');
    h.server.mode = 'ok';
    await tick(BEST_MODE_RETRY_MS);
    expect(h.sources).toHaveLength(2);
  });

  it('without EventSource the SSE mode is skipped', async () => {
    const c = client({ eventSource: null });
    listen(c);
    await tick(0);
    expect(c.status.mode).toBe('longpoll');
    expect(h.server.requests[0]).toMatchObject({ wait: 20 });
  });
});

describe('reconnection', () => {
  it('backoff grows 0.5 s, 1 s, 2 s... up to 15 s while the server is down', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'poll');
    h.server.mode = 'down';
    const c = client();
    listen(c);
    await tick(60_000);
    const times = h.server.requests.map((r) => r.at);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    // (+1 ms: the fake server fails its request one timer tick after the call)
    expect(gaps.slice(0, 6).map((g) => g - 1)).toEqual([499, 1000, 2000, 4000, 8000, 15000]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(15001);
    expect(c.status.state).toBe('reconnecting');
    h.server.mode = 'ok';
    await tick(15_000);
    expect(c.status.state).toBe('online');
  });

  it('a 30 s outage is caught up without duplicate (polling)', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'poll');
    const c = client();
    const l = listen(c);
    h.server.push(ev(1), ev(2));
    await tick(1000);
    h.server.mode = 'down';
    await tick(30_000);
    h.server.events.push(ev(3), ev(4), ev(5));
    h.server.mode = 'ok';
    await tick(16_000);
    expect(l.events.map((e) => e.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(h.server.requests.at(-1)!.since).toBe('5');
  });

  it('a 30 s outage is caught up without duplicate (SSE: overlapping replay)', async () => {
    let online = true;
    const c = client({ isOnline: () => online });
    const l = listen(c);
    h.sources[0]!.ping();
    h.sources[0]!.event(ev(1));
    h.sources[0]!.event(ev(2));
    online = false;
    h.sources[0]!.fail();
    await tick(30_000);
    online = true;
    const next = h.sources.at(-1)!;
    expect(next.params.get('since')).toBe('2');
    next.ping();
    // The server replays more than asked (a merged / reordered event, a retry): still once.
    next.event(ev(2));
    next.event(ev(3));
    next.event(ev(4));
    next.event(ev(3));
    expect(l.events.map((e) => e.id)).toEqual(['1', '2', '3', '4']);
    expect(c.status).toMatchObject({ mode: 'sse', state: 'online' });
  });
});

describe('410 events_gone', () => {
  it('long polling: onGone(channel), the stream stops until the consumer subscribes again', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    h.server.mode = 'gone';
    const c = client();
    const l = listen(c, ['session:1'], '3');
    await tick(0);
    expect(l.gone).toEqual(['session:1']);
    const stalled = h.server.requests.length;
    await tick(60_000);
    expect(h.server.requests).toHaveLength(stalled);
    // The consumer reloads its snapshot and subscribes from the new head.
    l.stop();
    h.server.mode = 'ok';
    const asked = h.server.requests.length;
    const again = listen(c, ['session:1'], '90');
    await tick(0);
    expect(h.server.requests[asked]!.since).toBe('90');
    h.server.push(ev(91));
    await tick(0);
    expect(again.events.map((e) => e.id)).toEqual(['91']);
  });

  it('SSE: events_gone for each channel then the end of the stream; no reconnection', async () => {
    const c = client();
    const l = listen(c, ['session:1', 'map:2'], '3');
    const source = h.sources[0]!;
    source.ping();
    source.emit('events_gone', { channel: 'session:1' });
    source.emit('events_gone', { channel: 'map:2' });
    expect(l.gone).toEqual([]);
    source.fail();
    expect(l.gone).toEqual(['session:1']);
    await tick(60_000);
    expect(h.sources).toHaveLength(1);
    // A dead subscription receives nothing more.
    expect(l.events).toEqual([]);
  });

  it('a subscription of an unaffected channel keeps its events', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    h.server.mode = 'gone';
    h.server.goneChannels = 'map:2';
    const c = client();
    const a = listen(c, ['session:1']);
    const b = listen(c, ['map:2']);
    await tick(0);
    expect(a.gone).toEqual([]);
    expect(b.gone).toEqual(['map:2']);
  });
});

describe('subscriptions', () => {
  it('a later subscription from an older cursor restarts the stream and replays only to it', async () => {
    const c = client();
    const first = listen(c, ['session:1'], '0');
    h.sources[0]!.ping();
    h.sources[0]!.event(ev(5));
    h.sources[0]!.event(ev(6));
    const second = listen(c, ['session:1'], '3');
    expect(h.sources[0]!.closed).toBe(true);
    expect(h.sources[1]!.params.get('since')).toBe('3');
    h.sources[1]!.ping();
    h.sources[1]!.event(ev(5));
    h.sources[1]!.event(ev(6));
    h.sources[1]!.event(ev(7));
    expect(first.events.map((e) => e.id)).toEqual(['5', '6', '7']);
    expect(second.events.map((e) => e.id)).toEqual(['5', '6', '7']);
  });

  it('unsubscribing the last subscription closes the stream', () => {
    const c = client();
    const l = listen(c);
    l.stop();
    expect(h.sources[0]!.closed).toBe(true);
    expect(c.status.state).toBe('offline');
  });

  it('notifies the status changes', () => {
    const c = client();
    const seen: string[] = [];
    c.onStatus((s) => seen.push(`${s.mode}/${s.state}`));
    listen(c);
    h.sources[0]!.ping();
    expect(seen).toEqual(['sse/connecting', 'sse/online']);
  });

  it('a handler that throws does not stop the others', async () => {
    const c = client();
    const ok: string[] = [];
    c.subscribe(['session:1'], '0', {
      onEvent: () => {
        throw new Error('boom');
      },
      onGone: () => undefined,
    });
    c.subscribe(['session:1'], '0', { onEvent: (e) => ok.push(e.id), onGone: () => undefined });
    h.sources.at(-1)!.ping();
    h.sources.at(-1)!.event(ev(1));
    expect(ok).toEqual(['1']);
    await expect(tick(1)).rejects.toThrow('boom');
  });
});
