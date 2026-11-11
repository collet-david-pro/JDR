import { describe, expect, it } from 'vitest';
import {
  EDGE_DEPTH,
  EDGE_STRIPS,
  SIDE_E,
  SIDE_N,
  SIDE_S,
  SIDE_W,
  edgeMask,
  edgeStrips,
  isSoftEdges,
  sideStrips,
} from '../src/engine/soft-edges';

const soft = (i: number): boolean => i === 1 || i === 2;

describe('soft edges', () => {
  it('recognises the autotile value', () => {
    expect(isSoftEdges('soft')).toBe(true);
    expect(isSoftEdges('none')).toBe(false);
    expect(isSoftEdges(null)).toBe(false);
  });

  it('masks only different soft non-empty neighbours of a soft cell', () => {
    expect(edgeMask(1, 2, 1, 0, 3, soft)).toBe(SIDE_N);
    expect(edgeMask(1, 2, 2, 2, 2, soft)).toBe(SIDE_N | SIDE_E | SIDE_S | SIDE_W);
    expect(edgeMask(1, 1, 0, 0, 0, soft)).toBe(0);
    expect(edgeMask(3, 1, 1, 1, 1, soft)).toBe(0);
    expect(edgeMask(0, 1, 1, 1, 1, soft)).toBe(0);
  });

  it('is symmetric across a shared edge', () => {
    expect(edgeMask(1, 0, 2, 0, 0, soft)).toBe(SIDE_E);
    expect(edgeMask(2, 0, 0, 0, 1, soft)).toBe(SIDE_W);
  });

  it('builds strips along the right side, fading away from the edge', () => {
    const north = sideStrips(SIDE_N);
    expect(north).toHaveLength(EDGE_STRIPS);
    expect(north[0]).toMatchObject({ x: 0, y: 0, w: 1 });
    expect(north[0]!.alpha).toBeGreaterThan(north[EDGE_STRIPS - 1]!.alpha);
    const last = sideStrips(SIDE_E)[EDGE_STRIPS - 1]!;
    expect(last.x).toBeCloseTo(1 - EDGE_DEPTH);
    const south = sideStrips(SIDE_S)[0]!;
    expect(south.y + south.h).toBeCloseTo(1);
    const west = sideStrips(SIDE_W)[0]!;
    expect(west.x).toBe(0);
  });

  it('lists the strips of every masked side', () => {
    expect(edgeStrips(0)).toHaveLength(0);
    expect(edgeStrips(SIDE_N | SIDE_W)).toHaveLength(2 * EDGE_STRIPS);
  });
});
