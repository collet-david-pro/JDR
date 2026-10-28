/**
 * The ten texture materials (D15). Each one builds a sampler returning, for a pixel, a palette
 * position `c` in [0, 1] and a height `h` (used for the relief lighting). Everything is made of
 * periodic noises whose period divides the tile size, so tiles repeat without seams.
 * No trigonometry on purpose: the bytes stay identical across JS engines.
 */
import type { Rng } from '../prng';
import { clamp01, field, smooth, stretched, tri, voronoi } from './cells';

export const MATERIALS = [
  'stone',
  'flagstone',
  'cobble',
  'wood',
  'grass',
  'dirt',
  'sand',
  'water',
  'lava',
  'ice',
] as const;
export type Material = (typeof MATERIALS)[number];

/** Writes `[c, h]` into `out`. */
export type Sampler = (x: number, y: number, out: [number, number]) => void;
export interface MaterialDef {
  /** Strength of the relief lighting. */
  relief: number;
  make(rng: Rng, size: number): Sampler;
}

const stone: MaterialDef = {
  relief: 1,
  make(rng, size) {
    const big = field(rng, 'big', size, 4, 4);
    const mid = field(rng, 'mid', size, 12, 3);
    const grain = field(rng, 'grain', size, 64, 2);
    return (x, y, out) => {
      const a = big(x, y);
      const b = mid(x, y);
      const g = grain(x, y);
      out[0] = clamp01(0.5 + 0.8 * a + 0.5 * b + 0.25 * g);
      out[1] = 0.5 + 0.7 * a + 0.5 * b + 0.3 * g;
    };
  },
};

const flagstone: MaterialDef = {
  relief: 1.2,
  make(rng, size) {
    const vor = voronoi(rng, size, 4);
    const wob = field(rng, 'wob', size, 8, 3);
    const grain = field(rng, 'grain', size, 48, 2);
    return (x, y, out) => {
      const v = vor(x, y);
      const t = smooth((v.f2 - v.f1) / 0.16);
      const base = 0.35 + 0.4 * v.id + 0.3 * wob(x, y) + 0.15 * grain(x, y);
      out[0] = clamp01(base) * t;
      out[1] = 0.3 + 0.7 * t + 0.08 * wob(x, y);
    };
  },
};

const cobble: MaterialDef = {
  relief: 1.5,
  make(rng, size) {
    const vor = voronoi(rng, size, 8);
    const grain = field(rng, 'grain', size, 48, 2);
    return (x, y, out) => {
      const v = vor(x, y);
      const t = smooth((v.f2 - v.f1) / 0.2);
      const dome = clamp01(1 - v.f1 * 1.5);
      const base = 0.3 + 0.45 * v.id + 0.25 * grain(x, y) + 0.2 * dome;
      out[0] = clamp01(base) * (0.15 + 0.85 * t);
      out[1] = 0.1 + 0.9 * dome * t;
    };
  },
};

const wood: MaterialDef = {
  relief: 0.6,
  make(rng, size) {
    const grain = stretched(rng, 'grain', size, 4, 32, 3);
    const fine = stretched(rng, 'fine', size, 8, 96, 2);
    const r = rng.fork('planks');
    const planks = 4;
    const ph = size / planks;
    const tones: number[] = [];
    const breaks: number[] = [];
    for (let i = 0; i < planks; i++) {
      breaks.push(r.int(0, size - 1));
      tones.push(r.float(0.25, 0.7), r.float(0.25, 0.7));
    }
    const half = size / 2;
    return (x, y, out) => {
      const row = Math.min(planks - 1, Math.floor(y / ph));
      const fy = y - row * ph;
      const along = (x - breaks[row]! + size) % size;
      const seg = along < half ? 0 : 1;
      const dj = Math.min(along % half, half - (along % half));
      const edge = Math.min(fy, ph - fy);
      const t = smooth(edge / 2.5) * smooth(dj / 2);
      const g = grain(x + row * 37, y);
      const f = fine(x, y);
      out[0] = clamp01(tones[row * 2 + seg]! + 0.28 * g + 0.12 * f) * (0.2 + 0.8 * t);
      out[1] = 0.3 + 0.6 * t + 0.1 * g;
    };
  },
};

const grass: MaterialDef = {
  relief: 0.5,
  make(rng, size) {
    const patch = field(rng, 'patch', size, 6, 4);
    const blade = field(rng, 'blade', size, 80, 2);
    const tuft = field(rng, 'tuft', size, 32, 2);
    return (x, y, out) => {
      const a = patch(x, y);
      const b = blade(x, y);
      const c = tuft(x, y);
      out[0] = clamp01(0.5 + 0.6 * a + 0.35 * b + 0.25 * c);
      out[1] = 0.5 + 0.5 * b + 0.3 * c;
    };
  },
};

const dirt: MaterialDef = {
  relief: 1.1,
  make(rng, size) {
    const big = field(rng, 'big', size, 5, 4);
    const grain = field(rng, 'grain', size, 64, 3);
    const peb = voronoi(rng, size, 12);
    return (x, y, out) => {
      const a = big(x, y);
      const g = grain(x, y);
      const v = peb(x, y);
      const pebble = v.id > 0.65 ? smooth((0.3 - v.f1) / 0.12) : 0;
      out[0] = clamp01(0.45 + 0.7 * a + 0.3 * g + 0.3 * pebble);
      out[1] = 0.4 + 0.5 * a + 0.3 * g + 0.8 * pebble;
    };
  },
};

const sand: MaterialDef = {
  relief: 0.9,
  make(rng, size) {
    const warp = field(rng, 'warp', size, 3, 3);
    const grain = field(rng, 'grain', size, 128, 1);
    const wide = field(rng, 'wide', size, 4, 3);
    return (x, y, out) => {
      const rip = tri((y / size) * 10 + warp(x, y) * 1.4);
      const g = grain(x, y);
      out[0] = clamp01(0.45 + 0.3 * rip + 0.25 * g + 0.25 * wide(x, y));
      out[1] = 0.3 * rip + 0.1 * g + 0.2 * wide(x, y);
    };
  },
};

const water: MaterialDef = {
  relief: 0.7,
  make(rng, size) {
    const w1 = field(rng, 'w1', size, 4, 3);
    const w2 = field(rng, 'w2', size, 8, 3);
    return (x, y, out) => {
      const wave = tri(((x + y) / size) * 6 + 0.9 * w1(x, y));
      const wave2 = tri(((x - y) / size) * 10 + 0.6 * w2(x, y));
      const r = 0.65 * wave + 0.35 * wave2;
      const crest = smooth((r - 0.8) / 0.15);
      out[0] = clamp01(0.2 + 0.55 * r + 0.3 * crest);
      out[1] = r;
    };
  },
};

const lava: MaterialDef = {
  relief: 0.5,
  make(rng, size) {
    const vor = voronoi(rng, size, 5);
    const warp = field(rng, 'warp', size, 4, 3);
    const fine = field(rng, 'fine', size, 24, 3);
    return (x, y, out) => {
      const w = warp(x, y) * 14;
      const v = vor(x + w, y - w);
      const hot = 1 - smooth((v.f2 - v.f1) / 0.4);
      out[0] = clamp01(0.05 + 0.8 * hot + 0.15 * fine(x, y) + 0.1 * v.id * (1 - hot));
      out[1] = (1 - hot) * 0.8 + 0.2 * fine(x, y);
    };
  },
};

const ice: MaterialDef = {
  relief: 0.8,
  make(rng, size) {
    const base = field(rng, 'base', size, 3, 4);
    const frost = field(rng, 'frost', size, 48, 2);
    const vor = voronoi(rng, size, 4);
    const warp = field(rng, 'warp', size, 6, 2);
    return (x, y, out) => {
      const w = warp(x, y) * 8;
      const v = vor(x + w, y + w);
      const crack = 1 - smooth((v.f2 - v.f1) / 0.05);
      out[0] = clamp01(0.6 + 0.35 * base(x, y) + 0.12 * frost(x, y) - 0.5 * crack);
      out[1] = 0.5 + 0.3 * base(x, y) - 0.4 * crack;
    };
  },
};

export const MATERIAL_DEFS: Readonly<Record<Material, MaterialDef>> = {
  stone,
  flagstone,
  cobble,
  wood,
  grass,
  dirt,
  sand,
  water,
  lava,
  ice,
};
