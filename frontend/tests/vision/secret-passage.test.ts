import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../src/editor/contracts';
import { createVisionCore } from '../../src/vision';
import { isOccluderObject } from '../../src/vision/core';
import { passage, pin, trap, zone } from '../editor/note-helpers';
import { inside, scene, wall } from './helpers';

function poly(objects: readonly MapObject[], kind: 'vision' | 'light', viewer: 'gm' | 'player') {
  const core = createVisionCore();
  core.setScene(scene(objects, 20, 20, viewer));
  return core.compute(kind, [{ id: 's', x: 10, y: 10, radius: 30, cone: null }]).get('s')!;
}

describe('secret passage', () => {
  // A room whose left wall has a gap (2,8)-(2,12), closed only by the passage.
  const room = wall([
    [2, 8],
    [2, 2],
    [18, 2],
    [18, 18],
    [2, 18],
    [2, 12],
  ]);
  const gap = passage('s', [2, 12], [2, 8]);

  it('is an occluder object, the others of the family are not', () => {
    expect(isOccluderObject(gap)).toBe(true);
    for (const o of [
      pin('p', 1, 1),
      zone('z', [
        [1, 1],
        [4, 1],
        [4, 4],
      ]),
      trap('t', 1, 1),
    ]) {
      expect(isOccluderObject(o)).toBe(false);
    }
  });

  it('blocks vision and light for players, not for the GM', () => {
    expect(inside(poly([room, gap], 'vision', 'player'), 0.5, 10)).toBe(false);
    expect(inside(poly([room, gap], 'light', 'player'), 0.5, 10)).toBe(false);
    expect(inside(poly([room, gap], 'vision', 'gm'), 0.5, 10)).toBe(true);
    expect(inside(poly([room, gap], 'light', 'gm'), 0.5, 10)).toBe(true);
    // Without the passage the gap lets the players see out.
    expect(inside(poly([room], 'vision', 'player'), 0.5, 10)).toBe(true);
  });

  it('blocks movement for players only', () => {
    const core = createVisionCore();
    core.setScene(scene([gap], 20, 20, 'player'));
    const hit = core.firstHit('move', [6, 10], [1, 10]);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(2);
    core.setScene(scene([gap], 20, 20, 'gm', 2));
    expect(core.firstHit('move', [6, 10], [1, 10])).toBeNull();
  });

  it('pins, zones, traps and secret rooms block nothing', () => {
    const core = createVisionCore();
    core.setScene(
      scene(
        [
          pin('p', 5, 10),
          zone('z', [
            [4, 4],
            [9, 4],
            [9, 12],
          ]),
          trap('t', 7, 10),
        ],
        20,
        20,
        'player',
      ),
    );
    expect(core.firstHit('move', [10, 10], [1, 10])).toBeNull();
    expect(core.firstHit('vision', [10, 10], [1, 10])).toBeNull();
  });
});
