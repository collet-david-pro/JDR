import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api';
import {
  ActionSender,
  MOVE_INTERVAL_MS,
  type ActionSenderOptions,
  type ActionTransport,
  type BlockedMove,
  type SessionAction,
} from '../../src/lib/sessions';
import type { ActionResult, ActionsResponse } from '../../src/lib/sessions/types';

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

interface Call {
  sessionId: string;
  actions: readonly SessionAction[];
  opId: string | undefined;
  at: number;
}

class FakeTransport implements ActionTransport {
  calls: Call[] = [];
  /** Answers in order; default: every action ok. */
  script: ((call: Call) => Promise<ActionsResponse>)[] = [];
  hold: (() => void)[] = [];

  actions(sessionId: string, actions: readonly SessionAction[], o: { clientOpId?: string }) {
    const call: Call = { sessionId, actions, opId: o.clientOpId, at: Date.now() };
    this.calls.push(call);
    const step = this.script.shift();
    if (step !== undefined) return step(call);
    return Promise.resolve(ok(actions));
  }
}

const ok = (actions: readonly SessionAction[]): ActionsResponse => ({
  results: actions.map((_a, index): ActionResult => ({ index, ok: true })),
  last_event_id: '1',
});

const network = () =>
  Promise.reject(new ApiError({ code: 'network_error', message: 'x', status: 0 }));
const http = (status: number, code = 'x', retryAfter: number | null = null) =>
  Promise.reject(new ApiError({ code, message: 'x', status, retryAfter }));

let transport: FakeTransport;
beforeEach(() => {
  vi.useFakeTimers();
  transport = new FakeTransport();
});
afterEach(() => {
  vi.useRealTimers();
});

function sender(extra: Partial<ActionSenderOptions> = {}) {
  const blocked: BlockedMove[] = [];
  const errors: unknown[] = [];
  const s = new ActionSender({
    sessionId: '12',
    transport,
    random: () => 0.5,
    onBlocked: (m) => blocked.push(m),
    onError: (e) => errors.push(e),
    ...extra,
  });
  return { s, blocked, errors };
}

const moves = (uid: string) =>
  transport.calls.filter((c) => c.actions[0]?.type === 'token.move' && c.actions[0].uid === uid);

describe('token.move rate', () => {
  it('at most 10 positions per second and per token, the first one at once', async () => {
    const { s } = sender();
    const start = Date.now();
    for (let t = 0; t < 1000; t += 10) {
      s.moveToken('t1', t, 0);
      await tick(10);
    }
    expect(moves('t1')[0]!.at).toBe(start);
    expect(moves('t1').length).toBeLessThanOrEqual(11);
    expect(moves('t1').length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < moves('t1').length; i++) {
      expect(moves('t1')[i]!.at - moves('t1')[i - 1]!.at).toBeGreaterThanOrEqual(MOVE_INTERVAL_MS);
    }
  });

  it('5 per second in polling mode', async () => {
    const { s } = sender({ mode: () => 'poll' });
    for (let t = 0; t < 1000; t += 10) {
      s.moveToken('t1', t, 0);
      await tick(10);
    }
    expect(moves('t1').length).toBeLessThanOrEqual(6);
    expect(moves('t1').length).toBeGreaterThanOrEqual(4);
  });

  it('always sends the final position, after the interval', async () => {
    const { s } = sender();
    s.moveToken('t1', 1, 1);
    s.moveToken('t1', 2, 2);
    s.moveToken('t1', 3, 3, 90);
    await tick(0);
    expect(moves('t1')).toHaveLength(1);
    expect(moves('t1')[0]!.actions[0]).toMatchObject({ x: 1, y: 1 });
    await tick(MOVE_INTERVAL_MS);
    expect(moves('t1')).toHaveLength(2);
    expect(moves('t1')[1]!.actions[0]).toEqual({
      type: 'token.move',
      uid: 't1',
      x: 3,
      y: 3,
      rotation: 90,
    });
    await tick(5000);
    expect(moves('t1')).toHaveLength(2);
  });

  it('tokens have their own rate', async () => {
    const { s } = sender();
    s.moveToken('a', 1, 1);
    s.moveToken('b', 2, 2);
    await tick(0);
    expect(moves('a')).toHaveLength(1);
    expect(moves('b')).toHaveLength(1);
  });

  it('a position not yet sent is replaced by the newer one while a request is in flight', async () => {
    let release: (r: ActionsResponse) => void = () => undefined;
    transport.script.push(() => new Promise((resolve) => (release = resolve)));
    const { s } = sender();
    s.moveToken('a', 1, 1);
    s.moveToken('b', 5, 5);
    await tick(0);
    s.moveToken('a', 2, 2);
    await tick(MOVE_INTERVAL_MS);
    s.moveToken('a', 3, 3);
    await tick(MOVE_INTERVAL_MS);
    expect(transport.calls).toHaveLength(1);
    release(ok([]));
    await tick(0);
    // b, then one single request for a: its latest position.
    expect(transport.calls.map((c) => JSON.stringify(c.actions))).toEqual([
      '[{"type":"token.move","uid":"a","x":1,"y":1}]',
      '[{"type":"token.move","uid":"b","x":5,"y":5}]',
      '[{"type":"token.move","uid":"a","x":3,"y":3}]',
    ]);
  });
});

describe('client_op_id and replay', () => {
  it('every request has its own op id (≤ 40 characters)', async () => {
    const { s } = sender();
    await s.send([{ type: 'door.toggle', uid: 'd1' }]);
    await s.send([{ type: 'door.toggle', uid: 'd1' }]);
    const ids = transport.calls.map((c) => c.opId);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id!.length).toBeLessThanOrEqual(40);
    expect(transport.calls[0]!.sessionId).toBe('12');
  });

  it('after a network failure the same request is replayed with the same op id, in order', async () => {
    transport.script.push(network, network);
    const { s } = sender();
    const first = s.send([{ type: 'door.toggle', uid: 'd1' }]);
    const second = s.send([{ type: 'light.toggle', uid: 'l1' }]);
    await tick(0);
    expect(s.status.state).toBe('retrying');
    await tick(500);
    expect(s.status.state).toBe('retrying');
    await tick(1000);
    expect(await first).toEqual([{ index: 0, ok: true }]);
    expect(await second).toEqual([{ index: 0, ok: true }]);
    expect(transport.calls.map((c) => c.actions[0]!.type)).toEqual([
      'door.toggle',
      'door.toggle',
      'door.toggle',
      'light.toggle',
    ]);
    expect(new Set(transport.calls.slice(0, 3).map((c) => c.opId)).size).toBe(1);
    expect(transport.calls[3]!.opId).not.toBe(transport.calls[0]!.opId);
    expect(s.status).toEqual({ state: 'idle', pending: 0 });
  });

  it('resume() replays at once (the browser is back online)', async () => {
    transport.script.push(network);
    const { s } = sender();
    const done = s.send([{ type: 'door.toggle', uid: 'd1' }]);
    await tick(0);
    s.resume();
    await done;
    expect(transport.calls).toHaveLength(2);
    expect(Date.now()).toBe(transport.calls[1]!.at);
  });

  it('a request that failed is not edited by a newer position of the same token', async () => {
    transport.script.push(network);
    const { s } = sender();
    s.moveToken('a', 1, 1);
    await tick(0);
    s.moveToken('a', 2, 2);
    await tick(MOVE_INTERVAL_MS);
    s.resume();
    await s.flush();
    expect(
      transport.calls.map((c) => [
        c.opId === transport.calls[0]!.opId,
        (c.actions[0] as { x: number }).x,
      ]),
    ).toEqual([
      [true, 1],
      [true, 1],
      [false, 2],
    ]);
  });

  it('429 waits for Retry-After; a persistent 5xx ends in onError', async () => {
    transport.script.push(() => http(429, 'rate_limited', 3));
    const { s, errors } = sender();
    const done = s.send([{ type: 'door.toggle', uid: 'd1' }]);
    await tick(2900);
    expect(transport.calls).toHaveLength(1);
    await tick(200);
    await done;
    expect(transport.calls).toHaveLength(2);

    for (let i = 0; i < 5; i++) transport.script.push(() => http(500));
    const failing = s.send([{ type: 'door.toggle', uid: 'd2' }]).catch((e: unknown) => e);
    await tick(60_000);
    expect(await failing).toBeInstanceOf(ApiError);
    expect(errors).toHaveLength(1);
  });

  it('a refusal (409, 403, 422) is dropped for good and the queue goes on', async () => {
    transport.script.push(() => http(409, 'session_paused'));
    const { s, errors } = sender();
    const refused = s.send([{ type: 'door.toggle', uid: 'd1' }]).catch((e: unknown) => e);
    const fine = s.send([{ type: 'door.toggle', uid: 'd2' }]);
    expect(await refused).toMatchObject({ code: 'session_paused' });
    expect(await fine).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(transport.calls).toHaveLength(2);
  });
});

describe('results', () => {
  it('blocked_by_wall is reported with the corrected position', async () => {
    transport.script.push(() =>
      Promise.resolve({
        results: [{ index: 0, ok: false, error: 'blocked_by_wall', position: { x: 4.2, y: 7 } }],
        last_event_id: '9',
      }),
    );
    const { s, blocked } = sender();
    s.moveToken('t1', 9, 9);
    await s.flush();
    expect(blocked).toEqual([{ uid: 't1', position: { x: 4.2, y: 7 } }]);
  });

  it('send() splits more than 20 actions and numbers the results as given', async () => {
    const { s } = sender();
    const actions: SessionAction[] = Array.from({ length: 45 }, (_v, i) => ({
      type: 'door.toggle',
      uid: `d${i}`,
    }));
    const results = await s.send(actions);
    expect(transport.calls.map((c) => c.actions.length)).toEqual([20, 20, 5]);
    expect(results.map((r) => r.index)).toEqual(actions.map((_a, i) => i));
  });

  it('close() rejects what is waiting and stops the timers', async () => {
    transport.script.push(network);
    const { s } = sender();
    const waiting = s.send([{ type: 'door.toggle', uid: 'd1' }]).catch((e: unknown) => e);
    await tick(0);
    s.moveToken('a', 1, 1);
    s.moveToken('a', 2, 2);
    s.close();
    expect(await waiting).toBeInstanceOf(Error);
    await tick(10_000);
    expect(transport.calls).toHaveLength(1);
  });
});
