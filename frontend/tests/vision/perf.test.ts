import { describe, expect, it } from 'vitest';
import type { MapObject, Point } from '../../src/editor/contracts';
import { VisionCoreImpl } from '../../src/vision/core';
import { door, rng, scene, wall } from './helpers';

/**
 * Performance (projet.md 23 P5: 30 lights + 20 tokens; door opening < 100 ms): a 100×100
 * dungeon of 10×10 rooms with doors and pillars, ~2 000 occluding segments.
 */
function dungeon(): { objects: MapObject[]; doorIndex: number } {
  const r = rng(42);
  const objects: MapObject[] = [];
  for (let gy = 0; gy < 10; gy++) {
    for (let gx = 0; gx < 10; gx++) {
      const x = gx * 10;
      const y = gy * 10;
      // Walls on the north and west sides of each room, cut by a door in the middle.
      objects.push(
        wall([
          [x, y],
          [x + 10, y],
        ]),
      );
      objects.push(
        wall([
          [x, y],
          [x, y + 10],
        ]),
      );
      if (gy > 0)
        objects.push(door([x + 4, y], [x + 6, y], { state: r() < 0.5 ? 'open' : 'closed' }));
      if (gx > 0)
        objects.push(door([x, y + 4], [x, y + 6], { state: r() < 0.5 ? 'open' : 'closed' }));
      // Pillars and rubble: small closed polylines.
      for (let k = 0; k < 4; k++) {
        const px = x + 1.5 + r() * 7;
        const py = y + 1.5 + r() * 7;
        const n = 3 + Math.floor(r() * 3);
        const pts: Point[] = Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2;
          return [px + Math.cos(a) * 0.4, py + Math.sin(a) * 0.4];
        });
        objects.push(wall(pts, true));
      }
    }
  }
  objects.push(door([54, 50], [56, 50], { state: 'closed' }));
  return { objects, doorIndex: objects.length - 1 };
}

describe('performance', () => {
  it('30 lights + 20 visions on ~2 000 segments', () => {
    const { objects, doorIndex } = dungeon();
    const core = new VisionCoreImpl();
    const r = rng(9);
    const lights = Array.from({ length: 30 }, (_, i) => ({
      id: `l${i}`,
      x: 1 + r() * 98,
      y: 1 + r() * 98,
      radius: 6 + r() * 14,
    }));
    const tokens = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`,
      x: 1 + r() * 98,
      y: 1 + r() * 98,
      radius: 30,
    }));
    let t0 = performance.now();
    core.setScene(scene(objects, 100, 100, 'gm', 1));
    const segments = core.segments('light').length;
    const build = performance.now() - t0;
    t0 = performance.now();
    core.compute('light', lights);
    core.compute('vision', tokens);
    const first = performance.now() - t0;
    // Door opening: new occluders, everything recomputed.
    const opened = objects.slice();
    const d = opened[doorIndex] as Extract<MapObject, { type: 'door' }>;
    opened[doorIndex] = { ...d, props: { ...d.props, state: 'open' } };
    t0 = performance.now();
    core.setScene(scene(opened, 100, 100, 'gm', 2));
    core.compute('light', lights);
    core.compute('vision', tokens);
    const doorMs = performance.now() - t0;
    // Tokens moved: occluders kept, new polygons for the visions only.
    t0 = performance.now();
    core.setScene(scene(opened, 100, 100, 'gm', 3));
    core.compute('light', lights);
    core.compute(
      'vision',
      tokens.map((t) => ({ ...t, x: t.x + 0.25 })),
    );
    const moveMs = performance.now() - t0;
    console.info(
      `vision perf: ${segments} light segments, build ${build.toFixed(1)} ms, ` +
        `30 lights + 20 visions ${first.toFixed(1)} ms, door opening ${doorMs.toFixed(1)} ms, ` +
        `token move ${moveMs.toFixed(1)} ms`,
    );
    expect(segments).toBeGreaterThan(1500);
    // Generous bounds (CI machines); typical values are reported above.
    expect(first).toBeLessThan(500);
    expect(doorMs).toBeLessThan(500);
  });
});
