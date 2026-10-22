/**
 * Batches of map ops sent by POST /maps/{id}/ops (projet.md 11.4, 15.1).
 *
 * An open batch accumulates the ops of the editor until it is sent. Successive tiles.set ops of
 * the same floor/layer are merged (last value per cell wins), and the server limits are kept:
 * ≤ 200 ops per batch, ≤ 5 000 cells per tiles.set op, body ≤ 1 MB (estimated with a margin).
 * Once sent, a batch never changes (same client_op_id ⇒ identical replay).
 */
import type { MapOp, TileCell, TileLayerId } from '../contracts';
import { toWireOp } from './wire';

export const MAX_OPS_PER_BATCH = 200;
export const MAX_CELLS_PER_OP = 5000;
/** Server body limit. */
export const MAX_BODY_BYTES = 1_000_000;
/** Budget used for the estimate (envelope, ids and digits margin). */
export const BATCH_BYTES_BUDGET = 900_000;
/** Upper bound of one cell in JSON: `[399,399,65535,255,255],`. */
export const CELL_JSON_BYTES = 26;
const TILES_OP_OVERHEAD = 96;

type TilesSegment = {
  readonly kind: 'tiles';
  readonly floor: string;
  readonly layer: TileLayerId;
  readonly cells: Map<number, TileCell>;
};
type OpSegment = { readonly kind: 'op'; readonly op: MapOp; readonly bytes: number };
type Segment = TilesSegment | OpSegment;

const cellKey = (c: TileCell): number => c[1] * 65536 + c[0];

/** Ops being accumulated before a send. */
export class OpenBatch {
  private readonly segments: Segment[] = [];
  private opCount = 0;
  private byteCount = 0;

  get isEmpty(): boolean {
    return this.segments.length === 0;
  }

  /** Estimated number of ops once materialised. */
  get ops(): number {
    return this.opCount;
  }

  /** Estimated JSON size of the ops. */
  get bytes(): number {
    return this.byteCount;
  }

  /** Distinct cells + other ops (the "modifications" of the save indicator). */
  get changes(): number {
    let n = 0;
    for (const s of this.segments) n += s.kind === 'tiles' ? s.cells.size : 1;
    return n;
  }

  /**
   * Adds an op. Returns what did not fit (the caller starts a new batch with it), or null.
   * A tiles.set op may be split between batches.
   */
  add(op: MapOp): MapOp | null {
    if (op.type === 'tiles.set') return this.addTiles(op.floor, op.layer, op.cells);
    const bytes = JSON.stringify(toWireOp(op)).length + 1;
    if (
      !this.isEmpty &&
      (this.opCount + 1 > MAX_OPS_PER_BATCH || this.byteCount + bytes > BATCH_BYTES_BUDGET)
    ) {
      return op;
    }
    this.segments.push({ kind: 'op', op, bytes });
    this.opCount++;
    this.byteCount += bytes;
    return null;
  }

  /** The ops to send: merged, ≤ 5 000 cells each. */
  materialize(): MapOp[] {
    const out: MapOp[] = [];
    for (const s of this.segments) {
      if (s.kind === 'op') {
        out.push(s.op);
        continue;
      }
      const cells = [...s.cells.values()];
      for (let i = 0; i < cells.length; i += MAX_CELLS_PER_OP) {
        out.push({
          type: 'tiles.set',
          floor: s.floor,
          layer: s.layer,
          cells: cells.slice(i, i + MAX_CELLS_PER_OP),
        });
      }
    }
    return out;
  }

  private addTiles(floor: string, layer: TileLayerId, cells: readonly TileCell[]): MapOp | null {
    if (cells.length === 0) return null;
    let last = this.segments.at(-1);
    if (
      last === undefined ||
      last.kind !== 'tiles' ||
      last.floor !== floor ||
      last.layer !== layer
    ) {
      // A new segment costs at least one op.
      if (
        !this.isEmpty &&
        (this.opCount + 1 > MAX_OPS_PER_BATCH ||
          this.byteCount + TILES_OP_OVERHEAD + CELL_JSON_BYTES > BATCH_BYTES_BUDGET)
      ) {
        return { type: 'tiles.set', floor, layer, cells };
      }
      last = { kind: 'tiles', floor, layer, cells: new Map() };
      this.segments.push(last);
      this.opCount++;
      this.byteCount += TILES_OP_OVERHEAD;
    }
    const seg = last;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const k = cellKey(c);
      if (seg.cells.has(k)) {
        seg.cells.set(k, c); // last value wins, no growth
        continue;
      }
      const grows = seg.cells.size % MAX_CELLS_PER_OP === 0 && seg.cells.size > 0;
      if (
        (grows && this.opCount + 1 > MAX_OPS_PER_BATCH) ||
        this.byteCount + CELL_JSON_BYTES + (grows ? TILES_OP_OVERHEAD : 0) > BATCH_BYTES_BUDGET
      ) {
        return { type: 'tiles.set', floor, layer, cells: cells.slice(i) };
      }
      seg.cells.set(k, c);
      this.byteCount += CELL_JSON_BYTES;
      if (grows) {
        this.opCount++;
        this.byteCount += TILES_OP_OVERHEAD;
      }
    }
    return null;
  }
}

/** Number of "modifications" of materialised ops (indicator). */
export function countChanges(ops: readonly MapOp[]): number {
  let n = 0;
  for (const op of ops) n += op.type === 'tiles.set' ? op.cells.length : 1;
  return n;
}
