/** Grids, neighbourhoods, connected components and BFS (pure, deterministic). */

export type Conn = 4 | 8;
export const N4: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export const N8: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
export const neighbours = (conn: Conn): readonly (readonly [number, number])[] =>
  conn === 8 ? N8 : N4;

/** Generic grid; out of bounds reads return `undefined`. */
export class Grid<T> {
  readonly w: number;
  readonly h: number;
  readonly data: T[];
  constructor(w: number, h: number, init: T) {
    this.w = w;
    this.h = h;
    this.data = new Array<T>(w * h).fill(init);
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): T | undefined {
    return this.inBounds(x, y) ? this.data[y * this.w + x] : undefined;
  }
  set(x: number, y: number, v: T): void {
    if (this.inBounds(x, y)) this.data[y * this.w + x] = v;
  }
  fill(v: T): void {
    this.data.fill(v);
  }
  clone(): Grid<T> {
    const g = new Grid<T>(this.w, this.h, this.data[0] as T);
    for (let i = 0; i < this.data.length; i++) g.data[i] = this.data[i]!;
    return g;
  }
}

/** Grid of bytes; out of bounds reads return 0. */
export class BitGrid {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.data[y * this.w + x]! : 0;
  }
  set(x: number, y: number, v: number): void {
    if (this.inBounds(x, y)) this.data[y * this.w + x] = v;
  }
  fill(v: number): void {
    this.data.fill(v);
  }
  clone(): BitGrid {
    const g = new BitGrid(this.w, this.h);
    g.data.set(this.data);
    return g;
  }
  /** Number of non-zero cells. */
  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== 0) n++;
    return n;
  }
}

export interface Dims {
  readonly w: number;
  readonly h: number;
}

/** Cells reachable from (x, y) through cells matching `pred`, in BFS order. */
export function floodFill(
  grid: Dims,
  x: number,
  y: number,
  pred: (x: number, y: number) => boolean,
  conn: Conn = 4,
): [number, number][] {
  const { w, h } = grid;
  if (x < 0 || y < 0 || x >= w || y >= h || !pred(x, y)) return [];
  const seen = new Uint8Array(w * h);
  const out: [number, number][] = [[x, y]];
  seen[y * w + x] = 1;
  const nb = neighbours(conn);
  for (let q = 0; q < out.length; q++) {
    const [cx, cy] = out[q]!;
    for (const [dx, dy] of nb) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] === 1) continue;
      if (!pred(nx, ny)) continue;
      seen[ny * w + nx] = 1;
      out.push([nx, ny]);
    }
  }
  return out;
}

/**
 * Connected components of the cells where pred(value, x, y) holds. labels: -1 = not matching,
 * otherwise 0..n-1 in scan order (y then x); sizes[label] = cell count.
 */
export function components(
  grid: BitGrid,
  pred: (v: number, x: number, y: number) => boolean,
  conn: Conn = 4,
): { labels: Int32Array; sizes: number[] } {
  const { w, h } = grid;
  const labels = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const nb = neighbours(conn);
  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] !== -1 || !pred(grid.data[i]!, x, y)) continue;
      const id = sizes.length;
      let size = 0;
      labels[i] = id;
      stack.push(i);
      while (stack.length > 0) {
        const c = stack.pop()!;
        size++;
        const cx = c % w;
        const cy = (c - cx) / w;
        for (const [dx, dy] of nb) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (labels[ni] !== -1 || !pred(grid.data[ni]!, nx, ny)) continue;
          labels[ni] = id;
          stack.push(ni);
        }
      }
      sizes.push(size);
    }
  }
  return { labels, sizes };
}

/** BFS distances in steps from the sources; -1 = unreachable or impassable. */
export function bfsDistances(
  grid: Dims,
  passable: (x: number, y: number) => boolean,
  sources: readonly (readonly [number, number])[],
  conn: Conn = 4,
): Int32Array {
  const { w, h } = grid;
  const dist = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (const [sx, sy] of sources) {
    if (sx < 0 || sy < 0 || sx >= w || sy >= h || !passable(sx, sy)) continue;
    const i = sy * w + sx;
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    queue.push(i);
  }
  const nb = neighbours(conn);
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]!;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [dx, dy] of nb) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1 || !passable(nx, ny)) continue;
      dist[ni] = dist[c]! + 1;
      queue.push(ni);
    }
  }
  return dist;
}

function farthest(dist: Int32Array, w: number): { x: number; y: number; d: number } {
  let best = -1;
  let bi = 0;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i]! > best) {
      best = dist[i]!;
      bi = i;
    }
  }
  const x = bi % w;
  return { x, y: (bi - x) / w, d: best };
}

/**
 * Two cells of the component of `start` far apart (double BFS sweep: exact on trees, a good
 * approximation otherwise). Ties go to the first cell in scan order (y then x).
 */
export function farthestPair(
  grid: Dims,
  passable: (x: number, y: number) => boolean,
  start: readonly [number, number],
  conn: Conn = 4,
): { a: [number, number]; b: [number, number]; dist: number } | null {
  const d0 = bfsDistances(grid, passable, [start], conn);
  if (d0[start[1] * grid.w + start[0]] !== 0) return null;
  const a = farthest(d0, grid.w);
  const d1 = bfsDistances(grid, passable, [[a.x, a.y]], conn);
  const b = farthest(d1, grid.w);
  return { a: [a.x, a.y], b: [b.x, b.y], dist: b.d };
}
