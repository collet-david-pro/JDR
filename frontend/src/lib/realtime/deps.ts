/**
 * Everything the real-time client touches in the outside world, injectable for the tests
 * (clock, timers, fetch, EventSource, Web Locks, BroadcastChannel, localStorage).
 */
import type { QueryParams } from '../api';
import { EVENT_TYPES } from './event-types';

/** What an EventSource listener receives. */
export interface SseMessage {
  readonly data?: string;
  readonly lastEventId?: string;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (e: SseMessage) => void): void;
  close(): void;
}

export interface LockManagerLike {
  /** Resolves when the callback's promise does; the callback runs once the lock is granted. */
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

export interface BroadcastLike {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SyncDeps {
  /** URL of an API path (ApiClient.url). */
  url(path: string, query?: QueryParams): string;
  fetch: typeof fetch;
  /** null: no EventSource (the SSE mode is skipped). */
  eventSource: ((url: string) => EventSourceLike) | null;
  /** null: no Web Locks, every tab opens its own stream. */
  locks: LockManagerLike | null;
  /** null: no BroadcastChannel, every tab opens its own stream. */
  broadcast: ((name: string) => BroadcastLike) | null;
  storage: StorageLike | null;
  /** Identifies the server in the memorised mode (several installations on one origin). */
  serverKey: string;
  tabId: string;
  /**
   * Name of the Web Locks lock and of the BroadcastChannel shared by the tabs of one stream
   * (default `jdr-sync`). A projection screen uses its own so that it never shares the stream
   * of the user's tabs.
   */
  name?: string;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** [0, 1) */
  random(): number;
  /** navigator.onLine: offline cuts are not counted against the SSE transport. */
  isOnline(): boolean;
  /** Names listened by EventSource. */
  sseTypes: readonly string[];
}

export interface SyncClientOptions extends Partial<Omit<SyncDeps, 'url'>> {
  url: SyncDeps['url'];
}

function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Real implementations from the browser globals, completed by the given overrides. */
export function resolveDeps(options: SyncClientOptions): SyncDeps {
  const g = globalThis as Record<string, unknown>;
  const ES = g['EventSource'] as (new (url: string) => EventSourceLike) | undefined;
  const BC = g['BroadcastChannel'] as (new (name: string) => BroadcastLike) | undefined;
  const locks = (g['navigator'] as { locks?: LockManagerLike } | undefined)?.locks;
  let storage: StorageLike | null;
  try {
    storage = (g['localStorage'] as StorageLike | undefined) ?? null;
  } catch {
    storage = null;
  }
  const pick = <K extends keyof SyncDeps>(key: K, fallback: SyncDeps[K]): SyncDeps[K] =>
    key in options ? (options[key] as SyncDeps[K]) : fallback;
  return {
    url: options.url,
    fetch: pick('fetch', globalThis.fetch.bind(globalThis)),
    eventSource: pick('eventSource', ES === undefined ? null : (url) => new ES(url)),
    locks: pick('locks', locks ?? null),
    broadcast: pick('broadcast', BC === undefined ? null : (name) => new BC(name)),
    storage: pick('storage', storage),
    serverKey: pick('serverKey', typeof location === 'undefined' ? 'server' : location.origin),
    tabId: pick('tabId', randomId()),
    ...(options.name === undefined ? {} : { name: options.name }),
    now: pick('now', () => Date.now()),
    setTimeout: pick('setTimeout', (fn, ms) => setTimeout(fn, ms)),
    clearTimeout: pick('clearTimeout', (h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    random: pick('random', () => Math.random()),
    isOnline: pick('isOnline', () => (typeof navigator === 'undefined' ? true : navigator.onLine)),
    sseTypes: pick('sseTypes', EVENT_TYPES),
  };
}
