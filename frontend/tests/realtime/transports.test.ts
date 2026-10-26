import { describe, expect, it, vi } from 'vitest';
import { EventsFetchError, fetchEvents, openSse } from '../../src/lib/realtime/transports';
import { EVENT_TYPES } from '../../src/lib/realtime/event-types';
import { backoffDelay, compareIds, SeenIds } from '../../src/lib/realtime/util';
import { ev, harness, type FakeEventSource } from './helpers';

describe('openSse', () => {
  function open() {
    const h = harness();
    const deps = h.deps();
    const calls = {
      messages: [] as (string | null)[],
      events: [] as string[],
      gone: [] as string[],
      ends: 0,
    };
    const conn = openSse(deps, '/api/v1/stream?channels=session%3A1&since=0', {
      onMessage: (id) => calls.messages.push(id),
      onEvent: (e) => calls.events.push(e.id),
      onGone: (c) => calls.gone.push(c),
      onEnd: () => calls.ends++,
    });
    return { source: conn.source as FakeEventSource, conn, calls, h };
  }

  it('listens to every event type of the catalogue and parses the full event', () => {
    const { source, calls } = open();
    for (const type of EVENT_TYPES) expect(source.listeners.has(type)).toBe(true);
    source.event(ev(12, 'session:1', 'door.toggled'));
    expect(calls.events).toEqual(['12']);
    expect(calls.messages).toEqual(['12']);
  });

  it('a ping is a message that only carries the cursor (Last-Event-ID of the browser)', () => {
    const { source, calls } = open();
    source.ping('77');
    source.ping('');
    expect(calls.messages).toEqual(['77', null]);
    expect(calls.events).toEqual([]);
  });

  it('ignores a malformed event', () => {
    const { source, calls } = open();
    source.emit('maptoken.moved', '{not json');
    source.emit('maptoken.moved', { id: 'x', channel: 'c', type: 't' });
    expect(calls.events).toEqual([]);
  });

  it('events_gone names the channel; the end of the stream closes the source once', () => {
    const { source, calls } = open();
    source.emit('events_gone', { channel: 'session:1' });
    expect(calls.gone).toEqual(['session:1']);
    source.fail();
    source.fail();
    expect(calls.ends).toBe(1);
    expect(source.closed).toBe(true);
  });

  it('close() ends silently', () => {
    const { source, conn, calls } = open();
    conn.close();
    source.fail();
    expect(calls.ends).toBe(0);
  });
});

describe('fetchEvents', () => {
  it('asks /events with channels, since and wait and parses the page', async () => {
    const h = harness();
    h.server.push(ev(5), ev(6, 'map:2'), ev(7, 'other:9'));
    const page = await fetchEvents(h.deps(), ['session:1', 'map:2'], '4', 0);
    expect(h.server.requests[0]).toMatchObject({
      channels: ['session:1', 'map:2'],
      since: '4',
      wait: 0,
    });
    expect(page.events.map((e) => e.id)).toEqual(['5', '6']);
    expect(page.lastId).toBe('6');
  });

  it('410 events_gone ⇒ kind gone with the channels of the server', async () => {
    const h = harness();
    h.server.mode = 'gone';
    h.server.goneChannels = 'session:1,map:2';
    const error = await fetchEvents(h.deps(), ['session:1', 'map:2'], '1', 0).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EventsFetchError);
    expect(error).toMatchObject({ kind: 'gone', status: 410, channels: ['session:1', 'map:2'] });
  });

  it('network failure and timeout are told apart; 4xx is a client failure', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.server.mode = 'down';
      const down = fetchEvents(h.deps(), ['session:1'], '1', 0).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1);
      expect(await down).toMatchObject({ kind: 'network' });

      const hang = harness().deps({
        fetch: ((_u: string, init?: RequestInit) =>
          new Promise((_res, rej) =>
            init?.signal?.addEventListener('abort', () => rej(new Error('x'))),
          )) as typeof fetch,
      });
      const pending = fetchEvents(hang, ['session:1'], '1', 20).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toMatchObject({ kind: 'timeout' });

      const denied = harness().deps({
        fetch: (() =>
          Promise.resolve(
            new Response(JSON.stringify({ ok: false, error: { code: 'forbidden', message: '' } }), {
              status: 403,
            }),
          )) as typeof fetch,
      });
      await expect(fetchEvents(denied, ['session:1'], '1', 0)).rejects.toMatchObject({
        kind: 'client',
        status: 403,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('util', () => {
  it('compares decimal ids beyond 2^53', () => {
    expect(compareIds('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareIds('99', '100')).toBe(-1);
    expect(compareIds('007', '7')).toBe(0);
  });

  it('backoff: 0.5 s doubling up to 15 s, ±30 %', () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((n) => backoffDelay(n, mid))).toEqual([
      500, 1000, 2000, 4000, 8000, 15000, 15000, 15000,
    ]);
    expect(backoffDelay(0, () => 0)).toBe(350);
    expect(backoffDelay(0, () => 0.999999)).toBe(650);
    expect(backoffDelay(9, () => 0)).toBe(10500);
    expect(backoffDelay(9, () => 1)).toBe(19500);
  });

  it('SeenIds is bounded: the oldest id is forgotten first', () => {
    const seen = new SeenIds(3);
    expect(['1', '2', '3', '1'].map((id) => seen.add(id))).toEqual([true, true, true, false]);
    expect(seen.add('4')).toBe(true);
    expect(seen.add('1')).toBe(true);
    expect(seen.add('4')).toBe(false);
  });
});
