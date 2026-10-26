/**
 * Uniform spatial grid of segments (projet.md 14.2: cells of 8 map cells). A segment is listed
 * in every grid cell its bounding box overlaps; queries return each segment once (stamp array,
 * no allocation per query besides the output array).
 */

export const GRID_CELL = 8;

export class SpatialGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly x0: number;
  private readonly y0: number;
  /** CSR layout: cell c lists items[start[c] .. start[c + 1]). */
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly stamp: Uint32Array;
  private query = 0;

  /**
   * @param coords 4 numbers per segment (ax, ay, bx, by).
   * @param bounds area covered (segments outside are clamped to the border cells).
   */
  constructor(
    coords: Float64Array,
    readonly count: number,
    bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
    readonly cell = GRID_CELL,
  ) {
    this.x0 = bounds.x0;
    this.y0 = bounds.y0;
    this.cols = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cell) + 1);
    this.rows = Math.max(1, Math.ceil((bounds.y1 - bounds.y0) / cell) + 1);
    const cells = this.cols * this.rows;
    const counts = new Int32Array(cells + 1);
    const ranges = new Int32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const ax = coords[i * 4]!;
      const ay = coords[i * 4 + 1]!;
      const bx = coords[i * 4 + 2]!;
      const by = coords[i * 4 + 3]!;
      const c0 = this.col(Math.min(ax, bx));
      const c1 = this.col(Math.max(ax, bx));
      const r0 = this.row(Math.min(ay, by));
      const r1 = this.row(Math.max(ay, by));
      ranges.set([c0, c1, r0, r1], i * 4);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) counts[r * this.cols + c]!++;
    }
    this.start = new Int32Array(cells + 1);
    for (let c = 0; c < cells; c++) this.start[c + 1] = this.start[c]! + counts[c]!;
    this.items = new Int32Array(this.start[cells]!);
    const fill = this.start.slice(0, cells);
    for (let i = 0; i < count; i++) {
      const c0 = ranges[i * 4]!;
      const c1 = ranges[i * 4 + 1]!;
      const r0 = ranges[i * 4 + 2]!;
      const r1 = ranges[i * 4 + 3]!;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) this.items[fill[r * this.cols + c]!++] = i;
      }
    }
    this.stamp = new Uint32Array(count);
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
  }

  /** Segments whose grid cells overlap the box; appended to `out` (cleared first). */
  queryBox(x0: number, y0: number, x1: number, y1: number, out: number[]): number[] {
    out.length = 0;
    if (this.count === 0) return out;
    this.query = (this.query + 1) >>> 0;
    if (this.query === 0) {
      this.stamp.fill(0);
      this.query = 1;
    }
    const q = this.query;
    const c0 = this.col(Math.min(x0, x1));
    const c1 = this.col(Math.max(x0, x1));
    const r0 = this.row(Math.min(y0, y1));
    const r1 = this.row(Math.max(y0, y1));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        for (let k = this.start[cell]!; k < this.start[cell + 1]!; k++) {
          const i = this.items[k]!;
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          out.push(i);
        }
      }
    }
    return out;
  }

  /** Each unordered pair of segments sharing at least one grid cell, once. */
  forEachPair(fn: (i: number, j: number) => void): void {
    const seen = new Set<number>();
    const n = this.count;
    for (let cell = 0; cell + 1 < this.start.length; cell++) {
      const s = this.start[cell]!;
      const e = this.start[cell + 1]!;
      for (let a = s; a < e; a++) {
        for (let b = a + 1; b < e; b++) {
          const i = Math.min(this.items[a]!, this.items[b]!);
          const j = Math.max(this.items[a]!, this.items[b]!);
          const key = i * n + j;
          if (seen.has(key)) continue;
          seen.add(key);
          fn(i, j);
        }
      }
    }
  }
}
