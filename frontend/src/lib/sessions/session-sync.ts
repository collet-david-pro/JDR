/**
 * SessionSync: one session followed by one user. Links the snapshot, the SyncClient
 * subscription (`session:{id}`, plus `map:{current_map_id}` for the GM), the pure reducer, the
 * reloads asked by the events and the presence ping (POST /presence every 20 s).
 *
 * - `start()` loads the snapshot, subscribes from its `last_event_id` and returns the state;
 * - every event goes through `applyEvent`; `onState` is called once per tick when the state
 *   changed, `onEffect` for each effect (fog bits, tile blocks, text to read, preload...);
 * - `reload.snapshot` effects and 410 (`onGone`) reload the snapshot (coalesced: one request at
 *   a time, one more when asked meanwhile); the new subscription is made before the old one is
 *   dropped, so the stream is not interrupted and events after the snapshot are replayed;
 * - a player (or a projection screen) cannot read the snapshot while paused (409 session_paused): the state is then built
 *   from the session header and the next `session.state` → running reloads it (D5).
 */
import { ApiError } from '../api';
import type { SyncActivity, SyncClient, WireEvent } from '../realtime/types';
import { backoffDelay } from '../realtime/util';
import { ActionSender, type BlockedMove } from './action-sender';
import type { SessionEffect } from './effects';
import { applyEvent } from './reducer';
import type { SessionsClient } from './sessions-client';
import { createSessionState, sessionChannels, type SessionState } from './state';
import type { SessionSnapshot } from './types';

export const PRESENCE_MS = 20_000;
const MAX_SNAPSHOT_RETRIES = 4;

interface JdrTestHook {
  /** Ids of every event handed to the session (a duplicate would show twice). */
  received: string[];
  lastEventId: string;
  /** Placed tokens: uid => [x, y]. */
  tokens: Record<string, [number, number]>;
  /** Doors: uid => 'open' | 'closed'. */
  doors: Record<string, string>;
}

/**
 * E2E hook: only when localStorage['jdr.test'] === '1' (set by the tests), the ids of the events
 * received by the session and its last applied id are exposed on window.__jdrTest. Inert otherwise.
 */
function recordTestEvent(id: string, state: SessionState): void {
  try {
    if (typeof window === 'undefined' || window.localStorage.getItem('jdr.test') !== '1') return;
    const w = window as unknown as { __jdrTest?: JdrTestHook };
    const hook = (w.__jdrTest ??= { received: [], lastEventId: '', tokens: {}, doors: {} });
    hook.received.push(id);
    hook.lastEventId = state.lastEventId;
    hook.tokens = Object.fromEntries(Object.values(state.tokens).map((t) => [t.uid, [t.x, t.y]]));
    hook.doors = Object.fromEntries(
      Object.values(state.objects).flatMap((o) =>
        o.type === 'door' ? [[o.uid, o.props.state]] : [],
      ),
    );
  } catch {
    /* storage unavailable: no hook */
  }
}

export type SessionApi = Pick<SessionsClient, 'snapshot' | 'get' | 'presence' | 'actions'>;

export interface SessionSyncOptions {
  readonly sessionId: string;
  /** Id of the current user. */
  readonly userId: string;
  readonly api: SessionApi;
  readonly sync: SyncClient;
  readonly onState: (state: SessionState) => void;
  readonly onEffect?: (effect: SessionEffect, state: SessionState) => void;
  /**
   * Every event of the subscription, before the reducer (events the reducer ignores included,
   * and the ones replayed after a reload). A projection screen reads its own `display.*` events.
   */
  readonly onEvent?: (event: WireEvent) => void;
  /** Snapshot failures that will not be retried, and refused actions. */
  readonly onError?: (error: unknown) => void;
  /** A token.move was refused by a wall: the position was already corrected in the state. */
  readonly onBlocked?: (move: BlockedMove) => void;
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly random?: () => number;
}

export class SessionSync {
  /** Sends the actions of this session (moves, doors, fog...). */
  readonly actions: ActionSender;

  private current: SessionState | null = null;
  private unsubscribe: (() => void) | null = null;
  private subscribedKey = '';
  private token = 0;
  private stopped = false;
  private hidden = false;
  private loading: Promise<void> | null = null;
  private again = false;
  private presenceTimer: unknown = null;
  private notifyQueued = false;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;

  constructor(private readonly o: SessionSyncOptions) {
    this.setT = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = o.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.actions = new ActionSender({
      sessionId: o.sessionId,
      transport: o.api,
      mode: () => o.sync.status.mode,
      onBlocked: (move) => this.blocked(move),
      ...(o.onError === undefined ? {} : { onError: (e: unknown) => o.onError?.(e) }),
    });
  }

  get state(): SessionState | null {
    return this.current;
  }

  /** Loads the snapshot, subscribes, starts the presence ping. Rejects when the load fails. */
  async start(): Promise<SessionState> {
    await this.load();
    if (this.current === null) throw new Error('session snapshot unavailable');
    this.presence();
    return this.current;
  }

  /** Reloads the snapshot (coalesced). Resolves when the state is up to date. */
  reload(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.loading !== null) {
      this.again = true;
      return this.loading;
    }
    return this.run();
  }

  /** The page is hidden (document.hidden): the short polling slows down. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.activity();
  }

  stop(): void {
    this.stopped = true;
    this.token++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.presenceTimer !== null) this.clearT(this.presenceTimer);
    this.presenceTimer = null;
    this.actions.close();
  }

  // ---- loading ----------------------------------------------------------------------------

  private run(): Promise<void> {
    const job = this.load()
      .catch((error: unknown) => this.o.onError?.(error))
      .finally(() => {
        this.loading = null;
        if (this.again && !this.stopped) {
          this.again = false;
          void this.reload();
        }
      });
    this.loading = job;
    return job;
  }

  private async load(): Promise<void> {
    let snapshot: SessionSnapshot | null = null;
    for (let attempt = 0; snapshot === null && !this.stopped; attempt++) {
      try {
        snapshot = await this.fetchSnapshot();
      } catch (error) {
        const transient = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
        if (!transient || attempt >= MAX_SNAPSHOT_RETRIES) throw error;
        await this.sleep(backoffDelay(attempt, this.o.random ?? Math.random));
      }
    }
    if (snapshot === null || this.stopped) return;
    const previous = this.current;
    const next = createSessionState(snapshot, this.o.userId);
    this.current = previous?.kicked === true ? { ...next, kicked: true } : next;
    this.subscribe(this.current);
    this.notify();
  }

  private async fetchSnapshot(): Promise<SessionSnapshot> {
    try {
      return await this.o.api.snapshot(this.o.sessionId);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'session_paused') {
        // D5: no map for a player while paused; the header is enough to show the pause screen.
        const session = await this.o.api.get(this.o.sessionId);
        return {
          session,
          map: null,
          tokens: [],
          fog: { floor: null, chunks: [] },
          revealed: [],
          last_event_id: session.last_event_id,
        };
      }
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setT(resolve, ms));
  }

  // ---- subscription -----------------------------------------------------------------------

  private subscribe(state: SessionState): void {
    const channels = sessionChannels(state);
    const token = ++this.token;
    const previous = this.unsubscribe;
    this.unsubscribe = this.o.sync.subscribe(channels, state.lastEventId, {
      onEvent: (e) => {
        if (token === this.token) this.onEvent(e);
      },
      onGone: () => {
        if (token === this.token) void this.reload();
      },
    });
    this.subscribedKey = channels.join(',');
    previous?.();
    this.activity();
  }

  private onEvent(e: WireEvent): void {
    const before = this.current;
    if (before === null || this.stopped) return;
    this.o.onEvent?.(e);
    const { state, effects } = applyEvent(before, e);
    this.current = state;
    recordTestEvent(e.id, state);
    if (state !== before) this.notify();
    let reloading = false;
    for (const effect of effects) {
      if (effect.kind === 'reload.snapshot') {
        reloading = true;
        void this.reload();
      }
      this.o.onEffect?.(effect, state);
      if (effect.kind === 'kicked') this.stop();
    }
    if (!reloading && !this.stopped && this.subscribedKey !== sessionChannels(state).join(',')) {
      // The GM's map changed: the next snapshot carries the new channel set (reload asked).
      void this.reload();
    }
  }

  private blocked(move: BlockedMove): void {
    const s = this.current;
    const token = s?.tokens[move.uid];
    if (s !== null && token !== undefined) {
      this.current = {
        ...s,
        tokens: { ...s.tokens, [move.uid]: { ...token, x: move.position.x, y: move.position.y } },
      };
      this.notify();
    }
    this.o.onBlocked?.(move);
  }

  private notify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      if (this.current !== null && !this.stopped) this.o.onState(this.current);
    });
  }

  private activity(): void {
    const s = this.current?.session.state;
    const a: SyncActivity = this.hidden
      ? 'hidden'
      : s === 'running'
        ? 'running'
        : s === 'lobby'
          ? 'lobby'
          : 'paused';
    this.o.sync.setActivity(a);
  }

  private presence(): void {
    if (this.stopped) return;
    const state = this.current?.session.state;
    if (state !== 'ended') {
      this.o.api.presence(this.o.sessionId).catch(() => undefined);
    }
    this.presenceTimer = this.setT(() => this.presence(), PRESENCE_MS);
  }
}
