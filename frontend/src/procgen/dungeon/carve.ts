/** Corridor carving: L-shaped first (random elbow), A* when the L would hug or cross a room. */
import { astar } from '../graph';
import { BitGrid, components } from '../grid';
import type { Rng } from '../prng';
import type { Rect } from './layout';

/** Margin (cells) around the two anchors of the A* search window. */
const WINDOW = 10;

export class Carver {
  readonly floor: BitGrid;
  /** Room whose rectangle contains the cell, or -1. */
  readonly roomAt: Int32Array;
  /** Room whose 1-cell ring (8-neighbourhood) contains the cell, or -1. */
  readonly ringOf: Int32Array;
  private readonly lo: number;
  private readonly hi: number;
  private readonly stamp: Uint32Array;
  private tick = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly rooms: readonly Rect[],
    corridor: number,
  ) {
    this.floor = new BitGrid(w, h);
    this.roomAt = new Int32Array(w * h).fill(-1);
    this.ringOf = new Int32Array(w * h).fill(-1);
    this.stamp = new Uint32Array(w * h);
    this.lo = Math.floor((corridor - 1) / 2);
    this.hi = corridor - 1 - this.lo;
    rooms.forEach((r, id) => {
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
          if (inside) {
            this.roomAt[y * w + x] = id;
            this.floor.set(x, y, 1);
          } else if (this.ringOf[y * w + x] === -1) this.ringOf[y * w + x] = id;
        }
      }
    });
  }

  private brush(x: number, y: number, fn: (i: number) => void): void {
    for (let dy = -this.lo; dy <= this.hi; dy++) {
      for (let dx = -this.lo; dx <= this.hi; dx++) fn((y + dy) * this.w + x + dx);
    }
  }

  private carvePath(path: readonly (readonly [number, number])[]): void {
    for (const [x, y] of path) this.brush(x, y, (i) => (this.floor.data[i] = 1));
  }

  /** L path from a to b (horizontal leg first or vertical leg first). */
  private lPath(a: readonly [number, number], b: readonly [number, number], hFirst: boolean) {
    const path: [number, number][] = [];
    const [ax, ay] = a;
    const [bx, by] = b;
    const sx = Math.sign(bx - ax);
    const sy = Math.sign(by - ay);
    if (hFirst) {
      for (let x = ax; x !== bx; x += sx) path.push([x, ay]);
      for (let y = ay; y !== by; y += sy) path.push([bx, y]);
    } else {
      for (let y = ay; y !== by; y += sy) path.push([ax, y]);
      for (let x = ax; x !== bx; x += sx) path.push([x, by]);
    }
    path.push([bx, by]);
    return path;
  }

  /** A clean L crosses only the rings of its two rooms, once each (corridor-wide). */
  private clean(path: readonly (readonly [number, number])[], ra: number, rb: number): boolean {
    const c = this.lo + this.hi + 1;
    this.tick++;
    let na = 0;
    let nb = 0;
    let ok = true;
    for (const [x, y] of path) {
      this.brush(x, y, (i) => {
        if (!ok || this.stamp[i] === this.tick) return;
        this.stamp[i] = this.tick;
        const room = this.roomAt[i]!;
        if (room >= 0) {
          if (room !== ra && room !== rb) ok = false;
          return;
        }
        const ring = this.ringOf[i]!;
        if (ring === ra) na++;
        else if (ring === rb) nb++;
        else if (ring >= 0) ok = false;
      });
      if (!ok || na > c || nb > c) return false;
    }
    return true;
  }

  /** Cost of a brush anchored at (x, y) for a corridor between rooms ra and rb. */
  private cost(x: number, y: number, ra: number, rb: number): number {
    if (
      x - this.lo < 1 ||
      y - this.lo < 1 ||
      x + this.hi > this.w - 2 ||
      y + this.hi > this.h - 2
    ) {
      return Infinity;
    }
    let worst = 1;
    this.brush(x, y, (i) => {
      const room = this.roomAt[i]!;
      const ring = this.ringOf[i]!;
      let c: number;
      if (room >= 0) c = room === ra || room === rb ? 1 : 40;
      else if (ring >= 0) c = ring === ra || ring === rb ? 4 : 12;
      else c = this.floor.data[i] !== 0 ? 1 : 2;
      if (c > worst) worst = c;
    });
    return worst;
  }

  /** Carves a corridor between rooms ra and rb, from anchor a to anchor b. */
  link(
    ra: number,
    rb: number,
    a: readonly [number, number],
    b: readonly [number, number],
    rng: Rng,
  ): void {
    const hFirst = rng.chance(0.5);
    for (const hf of [hFirst, !hFirst]) {
      const path = this.lPath(a, b, hf);
      if (this.clean(path, ra, rb)) {
        this.carvePath(path);
        return;
      }
    }
    const x0 = Math.max(0, Math.min(a[0], b[0]) - WINDOW);
    const y0 = Math.max(0, Math.min(a[1], b[1]) - WINDOW);
    const x1 = Math.min(this.w - 1, Math.max(a[0], b[0]) + WINDOW);
    const y1 = Math.min(this.h - 1, Math.max(a[1], b[1]) + WINDOW);
    const path = astar(
      x1 - x0 + 1,
      y1 - y0 + 1,
      (x, y) => this.cost(x + x0, y + y0, ra, rb),
      [a[0] - x0, a[1] - y0],
      [b[0] - x0, b[1] - y0],
    );
    // The window always holds a finite path; the L stays as a last resort.
    this.carvePath(
      path === null ? this.lPath(a, b, hFirst) : path.map(([x, y]) => [x + x0, y + y0] as const),
    );
  }

  /** Connects every floor component to the largest one (should not happen); returns the count. */
  repair(): number {
    const { labels, sizes } = components(this.floor, (v) => v !== 0);
    if (sizes.length < 2) return 0;
    let main = 0;
    for (let k = 1; k < sizes.length; k++) if (sizes[k]! > sizes[main]!) main = k;
    const first = new Int32Array(sizes.length).fill(-1);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!;
      if (l >= 0 && first[l] === -1) first[l] = i;
    }
    const at = (i: number): [number, number] => [i % this.w, Math.floor(i / this.w)];
    let repairs = 0;
    for (let k = 0; k < sizes.length; k++) {
      if (k === main) continue;
      const path = astar(
        this.w,
        this.h,
        (x, y) =>
          x < 1 || y < 1 || x > this.w - 2 || y > this.h - 2
            ? Infinity
            : this.floor.get(x, y) !== 0
              ? 1
              : 2,
        at(first[k]!),
        at(first[main]!),
      );
      if (path !== null) for (const [x, y] of path) this.floor.set(x, y, 1);
      repairs++;
    }
    return repairs;
  }
}
