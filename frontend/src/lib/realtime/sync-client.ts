/**
 * SyncClient (etapes/P06 "Contrat front (P6d)", projet.md 10.3 "Un seul flux par navigateur").
 *
 * - Leader: the tab that obtains the Web Lock `jdr-sync` runs the Flow on the union of the
 *   channels of all tabs (≤ 4) and rebroadcasts events through BroadcastChannel('jdr-sync').
 *   When it goes away the browser grants the lock to another tab, which takes over (every tab
 *   knows the subscriptions of the others, announced on change and every 30 s).
 * - Without Web Locks or BroadcastChannel every tab runs its own Flow.
 * - Subscribers are filtered and deduplicated here (per subscription: ids ≤ `since` and ids
 *   already delivered are dropped), so a flow restarted further back replays nothing twice.
 */
import { resolveDeps, type SyncClientOptions, type SyncDeps } from './deps';
import { Flow } from './flow';
import {
  MAX_CHANNELS,
  POLL_INTERVAL_MS,
  type NetState,
  type SyncActivity,
  type SyncClient,
  type SyncHandlers,
  type SyncStatus,
  type TransportMode,
  type WireEvent,
} from './types';
import { SeenIds, compareIds, isEventId, maxId, toWireEvent } from './util';

export const LOCK_NAME = 'jdr-sync';
export const CHANNEL_NAME = 'jdr-sync';
export const HEARTBEAT_MS = 30_000;
export const TAB_EXPIRY_MS = 90_000;

interface Sub {
  readonly id: number;
  readonly channels: readonly string[];
  readonly since: string;
  lastId: string;
  readonly handlers: SyncHandlers;
  readonly seen: SeenIds;
  dead: boolean;
}

interface RemoteSub {
  channels: string[];
  since: string;
}

interface RemoteTab {
  subs: Map<number, RemoteSub>;
  activity: SyncActivity;
  at: number;
}

type Message =
  | {
      t: 'tab';
      tab: string;
      subs: { id: number; channels: string[]; since: string }[];
      activity: SyncActivity;
    }
  | { t: 'bye'; tab: string }
  | { t: 'who'; tab: string }
  | { t: 'ev'; events: unknown[] }
  | { t: 'cursor'; id: string }
  | { t: 'gone'; channels: string[] }
  | { t: 'status'; mode: TransportMode; state: NetState };

const ACTIVITIES: readonly string[] = ['running', 'lobby', 'paused', 'hidden'];

export class SyncClientImpl implements SyncClient {
  private readonly subs = new Map<number, Sub>();
  private readonly remote = new Map<string, RemoteTab>();
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private readonly bc: ReturnType<NonNullable<SyncDeps['broadcast']>> | null;
  private flow: Flow | null = null;
  private leader = false;
  private closed = false;
  private nextId = 1;
  private activity: SyncActivity = 'running';
  private lastId: string | null = null;
  private leaderStatus: { mode: TransportMode; state: NetState } = {
    mode: 'sse',
    state: 'connecting',
  };
  private release: (() => void) | null = null;
  private heartbeat: unknown = null;
  private lastEmitted = '';

  constructor(private readonly deps: SyncDeps) {
    const useTabs = deps.locks !== null && deps.broadcast !== null;
    this.bc = useTabs ? (deps.broadcast?.(deps.name ?? CHANNEL_NAME) ?? null) : null;
    if (this.bc === null || deps.locks === null) {
      this.becomeLeader();
      return;
    }
    this.bc.onmessage = (e) => this.onMessage(e.data);
    this.post({ t: 'who', tab: deps.tabId });
    this.scheduleHeartbeat();
    this.acquire(deps.locks);
  }

  get status(): SyncStatus {
    if (this.leader && this.flow !== null) {
      return {
        mode: this.flow.mode,
        state: this.flow.state,
        leader: true,
        lastEventId: this.flow.cursor ?? this.lastId,
      };
    }
    return { ...this.leaderStatus, leader: false, lastEventId: this.lastId };
  }

  onStatus(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  subscribe(channels: string[], since: string, h: SyncHandlers): () => void {
    const start = isEventId(since) ? since : '0';
    const sub: Sub = {
      id: this.nextId++,
      channels: [...new Set(channels)],
      since: start,
      lastId: start,
      handlers: h,
      seen: new SeenIds(),
      dead: false,
    };
    this.subs.set(sub.id, sub);
    this.changed();
    return () => {
      sub.dead = true;
      if (this.subs.delete(sub.id)) this.changed();
    };
  }

  setActivity(a: SyncActivity): void {
    if (a === this.activity) return;
    this.activity = a;
    this.changed();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.flow?.stop();
    this.post({ t: 'bye', tab: this.deps.tabId });
    if (this.heartbeat !== null) this.deps.clearTimeout(this.heartbeat);
    for (const sub of this.subs.values()) sub.dead = true;
    this.subs.clear();
    this.release?.();
    this.release = null;
    if (this.bc !== null) {
      this.bc.onmessage = null;
      this.bc.close();
    }
    this.listeners.clear();
  }

  // ---- leadership -------------------------------------------------------------------------

  private acquire(locks: NonNullable<SyncDeps['locks']>): void {
    locks
      .request(this.deps.name ?? LOCK_NAME, () => {
        return new Promise<void>((resolve) => {
          if (this.closed) {
            resolve();
            return;
          }
          this.release = resolve;
          this.becomeLeader();
        });
      })
      .catch(() => {
        // Web Locks refused (insecure context...): behave like the fallback, one stream here.
        if (!this.leader && !this.closed) this.becomeLeader();
      });
  }

  private becomeLeader(): void {
    this.leader = true;
    this.flow = new Flow(this.deps, {
      events: (events) => {
        this.post({ t: 'ev', events });
        this.deliver(events);
      },
      cursor: (id) => this.onCursor(id, true),
      gone: (channels) => {
        this.post({ t: 'gone', channels });
        // A 410 for channels nobody here listens to would loop: then every subscription is stale.
        if (this.markGone(channels) === 0) this.markGone(this.liveChannels());
        this.apply();
      },
      status: () => {
        if (this.flow !== null) {
          this.post({ t: 'status', mode: this.flow.mode, state: this.flow.state });
        }
        this.emitStatus();
      },
    });
    this.leaderStatus = { mode: this.flow.mode, state: this.flow.state };
    this.post({ t: 'who', tab: this.deps.tabId });
    this.apply();
    this.emitStatus();
  }

  // ---- demand: local + remote subscriptions -----------------------------------------------

  /** Something this tab wants changed: tell the others, update the flow when leader. */
  private changed(): void {
    this.announce();
    this.apply();
  }

  private apply(): void {
    if (!this.leader || this.flow === null || this.closed) return;
    const channels: string[] = [];
    let cursor: string | null = null;
    let interval = Number.POSITIVE_INFINITY;
    const take = (list: readonly string[], since: string): void => {
      for (const c of list) {
        if (!channels.includes(c) && channels.length < MAX_CHANNELS) channels.push(c);
      }
      cursor = cursor === null || compareIds(since, cursor) < 0 ? since : cursor;
    };
    for (const sub of this.subs.values()) {
      if (!sub.dead) take(sub.channels, sub.lastId);
    }
    if (this.subs.size > 0) interval = POLL_INTERVAL_MS[this.activity];
    const now = this.deps.now();
    for (const [tab, info] of this.remote) {
      if (now - info.at > TAB_EXPIRY_MS) {
        this.remote.delete(tab);
        continue;
      }
      for (const sub of info.subs.values()) take(sub.channels, sub.since);
      if (info.subs.size > 0) interval = Math.min(interval, POLL_INTERVAL_MS[info.activity]);
    }
    if (channels.length === 0) {
      this.flow.stop();
      return;
    }
    if (Number.isFinite(interval)) this.flow.setPollInterval(interval);
    this.flow.configure(channels, cursor);
  }

  private announce(): void {
    this.post({
      t: 'tab',
      tab: this.deps.tabId,
      subs: [...this.subs.values()]
        .filter((s) => !s.dead)
        .map((s) => ({ id: s.id, channels: [...s.channels], since: s.lastId })),
      activity: this.activity,
    });
  }

  private scheduleHeartbeat(): void {
    this.heartbeat = this.deps.setTimeout(() => {
      if (this.closed) return;
      this.announce();
      this.apply();
      this.scheduleHeartbeat();
    }, HEARTBEAT_MS);
  }

  // ---- messages ---------------------------------------------------------------------------

  private post(message: Message): void {
    if (this.bc === null || this.closed) return;
    try {
      this.bc.postMessage(message);
    } catch {
      // Closed channel: nothing to tell.
    }
  }

  private onMessage(data: unknown): void {
    if (this.closed || typeof data !== 'object' || data === null) return;
    const m = data as Record<string, unknown>;
    switch (m['t']) {
      case 'tab':
        this.onTab(m);
        break;
      case 'bye':
        if (typeof m['tab'] === 'string' && this.remote.delete(m['tab'])) this.apply();
        break;
      case 'who':
        this.announce();
        if (this.leader && this.flow !== null) {
          this.post({ t: 'status', mode: this.flow.mode, state: this.flow.state });
        }
        break;
      case 'ev':
        if (!this.leader && Array.isArray(m['events'])) {
          const events = m['events'].map(toWireEvent).filter((e): e is WireEvent => e !== null);
          this.deliver(events);
        }
        break;
      case 'cursor':
        if (!this.leader && isEventId(m['id'])) this.onCursor(m['id'], false);
        break;
      case 'gone':
        if (!this.leader && Array.isArray(m['channels'])) {
          this.markGone(m['channels'].filter((c): c is string => typeof c === 'string'));
          this.announce();
        }
        break;
      case 'status':
        if (!this.leader && typeof m['mode'] === 'string' && typeof m['state'] === 'string') {
          this.leaderStatus = { mode: m['mode'] as TransportMode, state: m['state'] as NetState };
          this.emitStatus();
        }
        break;
    }
  }

  private onTab(m: Record<string, unknown>): void {
    const tab = m['tab'];
    const subs = m['subs'];
    const activity = m['activity'];
    if (
      typeof tab !== 'string' ||
      !Array.isArray(subs) ||
      !ACTIVITIES.includes(activity as string)
    ) {
      return;
    }
    const previous = this.remote.get(tab);
    const next = new Map<number, RemoteSub>();
    for (const raw of subs as Record<string, unknown>[]) {
      const id = raw['id'];
      const channels = raw['channels'];
      const since = raw['since'];
      if (typeof id !== 'number' || !Array.isArray(channels) || !isEventId(since)) continue;
      const known = previous?.subs.get(id);
      next.set(id, {
        channels: channels.filter((c): c is string => typeof c === 'string'),
        // The leader's own view of the progress wins when it is ahead (it feeds the tab).
        since: known === undefined ? since : (maxId(known.since, since) ?? since),
      });
    }
    this.remote.set(tab, { subs: next, activity: activity as SyncActivity, at: this.deps.now() });
    this.apply();
  }

  // ---- delivery ---------------------------------------------------------------------------

  private deliver(events: WireEvent[]): void {
    for (const e of events) this.lastId = maxId(this.lastId, e.id);
    for (const sub of [...this.subs.values()]) {
      for (const e of events) {
        if (sub.dead) break;
        if (!sub.channels.includes(e.channel) || compareIds(e.id, sub.since) <= 0) continue;
        if (!sub.seen.add(e.id)) continue;
        try {
          sub.handlers.onEvent(e);
        } catch (error) {
          this.deps.setTimeout(() => {
            throw error;
          }, 0);
        }
      }
    }
  }

  private onCursor(id: string, fromFlow: boolean): void {
    this.lastId = maxId(this.lastId, id);
    for (const sub of this.subs.values()) sub.lastId = maxId(sub.lastId, id) ?? sub.lastId;
    // Every tab follows the leader's cursor, so a tab that takes over resumes from the right id.
    for (const info of this.remote.values()) {
      for (const sub of info.subs.values()) sub.since = maxId(sub.since, id) ?? sub.since;
    }
    if (fromFlow) this.post({ t: 'cursor', id });
  }

  private liveChannels(): string[] {
    return [...this.subs.values()].filter((s) => !s.dead).flatMap((s) => [...s.channels]);
  }

  /** Marks the subscriptions on `channels` as dead and tells them; returns how many. */
  private markGone(channels: readonly string[]): number {
    let count = 0;
    for (const sub of [...this.subs.values()]) {
      const hit = sub.channels.find((c) => channels.includes(c));
      if (sub.dead || hit === undefined) continue;
      sub.dead = true;
      count++;
      try {
        sub.handlers.onGone(hit);
      } catch (error) {
        this.deps.setTimeout(() => {
          throw error;
        }, 0);
      }
    }
    return count;
  }

  private emitStatus(): void {
    if (this.closed) return;
    const status = this.status;
    const key = JSON.stringify(status);
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    for (const cb of [...this.listeners]) cb(status);
  }
}

/** The real-time client of the application (browser globals unless overridden). */
export function createSyncClient(options: SyncClientOptions): SyncClient {
  return new SyncClientImpl(resolveDeps(options));
}
