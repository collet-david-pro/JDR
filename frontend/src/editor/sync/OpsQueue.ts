/**
 * Persistent queue of map ops (projet.md 15.1, 13.5, 22 "zéro perte de travail").
 *
 * - Ops coming from the history are added to an open batch (merged, limits kept: batch.ts).
 * - The open batch is written to the local store shortly after each change (≤ 1 s), and every
 *   batch is written again just before it is sent; it is removed only once the server has
 *   confirmed it.
 * - Sending: after 1.5 s without new ops, or 5 s at the latest; one request at a time, in
 *   order; a batch keeps its client_op_id forever (identical replay, idempotent on the server).
 * - Network failures: offline state, retry with backoff, immediate retry on `online`.
 * - Server answers: `conflicts` ⇒ "conflict resolved"; 409 revision_conflict ⇒ the resize is
 *   dropped and the queue waits for a reload; 413 ⇒ the batch is split; 422 and other refusals
 *   ⇒ the batch is dropped and reported; 401/403/404 ⇒ the queue pauses (ops kept locally).
 */
import type { MapOp } from '../contracts';
import type { MapOpsRequest, MapOpsResult } from '../../lib/types';
import type { PendingBatch, PendingOpsStore } from '../../lib/persistence/map-stores';
import { OpenBatch, countChanges } from './batch';
import { toWireOp } from './wire';

export const SEND_IDLE_MS = 1500;
export const SEND_MAX_WAIT_MS = 5000;
export const PERSIST_IDLE_MS = 250;
export const PERSIST_MAX_WAIT_MS = 1000;
export const KEEPALIVE_MAX_BYTES = 64 * 1024;
export const CONFLICT_NOTICE_MS = 4000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000] as const;

export interface OpsTransport {
  send(body: MapOpsRequest, options: { keepalive: boolean }): Promise<MapOpsResult>;
}

/** Error thrown by the transport (ApiError is compatible). */
export interface TransportError {
  readonly code: string;
  readonly status: number;
  /** 422 field errors: `ops.<i>[.<key>…]` locate the refused op (or `ops.<i>.cells.<j>`). */
  readonly fields?: Readonly<Record<string, string>>;
}

export type SaveState = 'saved' | 'saving' | 'offline' | 'conflict' | 'error';

export interface SaveStatus {
  readonly state: SaveState;
  /** Unconfirmed modifications (distinct cells + other ops). */
  readonly pending: number;
  /** Error code when state = error (rejected, revision_conflict, forbidden, ...). */
  readonly error: string | null;
  /** False when ops only live in memory (no IndexedDB). */
  readonly durable: boolean;
}

export interface QueueEvents {
  /** A batch was refused by the server and dropped (422, 4xx). */
  onRejected?(batch: PendingBatch, error: TransportError): void;
  /** The map changed on the server in an incompatible way: reload it. */
  onReloadRequired?(): void;
  /** A batch was confirmed. `inSync`: the server state is exactly the local state. */
  onConfirmed?(revision: number, inSync: boolean): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface OpsQueueOptions extends QueueEvents {
  readonly mapId: string;
  /** Server revision of the loaded map. */
  readonly revision: number;
  readonly store: PendingOpsStore;
  readonly transport: OpsTransport;
  readonly clock?: Clock;
  readonly isOnline?: () => boolean;
  readonly newId?: () => string;
}

/** Random client_op_id (≤ 40 characters, processed_ops.client_op_id). */
export function newClientOpId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function errorOf(e: unknown): TransportError {
  if (typeof e === 'object' && e !== null && 'code' in e && 'status' in e) {
    const { code, status, fields } = e as { code: unknown; status: unknown; fields?: unknown };
    if (typeof code === 'string' && typeof status === 'number') {
      return typeof fields === 'object' && fields !== null
        ? { code, status, fields: fields as Record<string, string> }
        : { code, status };
    }
  }
  return { code: 'network_error', status: 0 };
}

interface Batch {
  seq: number;
  clientOpId: string;
  /** Open batch (still accepting ops) — null once closed. */
  open: OpenBatch | null;
  ops: MapOp[];
  baseRevision: number | null;
  sealed: boolean;
}

export class OpsQueue {
  private readonly mapId: string;
  private readonly store: PendingOpsStore;
  private readonly transport: OpsTransport;
  private readonly clock: Clock;
  private readonly isOnline: () => boolean;
  private readonly newId: () => string;
  private readonly events: QueueEvents;

  private batches: Batch[] = [];
  private seqCounter = 0;
  private revision: number;
  /** The local state equals the server state at `revision` (no foreign write seen). */
  private inSync = true;
  private inFlight: Promise<void> | null = null;
  private offline = false;
  private paused: string | null = null;
  private rejected: string | null = null;
  private conflictUntil = 0;
  private attempts = 0;
  private openSince: number | null = null;
  private lastPushAt: number | null = null;
  private persistSince: number | null = null;
  private sendTimer: unknown = null;
  private persistTimer: unknown = null;
  private retryTimer: unknown = null;
  private conflictTimer: unknown = null;
  private disposed = false;
  private readonly listeners = new Set<(status: SaveStatus) => void>();
  private lastStatus: SaveStatus | null = null;

  constructor(options: OpsQueueOptions) {
    this.mapId = options.mapId;
    this.revision = options.revision;
    this.store = options.store;
    this.transport = options.transport;
    this.clock = options.clock ?? realClock;
    this.isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false);
    this.newId = options.newId ?? newClientOpId;
    this.events = options;
    this.offline = !this.isOnline();
  }

  /**
   * Loads the batches left by a previous page (not confirmed). Returns their ops, to be applied
   * again to the freshly loaded map; they are sent by the next `flush`/`kick`.
   */
  async restore(): Promise<{ seq: number; ops: MapOp[] }[]> {
    let stored: PendingBatch[] = [];
    try {
      stored = await this.store.list(this.mapId);
    } catch (error) {
      console.error(error);
    }
    const restored: Batch[] = stored.map((b) => ({
      seq: b.seq,
      clientOpId: b.clientOpId,
      open: null,
      ops: [...b.ops],
      baseRevision: b.baseRevision,
      sealed: b.sealed,
    }));
    this.batches = [...restored, ...this.batches];
    for (const b of restored) this.seqCounter = Math.max(this.seqCounter, b.seq);
    this.emit();
    return restored.map((b) => ({ seq: b.seq, ops: b.ops }));
  }

  /**
   * Replaces the ops of a restored batch that no longer apply as they were (palette index taken
   * by another asset, invalid op): new content ⇒ new client_op_id, built against the current
   * revision.
   */
  rewrite(seq: number, ops: readonly MapOp[]): void {
    const batch = this.batches.find((b) => b.seq === seq && b.open === null);
    if (batch === undefined) return;
    this.replace(batch, [{ ...batch, ops: [...ops] }]);
    this.emit();
  }

  get status(): SaveStatus {
    const pending = this.pendingChanges;
    let state: SaveState;
    if (this.paused !== null || (this.rejected !== null && pending === 0)) state = 'error';
    else if (this.offline) state = 'offline';
    else if (pending > 0 || this.inFlight !== null) state = 'saving';
    else if (this.clock.now() < this.conflictUntil) state = 'conflict';
    else state = 'saved';
    return {
      state,
      pending,
      error: this.paused ?? (state === 'error' ? this.rejected : null),
      durable: this.store.durable,
    };
  }

  /** Ops not confirmed by the server (beforeunload). */
  get hasUnconfirmed(): boolean {
    return this.batches.length > 0;
  }

  get serverRevision(): number {
    return this.revision;
  }

  onStatus(listener: (status: SaveStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Adds ops produced by the editor (history do/undo/redo, untracked palette.add). */
  push(ops: readonly MapOp[]): void {
    if (this.disposed || ops.length === 0) return;
    this.rejected = null;
    for (const op of ops) {
      let rest: MapOp | null = op;
      while (rest !== null) {
        const open = this.openBatch();
        const left: MapOp | null = open.add(rest);
        if (left !== null) this.closeOpen();
        rest = left;
      }
    }
    const now = this.clock.now();
    this.openSince ??= now;
    this.lastPushAt = now;
    this.persistSince ??= now;
    this.schedulePersist(now);
    if (this.inFlight === null) this.scheduleAt(this.openDue());
    this.emit();
  }

  /** Sends now (pending timers are cancelled). Resolves when the queue is idle or blocked. */
  async flush(): Promise<void> {
    this.clearTimer('sendTimer');
    this.clearTimer('retryTimer');
    await this.pump(true, false);
  }

  /** Network back: retry at once. */
  online(): void {
    this.attempts = 0;
    this.offline = false;
    this.emit();
    void this.flush();
  }

  /** Browser reports the network lost. */
  goneOffline(): void {
    this.offline = true;
    this.emit();
  }

  /**
   * Page hidden or unloading: writes the open batch and sends at once, with `keepalive` when the
   * body fits (≤ 64 KB) so that the request survives the unload. A larger batch (or one behind a
   * request in flight) stays in the local store and leaves with the next load.
   */
  flushOnHide(): void {
    if (this.disposed) return;
    this.persistOpen();
    if (this.paused !== null || this.batches.length === 0) return;
    this.clearTimer('sendTimer');
    this.clearTimer('retryTimer');
    void this.pump(true, true);
  }

  /** The page reloaded the map after a revision conflict. */
  resume(revision: number): void {
    this.revision = revision;
    this.inSync = true;
    this.paused = null;
    this.attempts = 0;
    this.emit();
    void this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.persistOpen();
    this.disposed = true;
    for (const t of ['sendTimer', 'persistTimer', 'retryTimer', 'conflictTimer'] as const) {
      this.clearTimer(t);
    }
    this.listeners.clear();
  }

  // ---- Internals -------------------------------------------------------------------------

  private get pendingChanges(): number {
    let n = 0;
    for (const b of this.batches) n += b.open !== null ? b.open.changes : countChanges(b.ops);
    return n;
  }

  private openBatch(): OpenBatch {
    const last = this.batches.at(-1);
    if (last?.open != null) return last.open;
    const open = new OpenBatch();
    this.batches.push({
      seq: this.nextSeq(),
      clientOpId: this.newId(),
      open,
      ops: [],
      baseRevision: null,
      sealed: false,
    });
    return open;
  }

  private nextSeq(): number {
    this.seqCounter = Math.max(this.seqCounter + 1, this.clock.now() * 1000);
    return this.seqCounter;
  }

  /** Closes the open batch (full, or about to be sent). */
  private closeOpen(): void {
    const last = this.batches.at(-1);
    if (last?.open == null) return;
    last.ops = last.open.materialize();
    last.open = null;
    this.openSince = null;
    // A full batch leaves without waiting.
    this.persist(last);
    if (this.inFlight === null) this.scheduleAt(this.clock.now());
  }

  private seal(batch: Batch): void {
    if (batch.open !== null) {
      batch.ops = batch.open.materialize();
      batch.open = null;
      this.openSince = null;
      this.clearTimer('persistTimer');
      this.persistSince = null;
    }
    if (!batch.sealed) {
      batch.sealed = true;
      batch.baseRevision = this.revision;
    }
  }

  private record(batch: Batch): PendingBatch {
    return {
      mapId: this.mapId,
      seq: batch.seq,
      clientOpId: batch.clientOpId,
      ops: batch.open !== null ? batch.open.materialize() : batch.ops,
      baseRevision: batch.baseRevision,
      sealed: batch.sealed,
    };
  }

  private persist(batch: Batch): Promise<void> {
    return this.store.put(this.record(batch)).catch((error: unknown) => console.error(error));
  }

  private persistOpen(): void {
    this.clearTimer('persistTimer');
    this.persistSince = null;
    const last = this.batches.at(-1);
    if (last?.open != null && !last.open.isEmpty) void this.persist(last);
  }

  private schedulePersist(now: number): void {
    const since = this.persistSince ?? now;
    const due = Math.min(now + PERSIST_IDLE_MS, since + PERSIST_MAX_WAIT_MS);
    this.clearTimer('persistTimer');
    this.persistTimer = this.clock.setTimeout(
      () => {
        this.persistTimer = null;
        this.persistOpen();
      },
      Math.max(0, due - now),
    );
  }

  private scheduleAt(due: number): void {
    if (this.paused !== null || this.retryTimer !== null) return;
    this.clearTimer('sendTimer');
    this.sendTimer = this.clock.setTimeout(
      () => {
        this.sendTimer = null;
        void this.pump(false, false);
      },
      Math.max(0, due - this.clock.now()),
    );
  }

  private body(batch: Batch): MapOpsRequest {
    return {
      base_revision: batch.baseRevision ?? this.revision,
      client_op_id: batch.clientOpId,
      ops: batch.ops.map(toWireOp),
    };
  }

  /** Moment the open batch is due (1.5 s after the last op, 5 s after the first). */
  private openDue(): number {
    const now = this.clock.now();
    return Math.min(
      (this.lastPushAt ?? now) + SEND_IDLE_MS,
      (this.openSince ?? now) + SEND_MAX_WAIT_MS,
    );
  }

  /**
   * Sends the batches in order until the queue is empty, blocked or waiting. Without `force`,
   * the open batch only leaves when it is due.
   */
  private async pump(force: boolean, keepalive: boolean): Promise<void> {
    while (!this.disposed) {
      if (this.inFlight !== null) {
        await this.inFlight;
        continue;
      }
      if (this.paused !== null) return;
      const batch = this.batches[0];
      if (batch === undefined) {
        this.emit();
        return;
      }
      if (batch.open !== null && !force && this.clock.now() < this.openDue()) {
        this.scheduleAt(this.openDue());
        return;
      }
      this.seal(batch);
      const ka = keepalive && JSON.stringify(this.body(batch)).length <= KEEPALIVE_MAX_BYTES;
      const ok = await this.sendBatch(batch, ka);
      if (!ok) return;
    }
  }

  /** One request. Returns true when the next batch may be sent at once. */
  private sendBatch(batch: Batch, keepalive: boolean): Promise<boolean> {
    let resolveDone!: () => void;
    this.inFlight = new Promise<void>((r) => (resolveDone = r));
    this.emit();
    const run = async (): Promise<boolean> => {
      // Written to the local store before the request leaves (projet.md 15.1). During an unload
      // there is no time to wait for the write: the request starts at once.
      if (!keepalive) await this.persist(batch);
      else void this.persist(batch);
      try {
        const result = await this.transport.send(this.body(batch), { keepalive });
        await this.confirmed(batch, result);
        return true;
      } catch (error) {
        return this.failed(batch, errorOf(error));
      }
    };
    return run().finally(() => {
      this.inFlight = null;
      resolveDone();
      this.emit();
    });
  }

  private async confirmed(batch: Batch, result: MapOpsResult): Promise<void> {
    const expected = (batch.baseRevision ?? this.revision) + 1;
    if (typeof result.revision === 'number') {
      if (result.revision !== expected || batch.baseRevision !== this.revision) {
        this.inSync = false;
      }
      this.revision = Math.max(this.revision, result.revision);
    }
    this.batches = this.batches.filter((b) => b !== batch);
    this.offline = false;
    this.attempts = 0;
    if (Array.isArray(result.conflicts) && result.conflicts.length > 0) {
      this.conflictUntil = this.clock.now() + CONFLICT_NOTICE_MS;
      this.clearTimer('conflictTimer');
      this.conflictTimer = this.clock.setTimeout(() => this.emit(), CONFLICT_NOTICE_MS);
      this.inSync = false;
    }
    await this.store.delete(this.mapId, batch.seq).catch((e: unknown) => console.error(e));
    this.events.onConfirmed?.(this.revision, this.inSync && this.batches.length === 0);
  }

  private async failed(batch: Batch, error: TransportError): Promise<boolean> {
    const { status, code } = error;
    if (status === 0 || status === 408 || status === 429 || status >= 500) {
      if (status === 0 && (code === 'network_error' || !this.isOnline())) this.offline = true;
      this.retryLater();
      return false;
    }
    if (status === 409 && code === 'revision_conflict') {
      this.replace(batch, [{ ...batch, ops: dropResize(batch.ops) }]);
      this.paused = 'revision_conflict';
      this.events.onReloadRequired?.();
      return false;
    }
    if (status === 413 && countChanges(batch.ops) > 1) {
      this.replace(
        batch,
        splitOps(batch.ops).map((ops) => ({ ...batch, ops })),
      );
      return true;
    }
    if (status === 401 || status === 403 || status === 404) {
      this.paused = code === 'unauthenticated' || status === 401 ? 'unauthenticated' : code;
      return false;
    }
    if (status === 422 && error.fields?.['client_op_id'] === 'already_used') {
      // The id belongs to another map or user: same ops, new identity.
      this.replace(batch, [{ ...batch }]);
      return true;
    }
    if (status === 422) {
      const split = splitRefused(batch.ops, error.fields ?? {});
      if (split !== null) {
        // Only the refused ops (or cells) leave; the rest is sent again under a new id.
        this.replace(batch, [{ ...batch, ops: split.kept }]);
        this.rejected = code;
        this.events.onRejected?.({ ...this.record(batch), ops: split.refused }, error);
        return true;
      }
    }
    // 400, 413 on a single op, 422 without op detail...: the batch can never pass.
    this.batches = this.batches.filter((b) => b !== batch);
    this.rejected = code;
    await this.store.delete(this.mapId, batch.seq).catch((e: unknown) => console.error(e));
    this.events.onRejected?.(this.record(batch), error);
    return true;
  }

  /** Replaces a refused batch by new unsent batches (new client_op_id, same place). */
  private replace(batch: Batch, parts: Batch[]): void {
    const index = this.batches.indexOf(batch);
    if (index < 0) return;
    const fresh: Batch[] = parts
      .filter((p) => p.ops.length > 0)
      .map((p, i) => ({
        seq: batch.seq + i / 1000,
        clientOpId: this.newId(),
        open: null,
        ops: p.ops,
        baseRevision: null,
        sealed: false,
      }));
    this.batches.splice(index, 1, ...fresh);
    void this.store.delete(this.mapId, batch.seq).catch((e: unknown) => console.error(e));
    for (const b of fresh) void this.persist(b);
  }

  private retryLater(): void {
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)]!;
    this.attempts++;
    this.clearTimer('retryTimer');
    this.clearTimer('sendTimer');
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      void this.pump(false, false);
    }, delay);
  }

  private clearTimer(name: 'sendTimer' | 'persistTimer' | 'retryTimer' | 'conflictTimer'): void {
    if (this[name] !== null) this.clock.clearTimeout(this[name]);
    this[name] = null;
  }

  private emit(): void {
    if (this.disposed) return;
    const s = this.status;
    const l = this.lastStatus;
    if (
      l !== null &&
      l.state === s.state &&
      l.pending === s.pending &&
      l.error === s.error &&
      l.durable === s.durable
    ) {
      return;
    }
    this.lastStatus = s;
    for (const listener of [...this.listeners]) listener(s);
  }
}

/** map.meta without the grid size (refused by a 409 revision_conflict). */
function dropResize(ops: readonly MapOp[]): MapOp[] {
  return ops.flatMap((op) => {
    if (op.type !== 'map.meta') return [op];
    const meta = op as MapOp & { grid?: Record<string, unknown> };
    if (meta.grid === undefined) return [op];
    const { width: _w, height: _h, ...grid } = meta.grid;
    const rest = { ...meta, grid };
    if (Object.keys(grid).length === 0) delete (rest as { grid?: unknown }).grid;
    return Object.keys(rest).length > 1 ? [rest as MapOp] : [];
  });
}

/** Two halves (by ops, or by cells for a single tiles.set). */
function splitOps(ops: readonly MapOp[]): MapOp[][] {
  if (ops.length > 1) {
    const mid = Math.ceil(ops.length / 2);
    return [ops.slice(0, mid), ops.slice(mid)];
  }
  const op = ops[0]!;
  if (op.type !== 'tiles.set') return [[op]];
  const mid = Math.ceil(op.cells.length / 2);
  return [[{ ...op, cells: op.cells.slice(0, mid) }], [{ ...op, cells: op.cells.slice(mid) }]];
}

/**
 * Splits ops by the 422 fields `ops.<i>…` of the server: a `ops.<i>.cells.<j>` error removes
 * that cell only, any other `ops.<i>…` error the whole op. Null when no field designates an op.
 */
export function splitRefused(
  ops: readonly MapOp[],
  fields: Readonly<Record<string, string>>,
): { kept: MapOp[]; refused: MapOp[] } | null {
  const wholeOps = new Set<number>();
  const badCells = new Map<number, Set<number>>();
  for (const key of Object.keys(fields)) {
    const m = /^ops\.(\d+)(?:\.(.+))?$/.exec(key);
    if (m === null) continue;
    const i = Number(m[1]);
    if (i >= ops.length) continue;
    const cell = m[2] === undefined ? null : /^cells\.(\d+)$/.exec(m[2]);
    if (cell !== null && cell !== undefined) {
      let set = badCells.get(i);
      if (set === undefined) badCells.set(i, (set = new Set()));
      set.add(Number(cell[1]));
    } else {
      wholeOps.add(i);
    }
  }
  if (wholeOps.size === 0 && badCells.size === 0) return null;
  const kept: MapOp[] = [];
  const refused: MapOp[] = [];
  ops.forEach((op, i) => {
    const cells = badCells.get(i);
    if (wholeOps.has(i)) refused.push(op);
    else if (cells !== undefined && op.type === 'tiles.set') {
      const ok = op.cells.filter((_, j) => !cells.has(j));
      const bad = op.cells.filter((_, j) => cells.has(j));
      if (ok.length > 0) kept.push({ ...op, cells: ok });
      refused.push({ ...op, cells: bad });
    } else if (cells !== undefined) refused.push(op);
    else kept.push(op);
  });
  return { kept, refused };
}
