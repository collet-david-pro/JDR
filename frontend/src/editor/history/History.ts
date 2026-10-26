/**
 * Undo/redo stack (projet.md 15.1).
 *
 * - 200 commands max (oldest dropped).
 * - Successive commands with the same mergeKey within 500 ms (sliding window, injectable clock)
 *   are merged into one undo step.
 * - Inverse ops are always recomputed against the current state: when a command is executed or
 *   redone, its inverse is what the target returns from applyOps; on undo, tile cells that were
 *   changed since by someone else (current value ≠ value we wrote) are left alone (co-editing:
 *   only one's own actions are undone). For objects and placed tokens (P5), an undo leaves an
 *   object alone when it was changed meanwhile by something else than this history (conflict
 *   resolved with the server state, reload), counted in `lastUndoSkipped`.
 * - P5 rev rule: when the target implements `apply`, the ops emitted to the save queue are the
 *   ops as applied (object / token updates carry the rev current at execution, undo or redo).
 */
import type { CellValue, Command, MapOp, TileLayerId } from '../contracts';
import { compactOps } from '../model/ops';

export interface HistoryTarget {
  /** Applies ops atomically and returns their inverse (see MapDocument.applyOps). */
  applyOps(ops: readonly MapOp[]): MapOp[];
  getCell(layer: TileLayerId, x: number, y: number): CellValue;
  /** Optional change counter: lets undo skip the co-editing check when nobody else wrote. */
  readonly revision?: number;
  /** P5: applies ops and returns them as applied (revs stamped) with their inverse. */
  apply?(ops: readonly MapOp[]): { ops: MapOp[]; inverse: MapOp[] };
  /** P5: counter of foreign changes of `object:<uid>` / `token:<uid>`. */
  foreignStamp?(key: string): number;
}

/** `object:<uid>` / `token:<uid>` of an object or placed-token op, else null. */
export function sceneOpKey(op: MapOp): string | null {
  switch (op.type) {
    case 'object.add':
      return `object:${op.object.uid}`;
    case 'object.update':
    case 'object.remove':
      return `object:${op.uid}`;
    case 'maptoken.add':
      return `token:${op.token.uid}`;
    case 'maptoken.update':
    case 'maptoken.remove':
      return `token:${op.uid}`;
    default:
      return null;
  }
}

export interface HistoryOptions {
  readonly limit?: number;
  readonly mergeWindowMs?: number;
  readonly now?: () => number;
}

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** i18n key of the command undone by the next undo. */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly undoSize: number;
  readonly redoSize: number;
}

/** Why ops were applied: sent to the sync queue (P4b) in every case. */
export type OpsOrigin = 'do' | 'undo' | 'redo' | 'untracked';

export const HISTORY_LIMIT = 200;
export const MERGE_WINDOW_MS = 500;
/** Merged entries are compacted once they carry this many ops. */
const COMPACT_THRESHOLD = 256;

interface Entry {
  readonly label: string;
  readonly mergeKey: string | undefined;
  ops: MapOp[];
  /** Inverse batches in application order; undo applies them newest first. */
  inverseParts: MapOp[][];
  time: number;
  /** Foreign stamps of the objects / tokens touched, right after this entry's last write. */
  stamps: Map<string, number>;
}

export class History {
  private readonly target: HistoryTarget;
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;
  private readonly undoStack: Entry[] = [];
  private readonly redoStack: Entry[] = [];
  private mergeBarrier = true;
  /** target.revision right after the history's last write. */
  private ownRevision: number | undefined = undefined;
  private readonly changeListeners = new Set<(state: HistoryState) => void>();
  private readonly opsListeners = new Set<(ops: readonly MapOp[], origin: OpsOrigin) => void>();
  /** Tile cells left untouched by the last undo because someone else changed them. */
  lastUndoSkipped = 0;

  constructor(target: HistoryTarget, options: HistoryOptions = {}) {
    this.target = target;
    this.limit = Math.max(1, options.limit ?? HISTORY_LIMIT);
    this.mergeWindowMs = options.mergeWindowMs ?? MERGE_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
  }

  get state(): HistoryState {
    const u = this.undoStack.at(-1);
    const r = this.redoStack.at(-1);
    return {
      canUndo: u !== undefined,
      canRedo: r !== undefined,
      undoLabel: u?.label ?? null,
      redoLabel: r?.label ?? null,
      undoSize: this.undoStack.length,
      redoSize: this.redoStack.length,
    };
  }

  /**
   * Applies a command and records it. `command.inverseOps` is not trusted: the inverse is
   * recomputed by the target. Returns false when nothing changed (nothing recorded).
   */
  execute(command: Command): boolean {
    if (command.ops.length === 0) return false;
    const { ops: applied, inverse } = this.applyTarget(command.ops);
    this.ownRevision = this.target.revision;
    this.emitOps(applied, 'do');
    if (inverse.length === 0) return false;
    const t = this.now();
    const top = this.undoStack.at(-1);
    this.redoStack.length = 0;
    if (
      top !== undefined &&
      !this.mergeBarrier &&
      command.mergeKey !== undefined &&
      top.mergeKey === command.mergeKey &&
      t - top.time <= this.mergeWindowMs
    ) {
      top.ops.push(...command.ops);
      top.inverseParts.push(inverse);
      top.time = t;
      this.recordStamps(top, command.ops);
      if (top.ops.length + top.inverseParts.length > COMPACT_THRESHOLD) this.compact(top);
    } else {
      if (top !== undefined) this.compact(top);
      const entry: Entry = {
        label: command.label,
        mergeKey: command.mergeKey,
        ops: [...command.ops],
        inverseParts: [inverse],
        time: t,
        stamps: new Map(),
      };
      this.recordStamps(entry, command.ops);
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.mergeBarrier = false;
    this.emitChange();
    return true;
  }

  /** Applies ops that are sent to the server but not undoable (e.g. palette.add). */
  applyUntracked(ops: readonly MapOp[]): void {
    if (ops.length === 0) return;
    const { ops: applied } = this.applyTarget(ops);
    this.ownRevision = this.target.revision;
    this.emitOps(applied, 'untracked');
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (entry === undefined) return false;
    this.compact(entry);
    const { ops, skipped } = this.ownInverse(entry);
    let applied: MapOp[];
    try {
      applied = this.applyTarget(ops).ops;
      this.ownRevision = this.target.revision;
    } catch (e) {
      this.undoStack.push(entry);
      throw e;
    }
    this.lastUndoSkipped = skipped;
    this.redoStack.push(entry);
    this.mergeBarrier = true;
    if (applied.length > 0) this.emitOps(applied, 'undo');
    this.emitChange();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (entry === undefined) return false;
    let inverse: MapOp[];
    let applied: MapOp[];
    try {
      ({ ops: applied, inverse } = this.applyTarget(entry.ops));
      this.ownRevision = this.target.revision;
    } catch (e) {
      this.redoStack.push(entry);
      throw e;
    }
    entry.inverseParts = [compactOps(inverse)];
    entry.time = this.now();
    entry.stamps = new Map();
    this.recordStamps(entry, entry.ops);
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.mergeBarrier = true;
    this.emitOps(applied, 'redo');
    this.emitChange();
    return true;
  }

  /** The next command never merges with the previous one (e.g. end of a stroke). */
  breakMerge(): void {
    this.mergeBarrier = true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.mergeBarrier = true;
    this.emitChange();
  }

  onChange(listener: (state: HistoryState) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Every batch of ops applied through the history (for the save queue). */
  onOps(listener: (ops: readonly MapOp[], origin: OpsOrigin) => void): () => void {
    this.opsListeners.add(listener);
    return () => this.opsListeners.delete(listener);
  }

  // ---- Internals -------------------------------------------------------------------------

  private applyTarget(ops: readonly MapOp[]): { ops: MapOp[]; inverse: MapOp[] } {
    if (this.target.apply !== undefined) return this.target.apply(ops);
    return { ops: [...ops], inverse: this.target.applyOps(ops) };
  }

  private recordStamps(entry: Entry, ops: readonly MapOp[]): void {
    const stamp = this.target.foreignStamp;
    if (stamp === undefined) return;
    for (const op of ops) {
      const key = sceneOpKey(op);
      if (key !== null) entry.stamps.set(key, stamp.call(this.target, key));
    }
  }

  /** Objects / tokens changed by someone else since this entry was written. */
  private foreignKeys(entry: Entry): Set<string> {
    const out = new Set<string>();
    const stamp = this.target.foreignStamp;
    if (stamp === undefined) return out;
    for (const [key, value] of entry.stamps) {
      if (stamp.call(this.target, key) !== value) out.add(key);
    }
    return out;
  }

  private compact(entry: Entry): void {
    if (entry.inverseParts.length > 1 || entry.ops.length > 1) {
      entry.ops = compactOps(entry.ops);
      const flat: MapOp[] = [];
      for (let i = entry.inverseParts.length - 1; i >= 0; i--) flat.push(...entry.inverseParts[i]!);
      entry.inverseParts = [compactOps(flat)];
    }
  }

  /** Inverse ops restricted to the tile cells that still hold the value this entry wrote. */
  private ownInverse(entry: Entry): { ops: MapOp[]; skipped: number } {
    let inverse = entry.inverseParts[0] ?? [];
    // Nobody else wrote since our last write: every cell still holds our value.
    if (this.ownRevision !== undefined && this.target.revision === this.ownRevision) {
      return { ops: inverse, skipped: 0 };
    }
    let skipped = 0;
    const foreign = this.foreignKeys(entry);
    if (foreign.size > 0) {
      inverse = inverse.filter((op) => {
        const key = sceneOpKey(op);
        const keep = key === null || !foreign.has(key);
        if (!keep) skipped++;
        return keep;
      });
    }
    const written = new Map<string, Map<number, number>>();
    for (const op of entry.ops) {
      if (op.type !== 'tiles.set') continue;
      const k = `${op.floor}\u0000${op.layer}`;
      let m = written.get(k);
      if (m === undefined) written.set(k, (m = new Map()));
      for (const c of op.cells) m.set(c[1] * 65536 + c[0], c[2] === 0 ? 0 : pack(c[2], c[3], c[4]));
    }
    const ops: MapOp[] = [];
    for (const op of inverse) {
      if (op.type !== 'tiles.set') {
        ops.push(op);
        continue;
      }
      const m = written.get(`${op.floor}\u0000${op.layer}`);
      const cells = op.cells.filter((c) => {
        const w = m?.get(c[1] * 65536 + c[0]);
        if (w === undefined) return true;
        const cur = this.target.getCell(op.layer, c[0], c[1]);
        // An erased cell reads back with variant/flags 0 whatever was sent (packed as 0).
        const same = (cur.index === 0 ? 0 : pack(cur.index, cur.variant, cur.flags)) === w;
        if (!same) skipped++;
        return same;
      });
      if (cells.length > 0) ops.push(cells.length === op.cells.length ? op : { ...op, cells });
    }
    return { ops, skipped };
  }

  private emitOps(ops: readonly MapOp[], origin: OpsOrigin): void {
    for (const l of [...this.opsListeners]) l(ops, origin);
  }

  private emitChange(): void {
    const s = this.state;
    for (const l of [...this.changeListeners]) l(s);
  }
}

/** Cell value as one number (index u16, variant u8, flags u8). */
function pack(index: number, variant: number, flags: number): number {
  return index + variant * 0x10000 + flags * 0x1000000;
}
