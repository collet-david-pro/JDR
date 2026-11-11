/**
 * Soft edges (l14): optional blending between two different adjacent painted cells.
 *
 * A palette entry whose `autotile` value is "soft" gets feathered borders: where a neighbour
 * (4 directions, same layer) shows another soft entry, a few strips along that side of the
 * cell show the neighbour's image with a decreasing opacity. Each of the two cells blends the
 * other one in, so the transition is symmetric and continuous across the shared edge. Purely
 * visual: nothing is stored per cell and the cell data are unchanged. Pure helpers shared by
 * the engine and the PNG export.
 */

/** `autotile` value enabling soft edges on a palette entry. */
export const SOFT_EDGES = 'soft';
/** `autotile` value sent to switch soft edges off on an existing entry (stored as absent). */
export const SOFT_EDGES_OFF = 'none';

export function isSoftEdges(autotile: string | null | undefined): boolean {
  return autotile === SOFT_EDGES;
}

/** Sides of a cell (bit mask). */
export const SIDE_N = 1;
export const SIDE_E = 2;
export const SIDE_S = 4;
export const SIDE_W = 8;

/** Number of strips per side and depth of the transition (fraction of the cell). */
export const EDGE_STRIPS = 4;
export const EDGE_DEPTH = 0.4;
/** Opacity of the neighbour's image on the shared edge (0.5 = even mix). */
export const EDGE_MAX_ALPHA = 0.5;

/**
 * Sides of a cell with a transition: the neighbour is a different, non-empty entry and both
 * entries are soft. `soft(index)` tells whether an entry has soft edges. Indices of absent
 * neighbours (outside the grid or empty) are 0.
 */
export function edgeMask(
  self: number,
  north: number,
  east: number,
  south: number,
  west: number,
  soft: (index: number) => boolean,
): number {
  if (self === 0 || !soft(self)) return 0;
  const differs = (n: number): boolean => n !== 0 && n !== self && soft(n);
  return (
    (differs(north) ? SIDE_N : 0) |
    (differs(east) ? SIDE_E : 0) |
    (differs(south) ? SIDE_S : 0) |
    (differs(west) ? SIDE_W : 0)
  );
}

/** One strip in unit cell coordinates (0..1), drawn with the neighbour's image. */
export interface EdgeStrip {
  readonly side: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Opacity, decreasing away from the shared edge. */
  readonly alpha: number;
}

/** Strips of one side. */
export function sideStrips(side: number): EdgeStrip[] {
  const out: EdgeStrip[] = [];
  const size = EDGE_DEPTH / EDGE_STRIPS;
  for (let k = 0; k < EDGE_STRIPS; k++) {
    const alpha = EDGE_MAX_ALPHA * (1 - (k + 0.5) / EDGE_STRIPS);
    const from = k * size;
    if (side === SIDE_N) out.push({ side, x: 0, y: from, w: 1, h: size, alpha });
    else if (side === SIDE_S) out.push({ side, x: 0, y: 1 - from - size, w: 1, h: size, alpha });
    else if (side === SIDE_W) out.push({ side, x: from, y: 0, w: size, h: 1, alpha });
    else out.push({ side, x: 1 - from - size, y: 0, w: size, h: 1, alpha });
  }
  return out;
}

/** Strips of every side of `mask`, in side order N, E, S, W. */
export function edgeStrips(mask: number): EdgeStrip[] {
  const out: EdgeStrip[] = [];
  for (const side of [SIDE_N, SIDE_E, SIDE_S, SIDE_W]) {
    if ((mask & side) !== 0) out.push(...sideStrips(side));
  }
  return out;
}
