/** Deterministic PRNG (projet.md 16.1): xmur3 seed hash + sfc32 generator. Integer maths only. */

const TWO32 = 4294967296;

/** String hash (xmur3): returns a function yielding successive uint32 values. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** sfc32 generator: returns a function yielding successive uint32 values. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  return () => {
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
}

export class Rng {
  private readonly u32: () => number;
  /** Full seed string this generator was created from (used by fork). */
  readonly seedStr: string;

  constructor(seedStr: string) {
    this.seedStr = seedStr;
    const h = xmur3(seedStr);
    this.u32 = sfc32(h(), h(), h(), h());
  }

  /** Next raw uint32. */
  nextU32(): number {
    return this.u32();
  }

  /** Float in [0, 1). */
  next(): number {
    return this.u32() / TWO32;
  }

  /** Integer in [min, max], bounds included, without modulo bias (rejection). */
  int(min: number, max: number): number {
    const range = Math.floor(max) - Math.ceil(min) + 1;
    if (!(range >= 1) || range > TWO32) throw new RangeError(`Rng.int(${min}, ${max})`);
    const lo = Math.ceil(min);
    if (range === 1) return lo;
    const limit = Math.floor(TWO32 / range) * range;
    let u = this.u32();
    while (u >= limit) u = this.u32();
    return lo + (u % range);
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError('Rng.pick: empty array');
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** Weighted choice; weights must be >= 0 with a positive sum. */
  weighted<T>(items: readonly T[], weight: (item: T, index: number) => number): T {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += Math.max(0, weight(items[i]!, i));
    if (!(total > 0)) throw new RangeError('Rng.weighted: no positive weight');
    let r = this.next() * total;
    let last = -1;
    for (let i = 0; i < items.length; i++) {
      const w = Math.max(0, weight(items[i]!, i));
      if (w <= 0) continue;
      last = i;
      if (r < w) return items[i]!;
      r -= w;
    }
    return items[last]!;
  }

  /** Fisher-Yates, in place; returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
    return arr;
  }

  /** Independent, deterministic sub-generator (does not consume this one). */
  fork(label: string): Rng {
    return new Rng(this.seedStr + '/' + label);
  }
}

/** Generator RNG of D1: sfc32 seeded by 4 draws of xmur3(seed:generator:gen_version). */
export function createRng(seed: string, generator: string, genVersion: number): Rng {
  return new Rng(seed + ':' + generator + ':' + genVersion);
}
