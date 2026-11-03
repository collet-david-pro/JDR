/**
 * Fallback to short polling when the server has no slot for a waiting connection (P10e2a):
 * `event: transport` on the stream, `transport` field on a long poll; back to the better mode
 * after retry_after_s, nothing memorised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncClientImpl } from '../../src/lib/realtime/sync-client';
import { POLL_INTERVAL_MS, type WireEvent } from '../../src/lib/realtime/types';
import { ev, harness, type Harness } from './helpers';

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const SIGNAL = { mode: 'poll', retry_after_s: 120 };

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers();
  h = harness();
});
afterEach(() => {
  vi.useRealTimers();
});

function listen(c: SyncClientImpl) {
  const events: WireEvent[] = [];
  c.subscribe(['session:1'], '0', { onEvent: (e) => events.push(e), onGone: () => undefined });
  return events;
}

describe('no free slot on the server', () => {
  it('SSE: the transport event switches to short polling, then SSE again after 120 s', async () => {
    const c = new SyncClientImpl(h.deps());
    const events = listen(c);
    h.sources[0]!.emit('transport', SIGNAL);
    expect(h.sources[0]!.closed).toBe(true);
    expect(c.status.mode).toBe('poll');
    await tick(0);
    expect(h.server.requests.at(-1)).toMatchObject({ wait: 0 });
    h.server.push(ev(1));
    await tick(POLL_INTERVAL_MS.running);
    expect(events.map((e) => e.id)).toEqual(['1']);
    expect(c.status.state).toBe('online');
    expect(h.storage.map.has('jdr.sync.mode:test')).toBe(false);
    // No silence timeout, no step down to long polling meanwhile.
    await tick(119_000 - POLL_INTERVAL_MS.running);
    expect(h.sources).toHaveLength(1);
    expect(c.status.mode).toBe('poll');
    await tick(1000);
    expect(h.sources).toHaveLength(2);
    expect(c.status.mode).toBe('sse');
    expect(h.sources[1]!.params.get('since')).toBe('1');
    const before = h.server.requests.length;
    await tick(POLL_INTERVAL_MS.running * 3);
    expect(h.server.requests).toHaveLength(before);
    c.close();
  });

  it('long polling: the page is delivered, then short polling and long polling again later', async () => {
    h.storage.setItem('jdr.sync.mode:test', 'longpoll');
    h.server.capped = true;
    h.server.push(ev(1));
    const c = new SyncClientImpl(h.deps());
    const events = listen(c);
    await tick(0);
    expect(events.map((e) => e.id)).toEqual(['1']);
    expect(c.status.mode).toBe('poll');
    expect(h.server.requests.map((r) => r.wait)).toEqual([20, 0]);
    await tick(POLL_INTERVAL_MS.running);
    expect(h.server.requests.at(-1)).toMatchObject({ wait: 0, since: '1' });
    h.server.capped = false;
    await tick(120_000);
    expect(c.status.mode).toBe('longpoll');
    expect(h.server.requests.at(-1)).toMatchObject({ wait: 20 });
    expect(h.storage.map.get('jdr.sync.mode:test')).toBe('longpoll');
    c.close();
  });

  it('still capped at the retry: short polling again for another 120 s', async () => {
    const c = new SyncClientImpl(h.deps());
    listen(c);
    h.sources[0]!.emit('transport', SIGNAL);
    await tick(120_000);
    expect(c.status.mode).toBe('sse');
    h.sources[1]!.emit('transport', SIGNAL);
    expect(c.status.mode).toBe('poll');
    await tick(119_000);
    expect(h.sources).toHaveLength(2);
    await tick(1000);
    expect(h.sources).toHaveLength(3);
    c.close();
  });
});
