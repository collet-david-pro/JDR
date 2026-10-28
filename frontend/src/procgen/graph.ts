/** Union-find, Kruskal and A* (deterministic: total orders, insertion-order tie-breaks). */

export class UnionFind {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;
  /** Number of disjoint sets. */
  count: number;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.rank = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
    this.count = n;
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r]!;
    while (this.parent[x] !== r) {
      const n = this.parent[x]!;
      this.parent[x] = r;
      x = n;
    }
    return r;
  }
  /** Joins two sets; false when they were already joined. */
  union(a: number, b: number): boolean {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra]! < this.rank[rb]!) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]!++;
    this.count--;
    return true;
  }
  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
}

export interface Edge {
  a: number;
  b: number;
  w: number;
}

/** Minimum spanning forest; edges sorted by (w, a, b) with a total comparator. */
export function kruskal(n: number, edges: readonly Edge[]): Edge[] {
  const order = edges
    .map((e, i) => ({ e, i }))
    .sort((p, q) => p.e.w - q.e.w || p.e.a - q.e.a || p.e.b - q.e.b || p.i - q.i);
  const uf = new UnionFind(n);
  const out: Edge[] = [];
  for (const { e } of order) if (uf.union(e.a, e.b)) out.push(e);
  return out;
}

export interface AstarOptions {
  diagonal?: boolean;
}

/**
 * A* on a w x h grid. cost(x, y) = cost of entering the cell (>= 1 for the heuristic to stay
 * admissible; Infinity = blocked). Diagonal steps (option) cost sqrt(2) x the cost and require
 * both adjacent orthogonal cells to be passable. Ties are broken by insertion order.
 * Returns the cells from start to goal included, or null.
 */
export function astar(
  w: number,
  h: number,
  cost: (x: number, y: number) => number,
  start: readonly [number, number],
  goal: readonly [number, number],
  opts: AstarOptions = {},
): [number, number][] | null {
  const diagonal = opts.diagonal === true;
  const inb = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  if (!inb(start[0], start[1]) || !inb(goal[0], goal[1])) return null;
  if (!Number.isFinite(cost(goal[0], goal[1]))) return null;
  const SQ2 = 1.4142135623730951;
  const heur = (x: number, y: number): number => {
    const dx = Math.abs(x - goal[0]);
    const dy = Math.abs(y - goal[1]);
    return diagonal ? dx + dy + (SQ2 - 2) * Math.min(dx, dy) : dx + dy;
  };
  const g = new Float64Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  // Binary heap of [f, seq, index].
  const hf: number[] = [];
  const hs: number[] = [];
  const hi: number[] = [];
  let seq = 0;
  const less = (a: number, b: number): boolean =>
    hf[a]! < hf[b]! || (hf[a] === hf[b] && hs[a]! < hs[b]!);
  const swap = (a: number, b: number): void => {
    [hf[a], hf[b]] = [hf[b]!, hf[a]!];
    [hs[a], hs[b]] = [hs[b]!, hs[a]!];
    [hi[a], hi[b]] = [hi[b]!, hi[a]!];
  };
  const push = (f: number, idx: number): void => {
    hf.push(f);
    hs.push(seq++);
    hi.push(idx);
    let c = hf.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!less(c, p)) break;
      swap(c, p);
      c = p;
    }
  };
  const pop = (): number => {
    const top = hi[0]!;
    const last = hf.length - 1;
    swap(0, last);
    hf.pop();
    hs.pop();
    hi.pop();
    let c = 0;
    for (;;) {
      const l = 2 * c + 1;
      const r = l + 1;
      let m = c;
      if (l < hf.length && less(l, m)) m = l;
      if (r < hf.length && less(r, m)) m = r;
      if (m === c) break;
      swap(c, m);
      c = m;
    }
    return top;
  };
  const s = start[1] * w + start[0];
  const t = goal[1] * w + goal[0];
  g[s] = 0;
  push(heur(start[0], start[1]), s);
  while (hf.length > 0) {
    const cur = pop();
    if (closed[cur] === 1) continue;
    closed[cur] = 1;
    if (cur === t) {
      const path: [number, number][] = [];
      for (let c = t; c !== -1; c = from[c]!) path.push([c % w, Math.floor(c / w)]);
      return path.reverse();
    }
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inb(nx, ny)) continue;
        const ni = ny * w + nx;
        if (closed[ni] === 1) continue;
        const c = cost(nx, ny);
        if (!Number.isFinite(c)) continue;
        let step = c;
        if (dx !== 0 && dy !== 0) {
          if (!Number.isFinite(cost(cx + dx, cy)) || !Number.isFinite(cost(cx, cy + dy))) continue;
          step = c * SQ2;
        }
        const ng = g[cur]! + step;
        if (ng < g[ni]!) {
          g[ni] = ng;
          from[ni] = cur;
          push(ng + heur(nx, ny), ni);
        }
      }
    }
  }
  return null;
}
