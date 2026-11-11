import { describe, expect, it } from 'vitest';
import { nearestSnapShift, objectAnchors, snapTargets } from '../../src/editor/tools/snap-targets';
import { pickPoint } from '../../src/editor/ui/point-pick';
import { wall } from './scene-helpers';

describe('snap targets', () => {
  it('lists wall ends and middles, skipping excluded objects', () => {
    const w = wall('w1', [
      [0, 0],
      [4, 0],
    ]);
    const pts = snapTargets([w]);
    expect(pts).toContainEqual([0, 0]);
    expect(pts).toContainEqual([2, 0]);
    expect(snapTargets([w], (o) => o.uid === 'w1')).toEqual([]);
    expect(objectAnchors(w)).toContainEqual([4, 0]);
  });

  it('finds the nearest shift within tolerance only', () => {
    const shift = nearestSnapShift(
      [[1.1, 1]],
      [
        [1, 1],
        [5, 5],
      ],
      0.3,
    );
    expect(shift?.target).toEqual([1, 1]);
    expect(shift?.dx).toBeCloseTo(-0.1);
    expect(nearestSnapShift([[3, 3]], [[1, 1]], 0.3)).toBeNull();
    expect(nearestSnapShift([], [[1, 1]], 1)).toBeNull();
  });
});

describe('pickPoint', () => {
  const box = { left: 10, top: 20, width: 200, height: 100 };
  it('converts a click to half cells and clamps', () => {
    expect(pickPoint(box, 110, 70, { width: 20, height: 10 })).toEqual([10, 5]);
    expect(pickPoint(box, 113, 72, { width: 20, height: 10 })).toEqual([10.5, 5]);
    expect(pickPoint(box, -50, 500, { width: 20, height: 10 })).toEqual([0, 10]);
    expect(pickPoint({ ...box, width: 0 }, 1, 1, { width: 20, height: 10 })).toBeNull();
  });
});
