/**
 * The three transports of projet.md 10.3 as small building blocks: an EventSource wrapper
 * (GET /stream) and one request of GET /events (long polling with `wait`, short polling without).
 * The loops, the selection and the backoff live in flow.ts.
 */
import { ApiError, parseEnvelope } from '../api';
import type { EventSourceLike, SyncDeps } from './deps';
import type { WireEvent } from './types';
import { isEventId, parseWireEvent, toWireEvent } from './util';

export interface SseHandlers {
  /** Any message, `ping` included; `lastEventId` is the browser's last id (cursor only). */
  onMessage(lastEventId: string | null): void;
  onEvent(event: WireEvent): void;
  /** `event: events_gone` (one per channel, then the server ends the stream). */
  onGone(channel: string): void;
  /** The stream ended (server end after 25 s, network error, refusal). Called once. */
  onEnd(): void;
}

/**
 * Opens the stream. EventSource would reconnect by itself: the wrapper closes it on the first
 * error and lets the flow decide (cursor in the URL, backoff, mode change).
 */
export function openSse(
  deps: SyncDeps,
  url: string,
  h: SseHandlers,
): { close(): void; readonly source: EventSourceLike } {
  const create = deps.eventSource;
  if (create === null) throw new Error('EventSource is not available');
  const source = create(url);
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    source.close();
    h.onEnd();
  };
  const cursor = (e: { lastEventId?: string }): string | null =>
    isEventId(e.lastEventId) ? e.lastEventId : null;

  const names = new Set<string>(['message', ...deps.sseTypes]);
  for (const name of names) {
    source.addEventListener(name, (e) => {
      if (ended) return;
      const event = parseWireEvent(e.data);
      if (event !== null) {
        h.onMessage(event.id);
        h.onEvent(event);
      } else {
        h.onMessage(cursor(e));
      }
    });
  }
  source.addEventListener('ping', (e) => {
    if (!ended) h.onMessage(cursor(e));
  });
  source.addEventListener('events_gone', (e) => {
    if (ended) return;
    h.onMessage(cursor(e));
    try {
      const data = JSON.parse(e.data ?? '{}') as { channel?: unknown };
      if (typeof data.channel === 'string') h.onGone(data.channel);
    } catch {
      // Malformed: the end of the stream follows anyway.
    }
  });
  source.addEventListener('error', end);
  return {
    source,
    close: () => {
      ended = true;
      source.close();
    },
  };
}

export interface EventsPage {
  readonly events: WireEvent[];
  readonly lastId: string;
}

export type FetchFailureKind = 'gone' | 'network' | 'timeout' | 'client' | 'server';

/** Failure of one GET /events request. */
export class EventsFetchError extends Error {
  override readonly name = 'EventsFetchError';

  constructor(
    readonly kind: FetchFailureKind,
    readonly status: number,
    /** Channels of a 410 events_gone. */
    readonly channels: readonly string[] = [],
  ) {
    super(`events request failed (${kind} ${status})`);
  }
}

/**
 * One GET /events?channels&since&wait request. Timeout: wait + 10 s. 410 events_gone ⇒ kind
 * `gone` with the channels the server names (`fields.channels`), else every asked channel.
 */
export async function fetchEvents(
  deps: SyncDeps,
  channels: readonly string[],
  since: string,
  wait: number,
): Promise<EventsPage> {
  const url = deps.url('/events', { channels: [...channels], since, wait });
  const controller = new AbortController();
  let timedOut = false;
  const timer = deps.setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    (wait + 10) * 1000,
  );
  try {
    const response = await deps.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = parseEnvelope<{ events?: unknown; last_id?: unknown }>(
      response.status,
      text,
      response.headers.get('X-Request-Id'),
      response.headers.get('Retry-After'),
    );
    const data = parsed.data;
    const events: WireEvent[] = [];
    if (Array.isArray(data?.events)) {
      for (const raw of data.events) {
        const event = toWireEvent(raw);
        if (event !== null) events.push(event);
      }
    }
    const last = data?.last_id;
    const lastId = isEventId(last) ? last : isEventId(String(last)) ? String(last) : since;
    return { events, lastId };
  } catch (error) {
    if (error instanceof EventsFetchError) throw error;
    if (error instanceof ApiError) {
      if (error.status === 410) {
        const named = error.fields['channels'];
        const list = named === undefined || named === '' ? channels : named.split(',');
        throw new EventsFetchError('gone', 410, list);
      }
      throw new EventsFetchError(
        error.status >= 400 && error.status < 500 ? 'client' : 'server',
        error.status,
      );
    }
    throw new EventsFetchError(timedOut ? 'timeout' : 'network', 0);
  } finally {
    deps.clearTimeout(timer);
  }
}
