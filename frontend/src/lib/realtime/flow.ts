/**
 * One stream of events for the browser (the leader tab's, or a tab's own without Web Locks):
 * runs the selected transport, switches mode by the rules of projet.md 10.3, reconnects with
 * backoff, and hands events / cursor / 410 to its sink. It knows nothing about subscribers.
 */
import type { SyncDeps } from './deps';
import { MODE_LADDER, ModeMemory } from './mode-memory';
import { EventsFetchError, fetchEvents, openSse } from './transports';
import {
  BEST_MODE_RETRY_MS,
  LONGPOLL_MAX_CUTS,
  LONGPOLL_WAIT_S,
  MAX_CHANNELS,
  POLL_INTERVAL_MS,
  SSE_CUT_WINDOW_MS,
  SSE_MAX_SHORT_CUTS,
  SSE_SHORT_CUT_MS,
  SSE_SILENCE_MS,
  type NetState,
  type TransportMode,
  type WireEvent,
} from './types';
import { backoffDelay, compareIds, isEventId, maxId } from './util';

export interface FlowSink {
  events(events: WireEvent[]): void;
  /** The cursor moved (with or without events). */
  cursor(id: string): void;
  gone(channels: string[]): void;
  /** mode or state changed. */
  status(): void;
}

/** A long polling request that fails this much before `wait` was cut by a proxy. */
const EARLY_MARGIN_MS = 2000;

export class Flow {
  mode: TransportMode;
  state: NetState = 'offline';
  cursor: string | null = null;

  private channels: string[] = [];
  private pollMs: number = POLL_INTERVAL_MS.running;
  private gen = 0;
  private closeConn: (() => void) | null = null;
  private timer: unknown = null;
  private wake: (() => void) | null = null;
  private silenceTimer: unknown = null;
  private bestTimer: unknown = null;
  private attempts = 0;
  private cuts: number[] = [];
  private lpCuts = 0;
  private trial: { from: TransportMode; next: TransportMode[] } | null = null;
  private halted = false;
  private readonly memory: ModeMemory;

  constructor(
    private readonly deps: SyncDeps,
    private readonly sink: FlowSink,
  ) {
    this.memory = new ModeMemory(deps.storage, deps.serverKey);
    this.mode = this.usable(this.memory.read() ?? 'sse');
  }

  /**
   * Channels (≤ 4) and cursor to read from. A cursor older than the current one, a new set of
   * channels or a flow halted by a 410 restart the connection; a newer cursor is just adopted.
   */
  configure(channels: readonly string[], cursor: string | null): void {
    const wanted = channels.slice(0, MAX_CHANNELS);
    if (wanted.length === 0) {
      this.stop();
      return;
    }
    const sameChannels =
      wanted.length === this.channels.length && wanted.every((c, i) => c === this.channels[i]);
    const older = cursor !== null && this.cursor !== null && compareIds(cursor, this.cursor) < 0;
    const running = this.gen > 0 && this.state !== 'offline';
    this.channels = wanted;
    if (cursor !== null) this.cursor = cursor;
    if (!running || !sameChannels || older || this.halted) this.restart();
  }

  setPollInterval(ms: number): void {
    if (ms === this.pollMs) return;
    this.pollMs = ms;
    if (this.mode === 'poll') this.wake?.();
  }

  stop(): void {
    this.gen++;
    this.teardown();
    this.clearBest();
    this.channels = [];
    this.cursor = null;
    this.halted = false;
    this.attempts = 0;
    this.trial = null;
    this.setState('offline');
  }

  // ---- connection life cycle -------------------------------------------------------------

  private restart(): void {
    this.gen++;
    this.teardown();
    this.halted = false;
    this.resetCounters();
    this.scheduleBest();
    this.setState(this.state === 'online' ? 'online' : 'connecting');
    this.connect();
  }

  private resetCounters(): void {
    this.attempts = 0;
    this.cuts = [];
    this.lpCuts = 0;
  }

  private connect(): void {
    const gen = this.gen;
    if (this.mode === 'sse' && this.deps.eventSource === null) this.mode = 'longpoll';
    if (this.mode === 'sse') this.connectSse(gen);
    else void this.pollLoop(gen, this.mode === 'longpoll' ? LONGPOLL_WAIT_S : 0);
  }

  private connectSse(gen: number): void {
    const openedAt = this.deps.now();
    const gone: string[] = [];
    let seen = false;
    const watchSilence = (): void => {
      this.silenceTimer = this.deps.setTimeout(() => {
        if (gen !== this.gen || seen) return;
        // Offline: silence proves nothing about the transport, keep waiting.
        if (this.deps.isOnline()) this.modeFailed();
        else watchSilence();
      }, SSE_SILENCE_MS);
    };
    watchSilence();
    const url = this.deps.url('/stream', { channels: this.channels, since: this.cursor ?? '0' });
    try {
      const conn = openSse(this.deps, url, {
        onMessage: (id) => {
          if (gen !== this.gen) return;
          if (!seen) {
            seen = true;
            this.deps.clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
            this.alive();
          }
          this.advance(id);
        },
        onEvent: (e) => {
          if (gen === this.gen) this.deliver([e]);
        },
        onGone: (channel) => {
          if (gen === this.gen) gone.push(channel);
        },
        onEnd: () => {
          if (gen !== this.gen) return;
          this.closeConn = null;
          if (this.silenceTimer !== null) this.deps.clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
          if (gone.length > 0) this.onGone(gone);
          else this.sseEnded(seen, this.deps.now() - openedAt);
        },
      });
      this.closeConn = conn.close;
    } catch {
      this.modeFailed();
    }
  }

  private sseEnded(seen: boolean, aliveMs: number): void {
    if (seen && aliveMs >= SSE_SHORT_CUT_MS) {
      // Normal end (the server closes the stream after 25 s): reconnect at once.
      this.attempts = 0;
      this.connect();
      return;
    }
    if (this.deps.isOnline()) {
      const now = this.deps.now();
      this.cuts = this.cuts.filter((t) => now - t < SSE_CUT_WINDOW_MS);
      this.cuts.push(now);
      if (this.cuts.length > SSE_MAX_SHORT_CUTS) {
        this.modeFailed();
        return;
      }
    }
    if (this.trial !== null) {
      this.modeFailed();
      return;
    }
    this.retryLater();
  }

  private async pollLoop(gen: number, wait: number): Promise<void> {
    while (gen === this.gen) {
      const started = this.deps.now();
      let page;
      try {
        page = await fetchEvents(this.deps, this.channels, this.cursor ?? '0', wait);
      } catch (error) {
        if (gen !== this.gen) return;
        const failure =
          error instanceof EventsFetchError ? error : new EventsFetchError('network', 0);
        if (failure.kind === 'gone') {
          this.onGone([...failure.channels]);
          return;
        }
        const early = wait > 0 && this.deps.now() - started < wait * 1000 - EARLY_MARGIN_MS;
        if (early && failure.kind !== 'client' && this.deps.isOnline()) this.lpCuts++;
        if (this.trial !== null || this.lpCuts >= LONGPOLL_MAX_CUTS) {
          this.modeFailed();
          return;
        }
        this.setState('reconnecting');
        await this.sleep(backoffDelay(this.attempts++, this.deps.random));
        continue;
      }
      if (gen !== this.gen) return;
      this.alive();
      if (wait > 0 && this.deps.now() - started >= wait * 1000 - EARLY_MARGIN_MS) this.lpCuts = 0;
      this.deliver(page.events);
      this.advance(page.lastId);
      if (wait === 0) await this.sleep(this.pollMs);
    }
  }

  // ---- incoming data ----------------------------------------------------------------------

  private alive(): void {
    this.attempts = 0;
    this.setState('online');
    if (this.trial !== null) {
      this.trial = null;
      this.memory.write(this.mode);
      this.scheduleBest();
    }
  }

  private deliver(events: WireEvent[]): void {
    if (events.length === 0) return;
    for (const e of events) this.advance(e.id);
    this.sink.events(events);
  }

  private advance(id: string | null): void {
    if (id === null || !isEventId(id)) return;
    const next = maxId(this.cursor, id);
    if (next !== null && next !== this.cursor) {
      this.cursor = next;
      this.sink.cursor(next);
    }
  }

  private onGone(channels: string[]): void {
    this.gen++;
    this.halted = true;
    this.teardown();
    this.setState('reconnecting');
    this.sink.gone(channels);
  }

  // ---- mode selection ---------------------------------------------------------------------

  private usable(mode: TransportMode): TransportMode {
    return mode === 'sse' && this.deps.eventSource === null ? 'longpoll' : mode;
  }

  /** The current transport is unusable: next trial mode, or one step down (memorised). */
  private modeFailed(): void {
    this.gen++;
    this.teardown();
    this.resetCounters();
    if (this.trial !== null) {
      const next = this.trial.next.shift();
      if (next !== undefined) this.mode = next;
      else {
        this.mode = this.trial.from;
        this.trial = null;
        this.scheduleBest();
      }
    } else {
      const i = MODE_LADDER.indexOf(this.mode);
      this.mode = MODE_LADDER[Math.min(i + 1, MODE_LADDER.length - 1)] ?? 'poll';
      this.memory.write(this.mode);
      this.scheduleBest();
    }
    this.setState('connecting');
    this.sink.status();
    this.connect();
  }

  /** Every 5 minutes, tries the better modes again (projet.md 10.3, rule 3). */
  private scheduleBest(): void {
    if (this.bestTimer !== null || this.trial !== null || this.mode === 'sse') return;
    this.bestTimer = this.deps.setTimeout(() => {
      this.bestTimer = null;
      if (this.channels.length === 0 || this.halted) {
        this.scheduleBest();
        return;
      }
      const here = MODE_LADDER.indexOf(this.mode);
      const better = MODE_LADDER.slice(0, here).filter((m) => this.usable(m) === m);
      const first = better[0];
      if (first === undefined) return;
      this.trial = { from: this.mode, next: better.slice(1) };
      this.mode = first;
      this.gen++;
      this.teardown();
      this.resetCounters();
      this.sink.status();
      this.connect();
    }, BEST_MODE_RETRY_MS);
  }

  private clearBest(): void {
    if (this.bestTimer !== null) this.deps.clearTimeout(this.bestTimer);
    this.bestTimer = null;
  }

  // ---- helpers ----------------------------------------------------------------------------

  private retryLater(): void {
    const gen = this.gen;
    this.setState('reconnecting');
    this.timer = this.deps.setTimeout(
      () => {
        this.timer = null;
        if (gen === this.gen) this.connect();
      },
      backoffDelay(this.attempts++, this.deps.random),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        if (this.timer !== null) this.deps.clearTimeout(this.timer);
        this.timer = null;
        this.wake = null;
        resolve();
      };
      this.wake = done;
      this.timer = this.deps.setTimeout(done, ms);
    });
  }

  private teardown(): void {
    this.closeConn?.();
    this.closeConn = null;
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
    if (this.silenceTimer !== null) this.deps.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private setState(state: NetState): void {
    if (state === this.state) return;
    this.state = state;
    this.sink.status();
  }
}
