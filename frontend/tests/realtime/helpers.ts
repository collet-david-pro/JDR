import { buildApiUrl } from '../../src/lib/api';
import {
  resolveDeps,
  type BroadcastLike,
  type EventSourceLike,
  type LockManagerLike,
  type SseMessage,
  type StorageLike,
  type SyncClientOptions,
  type SyncDeps,
} from '../../src/lib/realtime/deps';
import type { WireEvent } from '../../src/lib/realtime/types';

export function ev(id: number | string, channel = 'session:1', type = 'maptoken.moved'): WireEvent {
  return {
    id: String(id),
    channel,
    type,
    payload: { n: Number(id) },
    actor: null,
    client_op_id: null,
    at: '2026-10-26T10:00:00Z',
  };
}

export class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, ((e: SseMessage) => void)[]>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (e: SseMessage) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown, lastEventId = ''): void {
    if (this.closed) return;
    const message = { data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId };
    for (const l of this.listeners.get(type) ?? []) l(message);
  }

  /** What the server sends: a full event (named by its type) with the browser's last id. */
  event(e: WireEvent): void {
    this.emit(e.type, e, e.id);
  }

  ping(lastEventId = ''): void {
    this.emit('ping', {}, lastEventId);
  }

  fail(): void {
    for (const l of this.listeners.get('error') ?? []) l({});
  }

  get params(): URLSearchParams {
    return new URL(this.url, 'http://x').searchParams;
  }
}

export class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

interface Pending {
  respond(): void;
  reject(error: unknown): void;
}

/** GET /events as the server answers it (events of the server list, audience ignored). */
export class FakeEventsServer {
  events: WireEvent[] = [];
  requests: { channels: string[]; since: string; wait: number; at: number }[] = [];
  /** 'down': network failure after `failAfterMs`; 'gone': 410; 'ok'. */
  mode: 'ok' | 'down' | 'gone' = 'ok';
  failAfterMs = 0;
  goneChannels = 'session:1';
  private pending: Pending[] = [];

  push(...events: WireEvent[]): void {
    this.events.push(...events);
    for (const p of this.pending.splice(0)) p.respond();
  }

  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://x');
    const wait = Number(url.searchParams.get('wait') ?? '0');
    const since = url.searchParams.get('since') ?? '0';
    const channels = (url.searchParams.get('channels') ?? '').split(',');
    this.requests.push({ channels, since, wait, at: Date.now() });
    return new Promise<Response>((resolve, reject) => {
      const answer = (): void => {
        const events = this.events.filter(
          (e) => channels.includes(e.channel) && BigInt(e.id) > BigInt(since),
        );
        const last = events.length > 0 ? events[events.length - 1]!.id : since;
        resolve(json({ ok: true, data: { events, last_id: last }, meta: {} }));
      };
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
      if (this.mode === 'down') {
        setTimeout(() => reject(new TypeError('network')), this.failAfterMs);
        return;
      }
      const goneNow = this.goneChannels.split(',').filter((c) => channels.includes(c));
      if (this.mode === 'gone' && goneNow.length > 0) {
        resolve(
          json(
            {
              ok: false,
              error: {
                code: 'events_gone',
                message: 'gone',
                fields: { channels: goneNow.join(',') },
              },
            },
            410,
          ),
        );
        return;
      }
      const ready = this.events.some(
        (e) => channels.includes(e.channel) && BigInt(e.id) > BigInt(since),
      );
      if (ready || wait === 0) {
        answer();
        return;
      }
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((p) => p !== entry);
        answer();
      }, wait * 1000);
      const entry: Pending = {
        respond: () => {
          clearTimeout(timer);
          answer();
        },
        reject,
      };
      this.pending.push(entry);
    });
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Web Locks: the first requester holds the lock until its callback's promise settles. */
export class FakeLocks implements LockManagerLike {
  private queue: (() => void)[] = [];
  private held = false;

  request(_name: string, callback: () => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const run = (): void => {
        callback()
          .then(resolve, reject)
          .finally(() => {
            this.held = false;
            this.queue.shift()?.();
          });
      };
      if (this.held) this.queue.push(run);
      else {
        this.held = true;
        queueMicrotask(run);
      }
    });
  }
}

/** BroadcastChannel bus: a message reaches every other instance of the same name. */
export class FakeBus {
  readonly instances: FakeBroadcast[] = [];

  make = (_name: string): BroadcastLike => {
    const b = new FakeBroadcast(this);
    this.instances.push(b);
    return b;
  };
}

export class FakeBroadcast implements BroadcastLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  /** A crashed tab: sends nothing any more. */
  muted = false;

  constructor(private readonly bus: FakeBus) {}

  postMessage(message: unknown): void {
    if (this.muted) return;
    const data = JSON.parse(JSON.stringify(message)) as unknown;
    for (const other of this.bus.instances) {
      if (other !== this && !other.closed) other.onmessage?.({ data });
    }
  }

  close(): void {
    this.closed = true;
  }
}

export interface Harness {
  readonly server: FakeEventsServer;
  readonly sources: FakeEventSource[];
  readonly storage: FakeStorage;
  readonly locks: FakeLocks;
  readonly bus: FakeBus;
  deps(overrides?: Partial<SyncClientOptions>): SyncDeps;
}

/** Fakes shared by the "tabs" of a test. Tabs have distinct ids. */
export function harness(): Harness {
  const server = new FakeEventsServer();
  const sources: FakeEventSource[] = [];
  const storage = new FakeStorage();
  const locks = new FakeLocks();
  const bus = new FakeBus();
  let tabs = 0;
  return {
    server,
    sources,
    storage,
    locks,
    bus,
    deps: (overrides = {}) =>
      resolveDeps({
        url: (path, query) => buildApiUrl('/api/v1', path, query),
        fetch: server.fetch as typeof fetch,
        eventSource: (url) => {
          const source = new FakeEventSource(url);
          sources.push(source);
          return source;
        },
        locks: null,
        broadcast: null,
        storage,
        serverKey: 'test',
        tabId: `tab-${++tabs}`,
        random: () => 0.5,
        isOnline: () => true,
        ...overrides,
      }),
  };
}
