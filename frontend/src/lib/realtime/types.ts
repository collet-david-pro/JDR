/**
 * Public contract of the real-time client (etapes/P06 "Contrat front (P6d)", projet.md 10.3).
 * The consumer subscribes to channels with the `last_event_id` of its snapshot; transports,
 * automatic selection, backoff and the one-stream-per-browser leader are hidden behind it.
 */

export type TransportMode = 'sse' | 'longpoll' | 'poll';
export type NetState = 'connecting' | 'online' | 'reconnecting' | 'offline';

/** An event as sent by GET /events and GET /stream (identifiers are strings). */
export interface WireEvent {
  id: string;
  channel: string;
  type: string;
  payload: unknown;
  actor: string | null;
  client_op_id: string | null;
  at: string;
}

export interface SyncStatus {
  mode: TransportMode;
  state: NetState;
  /** This tab owns the stream (always true without Web Locks / BroadcastChannel). */
  leader: boolean;
  lastEventId: string | null;
}

export type SyncActivity = 'running' | 'lobby' | 'paused' | 'hidden';

export interface SyncHandlers {
  onEvent(e: WireEvent): void;
  /**
   * `since` is older than the oldest kept event of the channel (410 events_gone): the consumer
   * reloads its snapshot and subscribes again (the subscription receives nothing more).
   */
  onGone(channel: string): void;
}

export interface SyncClient {
  /** Union of the channels of all tabs; `since` = last_event_id of the snapshot. */
  subscribe(channels: string[], since: string, h: SyncHandlers): () => void;
  /** Interval of the short polling: 1 s (running), 3 s (lobby), 8 s (paused / hidden). */
  setActivity(a: SyncActivity): void;
  readonly status: SyncStatus;
  onStatus(cb: (s: SyncStatus) => void): () => void;
  close(): void;
}

/** Interval of the short polling by activity (projet.md 10.3). */
export const POLL_INTERVAL_MS: Readonly<Record<SyncActivity, number>> = {
  running: 1000,
  lobby: 3000,
  paused: 8000,
  hidden: 8000,
};

/** Constants of the automatic selection (projet.md 10.3). */
export const SSE_SILENCE_MS = 5000;
export const SSE_SHORT_CUT_MS = 3000;
export const SSE_CUT_WINDOW_MS = 60_000;
export const SSE_MAX_SHORT_CUTS = 3;
export const LONGPOLL_WAIT_S = 20;
export const LONGPOLL_MAX_CUTS = 3;
export const BEST_MODE_RETRY_MS = 5 * 60_000;
export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 15_000;
export const BACKOFF_JITTER = 0.3;
/** The server accepts at most 4 channels per request. */
export const MAX_CHANNELS = 4;
