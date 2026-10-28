/** Trees, bushes and rocks: variable-density Poisson-disk sampling by biome. */
import { poissonDisk } from '../poisson';
import type { Rng } from '../prng';
import { FOREST, HILL, MOUNTAIN, OASIS, PLAIN, type Land } from './terrain';

export interface Scatter {
  trees: [number, number][];
  bushes: [number, number][];
  rocks: [number, number][];
}

/**
 * `blocked` marks the cells that stay free (water, roads, bridges). One item per cell; the
 * three passes (trees, bushes, rocks) never share a cell.
 */
export function scatter(
  land: Land,
  forest: number,
  oasisOnly: boolean,
  blocked: Uint8Array,
  rng: Rng,
): Scatter {
  const { w, h, biome, moist } = land;
  const occ = new Uint8Array(w * h);
  const out: Scatter = { trees: [], bushes: [], rocks: [] };
  const span = Math.max(1e-6, land.moistMax - land.moistMin);
  const wet01 = (x: number, y: number): number =>
    Math.min(1, Math.max(0, (moist[Math.floor(y) * w + Math.floor(x)]! - land.moistMin) / span));
  const pass = (
    label: string,
    into: [number, number][],
    radius: (x: number, y: number) => number,
    allowed: (b: number) => boolean,
  ): void => {
    const mask = (x: number, y: number): boolean => {
      const i = y * w + x;
      return blocked[i] === 0 && occ[i] === 0 && allowed(biome[i]!);
    };
    for (const [px, py] of poissonDisk(rng.fork(label), w, h, radius, { mask })) {
      const i = Math.floor(py) * w + Math.floor(px);
      if (!mask(i % w, Math.floor(i / w))) continue;
      occ[i] = 1;
      into.push([Math.floor(px), Math.floor(py)]);
    }
  };
  if (forest > 0) {
    pass(
      'trees',
      out.trees,
      (x, y) => 1.6 + 1.4 * (1 - wet01(x, y)),
      (b) => b === FOREST,
    );
    pass(
      'lone-trees',
      out.trees,
      () => 7,
      (b) => b === OASIS || (!oasisOnly && b === PLAIN),
    );
    pass(
      'bushes',
      out.bushes,
      () => 4.5,
      (b) => b === FOREST || (!oasisOnly && b === PLAIN),
    );
  }
  pass(
    'rocks',
    out.rocks,
    () => 2.8,
    (b) => b === MOUNTAIN,
  );
  pass(
    'hill-rocks',
    out.rocks,
    () => 6,
    (b) => b === HILL,
  );
  return out;
}
