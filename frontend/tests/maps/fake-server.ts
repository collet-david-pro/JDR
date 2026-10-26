import type { MapOp, TileCell } from '../../src/editor/contracts';
import type { OpsTransport } from '../../src/editor/sync/OpsQueue';
import type { MapOpConflict, MapOpsRequest, MapOpsResult } from '../../src/lib/types';

export class TransportFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(code);
  }
}

type Mode =
  | 'ok'
  | 'offline'
  | 'lose-response'
  | { status: number; code: string; fields?: Record<string, string> };

/**
 * In-memory POST /maps/{id}/ops: applies tiles.set cells (last writer wins), counts revisions,
 * memorises client_op_id answers (processed_ops) and can simulate failures.
 */
export class FakeOpsServer implements OpsTransport {
  revision = 0;
  readonly cells = new Map<string, number>();
  readonly requests: { body: MapOpsRequest; keepalive: boolean }[] = [];
  readonly processed = new Map<string, MapOpsResult>();
  /** Number of batches really applied (duplicates are not). */
  applied = 0;
  modes: Mode[] = [];
  defaultMode: Mode = 'ok';
  conflicts: MapOpConflict[] = [];

  send(body: MapOpsRequest, options: { keepalive: boolean }): Promise<MapOpsResult> {
    // Deep copy: the request must be what was sent, not a live object.
    this.requests.push({ body: structuredClone(body), keepalive: options.keepalive });
    const mode = this.modes.shift() ?? this.defaultMode;
    if (mode === 'offline') return Promise.reject(new TransportFailure('network_error', 0));
    if (typeof mode === 'object')
      return Promise.reject(new TransportFailure(mode.code, mode.status, mode.fields));
    const known = this.processed.get(body.client_op_id);
    let result: MapOpsResult;
    if (known !== undefined) {
      result = known;
    } else {
      for (const op of body.ops) {
        if (op.type !== 'tiles.set') continue;
        for (const c of op.cells) this.cells.set(`${op.layer}:${c[0]}:${c[1]}`, c[2]!);
      }
      this.revision++;
      this.applied++;
      result = { revision: this.revision, applied: body.ops.length, conflicts: this.conflicts };
      this.processed.set(body.client_op_id, result);
    }
    if (mode === 'lose-response') return Promise.reject(new TransportFailure('network_error', 0));
    return Promise.resolve(result);
  }

  cell(layer: string, x: number, y: number): number | undefined {
    return this.cells.get(`${layer}:${x}:${y}`);
  }
}

export function paint(cells: [number, number, number][], layer = 'ground' as const): MapOp {
  return {
    type: 'tiles.set',
    floor: 'f1',
    layer,
    cells: cells.map(([x, y, i]): TileCell => [x, y, i, 0, 0]),
  };
}
