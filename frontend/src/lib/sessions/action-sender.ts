/**
 * Sends the actions of a session (etapes/P06 "Actions de séance", projet.md 10.5):
 * - every request has its `client_op_id` (≤ 40 characters), kept for every replay (idempotent);
 * - one request at a time, in order; after a network failure (or a 5xx / 429) the request is
 *   replayed unchanged with a backoff, at once on `resume()` (the `online` event);
 * - token.move: at most 10 positions per second and per token (5 in polling mode); a position
 *   not yet sent is replaced by the newer one and the last one is always sent (trailing send);
 * - `blocked_by_wall` results are reported with the corrected position (`onBlocked`).
 */
import { ApiError } from '../api';
import type { TransportMode } from '../realtime/types';
import { backoffDelay } from '../realtime/util';
import { newClientOpId } from './op-id';
import type { WriteOptions } from './sessions-client';
import type { ActionResult, ActionsResponse, SessionAction } from './types';

export interface ActionTransport {
  actions(
    sessionId: string,
    actions: readonly SessionAction[],
    options: WriteOptions,
  ): Promise<ActionsResponse>;
}

export interface BlockedMove {
  readonly uid: string;
  /** Last valid position (the server stored it and broadcast it). */
  readonly position: { readonly x: number; readonly y: number };
}

export interface SenderClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ActionSenderOptions {
  readonly sessionId: string;
  readonly transport: ActionTransport;
  /** Current transport of the sync client (polling mode halves the rate of positions). */
  readonly mode?: () => TransportMode;
  readonly clock?: SenderClock;
  readonly newId?: () => string;
  readonly random?: () => number;
  readonly onBlocked?: (move: BlockedMove) => void;
  /** A request was refused for good (4xx, too many 5xx): its actions are dropped. */
  readonly onError?: (error: unknown, actions: readonly SessionAction[]) => void;
  readonly onStatus?: (status: SenderStatus) => void;
}

export interface SenderStatus {
  readonly state: 'idle' | 'sending' | 'retrying';
  /** Requests waiting + positions not yet queued. */
  readonly pending: number;
}

export const MOVE_INTERVAL_MS = 100;
export const MOVE_INTERVAL_POLL_MS = 200;
export const MAX_ACTIONS_PER_REQUEST = 20;
const MAX_SERVER_ERRORS = 5;

interface Waiter {
  resolve(results: ActionResult[]): void;
  reject(error: unknown): void;
  offset: number;
}

interface Item {
  readonly opId: string;
  actions: SessionAction[];
  /** Sent at least once: the body must not change any more (replay with the same op id). */
  sent: boolean;
  failures: number;
  readonly waiters: Waiter[];
  readonly moveUid: string | null;
}

interface Position {
  x: number;
  y: number;
  rotation: number | undefined;
}

const realClock: SenderClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class ActionSender {
  private readonly queue: Item[] = [];
  private readonly latest = new Map<string, Position>();
  private readonly timers = new Map<string, unknown>();
  private readonly lastQueued = new Map<string, number>();
  private readonly clock: SenderClock;
  private readonly newId: () => string;
  private inFlight = false;
  private retryTimer: unknown = null;
  private attempts = 0;
  private closed = false;
  private idle: (() => void)[] = [];
  private lastStatus = '';

  constructor(private readonly o: ActionSenderOptions) {
    this.clock = o.clock ?? realClock;
    this.newId = o.newId ?? newClientOpId;
  }

  get status(): SenderStatus {
    const state = this.retryTimer !== null ? 'retrying' : this.inFlight ? 'sending' : 'idle';
    return { state, pending: this.queue.length + this.latest.size };
  }

  /**
   * A position of a token (drag in progress or final): sent at once when the token was not sent
   * within the last 100 ms (200 ms in polling mode), else the newest position is sent when the
   * interval is over. The last call is therefore always the last position sent.
   */
  moveToken(uid: string, x: number, y: number, rotation?: number): void {
    if (this.closed) return;
    this.latest.set(uid, { x, y, rotation });
    if (this.timers.has(uid)) {
      this.emit();
      return;
    }
    const wait =
      (this.lastQueued.get(uid) ?? Number.NEGATIVE_INFINITY) + this.interval() - this.clock.now();
    if (wait <= 0) this.queueMove(uid);
    else
      this.timers.set(
        uid,
        this.clock.setTimeout(() => {
          this.timers.delete(uid);
          this.queueMove(uid);
        }, wait),
      );
    this.emit();
  }

  /** Queues the actions in order (≤ 20 per request: longer lists are split); one result each. */
  send(actions: readonly SessionAction[]): Promise<ActionResult[]> {
    if (this.closed) return Promise.reject(new Error('action sender closed'));
    if (actions.length === 0) return Promise.resolve([]);
    const parts: Promise<ActionResult[]>[] = [];
    for (let i = 0; i < actions.length; i += MAX_ACTIONS_PER_REQUEST) {
      const chunk = actions.slice(i, i + MAX_ACTIONS_PER_REQUEST);
      parts.push(
        new Promise<ActionResult[]>((resolve, reject) => {
          const item = this.item(chunk, null);
          item.waiters.push({ resolve, reject, offset: i });
          this.queue.push(item);
          this.pump();
        }),
      );
    }
    return Promise.all(parts).then((lists) => lists.flat());
  }

  /** Sends the positions still waiting for their interval and resolves once the queue is empty. */
  flush(): Promise<void> {
    for (const [uid, handle] of this.timers) {
      this.clock.clearTimeout(handle);
      this.timers.delete(uid);
      this.queueMove(uid);
    }
    if (this.queue.length === 0 && !this.inFlight) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  /** The network is back (online event): replay at once. */
  resume(): void {
    if (this.retryTimer !== null) {
      this.clock.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.attempts = 0;
    this.pump();
  }

  close(): void {
    this.closed = true;
    for (const handle of this.timers.values()) this.clock.clearTimeout(handle);
    this.timers.clear();
    this.latest.clear();
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const item of this.queue.splice(0)) {
      for (const w of item.waiters) w.reject(new Error('action sender closed'));
    }
    this.release();
  }

  // ---- internals --------------------------------------------------------------------------

  private interval(): number {
    return this.o.mode?.() === 'poll' ? MOVE_INTERVAL_POLL_MS : MOVE_INTERVAL_MS;
  }

  private item(actions: SessionAction[], moveUid: string | null): Item {
    return { opId: this.newId(), actions, sent: false, failures: 0, waiters: [], moveUid };
  }

  private queueMove(uid: string): void {
    const p = this.latest.get(uid);
    if (p === undefined) return;
    this.latest.delete(uid);
    this.lastQueued.set(uid, this.clock.now());
    const action: SessionAction =
      p.rotation === undefined
        ? { type: 'token.move', uid, x: p.x, y: p.y }
        : { type: 'token.move', uid, x: p.x, y: p.y, rotation: p.rotation };
    const waiting = this.queue.find((i) => i.moveUid === uid && !i.sent);
    if (waiting !== undefined) waiting.actions = [action];
    else this.queue.push(this.item([action], uid));
    this.pump();
  }

  private pump(): void {
    const item = this.queue[0];
    if (this.closed || this.inFlight || this.retryTimer !== null || item === undefined) {
      this.emit();
      return;
    }
    this.inFlight = true;
    item.sent = true;
    this.emit();
    this.o.transport.actions(this.o.sessionId, item.actions, { clientOpId: item.opId }).then(
      (response) => this.done(item, response),
      (error: unknown) => this.failed(item, error),
    );
  }

  private done(item: Item, response: ActionsResponse): void {
    this.inFlight = false;
    this.attempts = 0;
    this.queue.shift();
    const results = Array.isArray(response.results) ? response.results : [];
    for (const r of results) {
      if (r.ok || r.error !== 'blocked_by_wall') continue;
      const action = item.actions[r.index];
      if (action?.type === 'token.move')
        this.o.onBlocked?.({ uid: action.uid, position: r.position });
    }
    for (const w of item.waiters) {
      w.resolve(results.map((r) => ({ ...r, index: r.index + w.offset })));
    }
    this.pump();
    this.release();
  }

  private failed(item: Item, error: unknown): void {
    this.inFlight = false;
    const status = error instanceof ApiError ? error.status : 0;
    const transient = status === 0 || status === 429 || status >= 500;
    if (transient) {
      item.failures++;
      const hardServerError = status >= 500 && item.failures >= MAX_SERVER_ERRORS;
      if (!hardServerError && !this.closed) {
        const hinted =
          error instanceof ApiError && error.retryAfter !== null ? error.retryAfter * 1000 : 0;
        const delay = Math.max(hinted, backoffDelay(this.attempts++, this.o.random ?? Math.random));
        this.retryTimer = this.clock.setTimeout(() => {
          this.retryTimer = null;
          this.pump();
        }, delay);
        this.emit();
        return;
      }
    }
    this.queue.shift();
    this.o.onError?.(error, item.actions);
    for (const w of item.waiters) w.reject(error);
    this.pump();
    this.release();
  }

  private release(): void {
    this.emit();
    if (this.queue.length > 0 || this.inFlight || this.idle.length === 0) return;
    for (const resolve of this.idle.splice(0)) resolve();
  }

  private emit(): void {
    if (this.o.onStatus === undefined) return;
    const status = this.status;
    const key = `${status.state}:${status.pending}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.o.onStatus(status);
  }
}
