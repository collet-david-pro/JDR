/**
 * Reactive model of one projection screen (no UI): pairing, the screen's own record
 * (`GET /display/me`, read every 30 s, every 10 s while the session is over), the session it
 * shows (a SessionRun on the screen's API, stream `as=display`), the table viewers, the text to
 * read and the reactions to the screen events (D13):
 *
 * - any 401 `display_unpaired`, or `display.revoked` with its own id ⇒ `unpaired`, all stops;
 * - `display.updated` with its own id ⇒ settings updated (another id: ignored);
 * - `session.state` → `ended`, or a refused stream (409 `session_not_running`) ⇒ `waiting`, the
 *   stream is closed; an attached session (seen by the next `/display/me`) starts again;
 * - 404 (screen moved to another session) ⇒ `/display/me` read again, new session followed;
 * - `409 session_paused` of the snapshot ⇒ state built from `/display/me` (SessionSync does it).
 *
 * `run.state` and `run.scene` are raw values (see SessionRun).
 */
import { ApiError } from '../api';
import type { SyncClient, WireEvent } from '../realtime/types';
import { compareIds, isEventId } from '../realtime/util';
import type { TileSource } from '../sessions/scene';
import { SessionRun } from '../sessions/session-run.svelte';
import type { SessionsClient } from '../sessions/sessions-client';
import type { ChunkKey } from '../../editor/contracts';
import type { DeviceClient } from './device-client';
import { readAloudMs } from './read-aloud';
import { displaySessionApi } from './session-api';
import type {
  DeviceSettingsPatch,
  DisplayMe,
  DisplayRevokedPayload,
  DisplayStatus,
  DisplayUpdatedPayload,
} from './types';
import { tableViewers } from './viewers';

export const ME_POLL_MS = 30_000;
export const ME_POLL_WAITING_MS = 10_000;
/** Delay before reading `/display/me` again after a 404 (screen moved). */
const MOVED_RETRY_MS = 2_000;

/** Text to read, closed by itself after `readAloudMs` (D11). */
export interface DisplayReadAloud {
  readonly eventId: string;
  readonly title: string;
  readonly body: string;
}

export interface DisplayRunOptions {
  readonly device: Pick<DeviceClient, 'pair' | 'me' | 'patchMe' | 'unpair'>;
  readonly sessions: Pick<SessionsClient, 'snapshot'>;
  readonly tiles: TileSource;
  readonly sync: SyncClient;
  /** Blocks of the engine camera to load first. */
  readonly visible?: () => readonly ChunkKey[] | undefined;
  /** Non-fatal error (failed refresh, partial loading...). */
  readonly onProblem?: (error: unknown) => void;
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** 401 `display_unpaired`: unknown or revoked screen. */
const isUnpaired = (e: unknown): boolean => e instanceof ApiError && e.status === 401;

export class DisplayRun {
  /** The first `/display/me` has not answered yet. */
  loading = $state(true);
  /** `POST /display/pair` in progress. */
  pairing = $state(false);
  pairError = $state.raw<ApiError | null>(null);
  /** Last record read (`null`: not paired). */
  me = $state.raw<DisplayMe | null>(null);
  /** Followed session; `null` when nothing is followed (not paired, lobby not started, waiting). */
  run = $state.raw<SessionRun | null>(null);
  readAloud = $state.raw<DisplayReadAloud | null>(null);
  /** Last failure that is not fatal (see `onProblem`). */
  error = $state.raw<unknown>(null);
  /** The session is over (`session.state` ended or stream refused). */
  private ended = $state(false);

  readonly settings = $derived(this.me?.settings ?? null);

  readonly status: DisplayStatus = $derived.by(() => {
    if (this.pairing) return 'pairing';
    const me = this.me;
    if (me === null) return 'unpaired';
    if (this.ended || me.status === 'waiting') return 'waiting';
    const s = this.run?.state?.session.state ?? me.status;
    return s === 'ended' ? 'waiting' : s;
  });

  /** Table viewers of the current floor (D5), recomputed at every state change. */
  readonly viewers: readonly string[] = $derived.by(() => {
    const state = this.run?.state;
    return state === null || state === undefined
      ? []
      : tableViewers(state, state.session.current_floor_id);
  });

  /** Pause image: ids and text from the stream, signed URL from `/display/me`. */
  readonly pauseScreen = $derived.by(() => {
    const own = this.run?.state?.session.pause_screen ?? this.me?.session.pause_screen ?? null;
    if (own === null) return null;
    const url = own.url ?? this.me?.session.pause_screen?.url ?? null;
    return { asset_id: own.asset_id, text: own.text, url };
  });

  private runSession: string | null = null;
  private stopped = false;
  private pollTimer: unknown = null;
  private offStatus: (() => void) | null = null;
  private noteTimer: unknown = null;
  private refreshing: Promise<void> | null = null;
  private lastEvent = '0';
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;

  constructor(private readonly o: DisplayRunOptions) {
    this.setT = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = o.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Reads the screen's record and follows its session. Resolves once the first answer is in. */
  start(): Promise<void> {
    this.stopped = false;
    // The stream hides a 401 (revoked screen) behind its reconnections: when it loses the
    // connection, `/display/me` tells at once whether the screen is still paired (P7d).
    this.offStatus ??= this.o.sync.onStatus((status) => {
      if (this.stopped || this.me === null) return;
      if (status.state === 'reconnecting' || status.state === 'offline') void this.refresh();
    });
    return this.refresh();
  }

  /** Stops everything for good (page closed). */
  stop(): void {
    this.stopped = true;
    this.offStatus?.();
    this.offStatus = null;
    this.cancelPoll();
    this.dropRun();
    this.clearNote();
  }

  /** The page was hidden / shown. */
  setHidden(hidden: boolean): void {
    this.run?.setHidden(hidden);
  }

  /** Pairs with the code shown to the GM. Resolves false (see `pairError`) when refused. */
  async pair(code: string): Promise<boolean> {
    this.pairing = true;
    this.pairError = null;
    try {
      const me = await this.o.device.pair(code);
      this.stopped = false;
      this.loading = false;
      await this.adopt(me);
      return true;
    } catch (error) {
      this.pairError = error instanceof ApiError ? error : null;
      if (this.pairError === null) this.problem(error);
      return false;
    } finally {
      this.pairing = false;
    }
  }

  /** Forgets this device (best effort on the server). */
  async unpair(): Promise<void> {
    try {
      await this.o.device.unpair();
    } catch {
      /* the device forgets the pairing anyway */
    }
    this.markUnpaired();
  }

  /** The screen is no longer paired: everything stops, the pairing page can be shown. */
  markUnpaired(): void {
    this.cancelPoll();
    this.dropRun();
    this.clearNote();
    this.ended = false;
    this.me = null;
    this.loading = false;
  }

  /** Changes `diagonal_in`, `px_per_mm`, `rotation`, `mirror` (applied at once, undone on failure). */
  async saveSettings(patch: DeviceSettingsPatch): Promise<void> {
    const before = this.me;
    if (before === null) return;
    this.me = { ...before, settings: { ...before.settings, ...patch } };
    try {
      const me = await this.o.device.patchMe(patch);
      if (this.me !== null) this.me = { ...this.me, settings: me.settings, name: me.name };
    } catch (error) {
      if (this.me !== null && !isUnpaired(error)) {
        this.me = { ...this.me, settings: before.settings };
      }
      throw error;
    }
  }

  /** Closes the text to read. */
  dismissReadAloud(): void {
    this.clearNote();
  }

  /** Reads `/display/me` now (coalesced) and reconciles the followed session with it. */
  refresh(): Promise<void> {
    if (this.refreshing !== null) return this.refreshing;
    const job = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    this.refreshing = job;
    return job;
  }

  // ---- record and session ---------------------------------------------------------------

  private async doRefresh(): Promise<void> {
    if (this.stopped) return;
    this.cancelPoll();
    try {
      const me = await this.o.device.me();
      if (this.stopped) return;
      this.ended = false;
      await this.adopt(me);
    } catch (error) {
      if (isUnpaired(error)) this.markUnpaired();
      else {
        this.problem(error);
        this.schedule();
      }
    } finally {
      this.loading = false;
    }
  }

  private async adopt(me: DisplayMe): Promise<void> {
    this.me = me;
    const waiting = me.status === 'waiting';
    if (this.run !== null && (waiting || this.runSession !== me.session.id)) this.dropRun();
    if (!waiting && this.run === null) await this.startRun(me);
    // A failed start has already planned its own retry.
    if (this.pollTimer === null) this.schedule();
  }

  private async startRun(me: DisplayMe): Promise<void> {
    const run: SessionRun = new SessionRun({
      sessionId: me.session.id,
      userId: `display:${me.id}`,
      api: displaySessionApi(this.o.sessions, this.o.device),
      sync: this.o.sync,
      tiles: this.o.tiles,
      ...(this.o.visible === undefined ? {} : { visible: this.o.visible }),
      onEvent: (event) => this.onEvent(run, event),
      onProblem: (error) => this.problem(error),
    });
    this.run = run;
    this.runSession = me.session.id;
    await run.start();
    if (this.run !== run) return;
    if (run.phase === 'error') this.failRun(run.error);
  }

  private failRun(error: unknown): void {
    this.dropRun();
    if (isUnpaired(error)) {
      this.markUnpaired();
    } else if (error instanceof ApiError && error.code === 'session_not_running') {
      this.ended = true;
    } else if (error instanceof ApiError && error.status === 404) {
      // The screen was moved: `/display/me` tells which session.
      this.schedule(MOVED_RETRY_MS);
      return;
    } else {
      this.problem(error);
    }
    this.schedule();
  }

  private dropRun(): void {
    const run = this.run;
    this.run = null;
    this.runSession = null;
    this.lastEvent = '0';
    run?.stop();
  }

  private schedule(ms?: number): void {
    this.cancelPoll();
    if (this.stopped || this.me === null) return;
    const delay = ms ?? (this.status === 'waiting' ? ME_POLL_WAITING_MS : ME_POLL_MS);
    this.pollTimer = this.setT(() => void this.refresh(), delay);
  }

  private cancelPoll(): void {
    if (this.pollTimer !== null) this.clearT(this.pollTimer);
    this.pollTimer = null;
  }

  private problem(error: unknown): void {
    this.error = error;
    this.o.onProblem?.(error);
  }

  // ---- events ---------------------------------------------------------------------------

  /** Events the reducer does not know: the screen's own and the text to read. */
  private onEvent(run: SessionRun, e: WireEvent): void {
    if (this.run !== run || !isEventId(e.id) || compareIds(e.id, this.lastEvent) <= 0) return;
    this.lastEvent = e.id;
    const p = rec(e.payload);
    switch (e.type) {
      case 'display.revoked':
        if (this.ownId((p as Partial<DisplayRevokedPayload>).display_id)) this.markUnpaired();
        return;
      case 'display.updated':
        this.updated((p as Partial<DisplayUpdatedPayload>).display);
        return;
      case 'note.read_aloud':
        this.note(e.id, p['title'], p['body']);
        return;
      case 'session.state':
        this.sessionState(run, p);
        return;
      default:
        return;
    }
  }

  private ownId(id: unknown): boolean {
    return (
      this.me !== null &&
      (typeof id === 'string' || typeof id === 'number') &&
      String(id) === this.me.id
    );
  }

  private updated(display: Partial<DisplayUpdatedPayload['display']> | undefined): void {
    const me = this.me;
    if (me === null || display === undefined || !this.ownId(display.id)) return;
    if (display.session_id != null && String(display.session_id) !== me.session.id) {
      void this.refresh();
      return;
    }
    this.me = {
      ...me,
      name: display.name ?? me.name,
      settings: display.settings ?? me.settings,
    };
  }

  private sessionState(run: SessionRun, p: Record<string, unknown>): void {
    if (p['state'] === 'ended') {
      // Deferred: the reducer is still working on this very event.
      queueMicrotask(() => {
        if (this.run !== run) return;
        this.dropRun();
        this.ended = true;
        this.schedule();
      });
      return;
    }
    const pause = rec(p['pause_screen']);
    if (p['state'] === 'paused' && p['pause_screen'] != null && !('url' in pause)) {
      // The image is signed per screen: only `/display/me` carries its URL.
      void this.refresh();
    }
  }

  private note(eventId: string, title: unknown, body: unknown): void {
    const t = typeof title === 'string' ? title : '';
    const b = typeof body === 'string' ? body : '';
    if (t === '' && b === '') return;
    this.clearNote();
    this.readAloud = { eventId, title: t, body: b };
    this.noteTimer = this.setT(
      () => {
        if (this.readAloud?.eventId === eventId) this.readAloud = null;
        this.noteTimer = null;
      },
      readAloudMs(t, b),
    );
  }

  private clearNote(): void {
    if (this.noteTimer !== null) this.clearT(this.noteTimer);
    this.noteTimer = null;
    this.readAloud = null;
  }
}
