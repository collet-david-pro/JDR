import { describe, expect, it } from 'vitest';
import type { MapObject, Point } from '../../src/editor/contracts';
import { createVisionCore } from '../../src/vision';
import { VisionCoreImpl } from '../../src/vision/core';
import type { VisionSource } from '../../src/vision/types';
import { area, door, finite, flatOf, inside, leaks, scene, wall, windowObj } from './helpers';

function poly(
  objects: readonly MapObject[],
  x: number,
  y: number,
  radius = 30,
  kind: 'vision' | 'light' = 'vision',
  options: {
    width?: number;
    height?: number;
    viewer?: 'gm' | 'player';
    cone?: VisionSource['cone'];
  } = {},
): Float32Array {
  const core = createVisionCore();
  core.setScene(scene(objects, options.width ?? 20, options.height ?? 20, options.viewer ?? 'gm'));
  return core.compute(kind, [{ id: 's', x, y, radius, cone: options.cone ?? null }]).get('s')!;
}

const ROOM: Point[] = [
  [5, 5],
  [15, 5],
  [15, 15],
  [5, 15],
];

describe('visibility polygon: open space and map border', () => {
  it('is the 64-gon disc without occluders', () => {
    const p = poly([], 10, 10, 4);
    expect(p.length / 2).toBe(64);
    for (let i = 0; i < p.length; i += 2) {
      expect(Math.hypot(p[i]! - 10, p[i + 1]! - 10)).toBeCloseTo(4, 4);
    }
    // Area of the regular 64-gon inscribed in the circle.
    expect(area(p)).toBeCloseTo(0.5 * 64 * 16 * Math.sin((2 * Math.PI) / 64), 3);
  });

  it('is clipped to the map rectangle', () => {
    const p = poly([], 1, 1, 10, 'vision', { width: 6, height: 4 });
    for (let i = 0; i < p.length; i += 2) {
      expect(p[i]!).toBeGreaterThanOrEqual(-1e-4);
      expect(p[i]!).toBeLessThanOrEqual(6 + 1e-4);
      expect(p[i + 1]!).toBeGreaterThanOrEqual(-1e-4);
      expect(p[i + 1]!).toBeLessThanOrEqual(4 + 1e-4);
    }
    expect(area(p)).toBeCloseTo(24, 2);
  });

  it('keeps a source lying on the map border inside', () => {
    const p = poly([], 0, 3, 2, 'vision', { width: 6, height: 6 });
    expect(finite(p)).toBe(true);
    expect(area(p)).toBeCloseTo((Math.PI * 4) / 2, 0);
  });
});

describe('a wall stops vision and light', () => {
  const w = wall([
    [8, 0],
    [8, 20],
  ]);

  it('hides the other side of a wall', () => {
    for (const kind of ['vision', 'light'] as const) {
      const p = poly([w], 4, 10, 30, kind);
      for (let i = 0; i < p.length; i += 2) expect(p[i]!).toBeLessThanOrEqual(8 + 1e-4);
      expect(inside(p, 7.9, 3)).toBe(true);
      expect(inside(p, 8.1, 10)).toBe(false);
    }
  });

  it('respects blocks_vision / blocks_light separately', () => {
    const glassy = wall(
      [
        [8, 0],
        [8, 20],
      ],
      false,
      { blocks_vision: false, blocks_light: true },
    );
    expect(inside(poly([glassy], 4, 10, 30, 'vision'), 12, 10)).toBe(true);
    expect(inside(poly([glassy], 4, 10, 30, 'light'), 12, 10)).toBe(false);
    const dark = wall(
      [
        [8, 0],
        [8, 20],
      ],
      false,
      { blocks_vision: true, blocks_light: false },
    );
    expect(inside(poly([dark], 4, 10, 30, 'vision'), 12, 10)).toBe(false);
    expect(inside(poly([dark], 4, 10, 30, 'light'), 12, 10)).toBe(true);
  });

  it('casts a shadow behind a free-standing wall (corners)', () => {
    const block = wall(
      [
        [9, 9],
        [11, 9],
        [11, 11],
        [9, 11],
      ],
      true,
    );
    const p = poly([block], 5, 10, 30);
    expect(inside(p, 12, 10)).toBe(false);
    expect(inside(p, 15, 10)).toBe(false);
    expect(inside(p, 15, 14)).toBe(true);
    expect(inside(p, 8.9, 10)).toBe(true);
    // The shadow edges go through the corners (9, 9) and (9, 11) as seen from (5, 10).
    expect(inside(p, 13, 7.8)).toBe(true);
    expect(inside(p, 13, 8.2)).toBe(false);
  });

  it('a thin wall (0.05) blocks like a thick one', () => {
    const thin = wall(
      [
        [8, 0],
        [8, 20],
      ],
      false,
      { thickness: 0.05 },
    );
    expect(inside(poly([thin], 4, 10), 8.01, 10)).toBe(false);
  });
});

describe('doors and windows', () => {
  const room = (extra: MapObject[] = []): MapObject[] => [wall(ROOM, true), ...extra];
  const doorAt = (state: 'open' | 'closed', secret = false): MapObject =>
    door([9, 5], [11, 5], { state, secret });

  it('a closed door on a wall keeps the room closed; an open one lets vision out', () => {
    const closed = poly(room([doorAt('closed')]), 10, 10);
    expect(leaks(closed, flatOf(ROOM))).toEqual([]);
    const open = poly(room([doorAt('open')]), 10, 10);
    expect(inside(open, 10, 3)).toBe(true);
    expect(inside(open, 6, 3)).toBe(false);
  });

  it('cuts the wall under a door: segments around an open door, merged when closed', () => {
    const core = createVisionCore();
    const w = wall([
      [0, 5],
      [10, 5],
    ]);
    core.setScene(scene([w, door([4, 5], [6, 5], { state: 'open' })], 10, 10));
    const inner = core.segments('vision').filter((s) => s.ay === 5 && s.by === 5);
    expect(inner.map((s) => [Math.min(s.ax, s.bx), Math.max(s.ax, s.bx)]).sort()).toEqual([
      [0, 4],
      [6, 10],
    ]);
    core.setScene(scene([w, door([4, 5], [6, 5])], 10, 10, 'gm', 2));
    const merged = core.segments('vision').filter((s) => s.ay === 5 && s.by === 5);
    expect(merged).toHaveLength(1);
  });

  it('a door slightly off the wall line (within the thickness) leaves no gap', () => {
    const p = poly(room([door([9, 5.04], [11, 4.97])]), 10, 10);
    expect(leaks(p, flatOf(ROOM))).toEqual([]);
  });

  it('secret door: a wall for players even when open, a door for the GM', () => {
    expect(
      inside(poly(room([doorAt('open', true)]), 10, 10, 30, 'vision', { viewer: 'gm' }), 10, 3),
    ).toBe(true);
    const player = poly(room([doorAt('open', true)]), 10, 10, 30, 'vision', { viewer: 'player' });
    expect(leaks(player, flatOf(ROOM))).toEqual([]);
    const closedGm = poly(room([doorAt('closed', true)]), 10, 10, 30, 'light', { viewer: 'gm' });
    expect(leaks(closedGm, flatOf(ROOM))).toEqual([]);
  });

  it('a window lets vision and light through but blocks movement', () => {
    const objects = room([windowObj([9, 5], [11, 5])]);
    expect(inside(poly(objects, 10, 10, 30, 'vision'), 10, 3)).toBe(true);
    expect(inside(poly(objects, 10, 10, 30, 'light'), 10, 3)).toBe(true);
    const core = createVisionCore();
    core.setScene(scene(objects));
    const hit = core.firstHit('move', [10, 10], [10, 2]);
    expect(hit![0]).toBeCloseTo(10);
    expect(hit![1]).toBeCloseTo(5);
    expect(core.firstHit('vision', [10, 10], [10, 2])).toBeNull();
    expect(core.firstHit('vision', [10, 10], [6, 2])).not.toBeNull();
  });
});

describe('degenerate positions', () => {
  const w = wall([
    [8, 2],
    [8, 18],
  ]);

  it('a source exactly on a wall sees both sides (no crash, no NaN)', () => {
    const p = poly([w], 8, 10, 5);
    expect(finite(p)).toBe(true);
    expect(inside(p, 6, 10)).toBe(true);
    expect(inside(p, 10, 10)).toBe(true);
  });

  it('a source exactly on a wall end sees around it', () => {
    const p = poly([w], 8, 2, 1.5);
    expect(finite(p)).toBe(true);
    expect(area(p)).toBeGreaterThan(Math.PI * 2.25 * 0.95);
  });

  it('a source on the extension line of a wall is not blinded', () => {
    const p = poly([w], 8, 0.5, 30);
    expect(finite(p)).toBe(true);
    expect(inside(p, 4, 10)).toBe(true);
    expect(inside(p, 12, 10)).toBe(true);
  });

  it('collinear pieces and polyline vertices are merged without leaks', () => {
    const core = createVisionCore();
    const objects = [
      wall([
        [2, 10],
        [4, 10],
        [6, 10],
      ]),
      wall([
        [6, 10],
        [9, 10],
      ]),
      wall([
        [9.00005, 10],
        [12, 10],
      ]),
    ];
    core.setScene(scene(objects));
    const inner = core.segments('light').filter((s) => s.ay === 10 && s.by === 10);
    expect(inner).toHaveLength(1);
    const p = poly(objects, 7, 14, 30, 'light');
    for (let x = 2.5; x < 12; x += 0.25) expect(inside(p, x, 9.9)).toBe(false);
  });
});

describe('joints: L, T, X and closed polylines', () => {
  it('L joint with ends 5e-5 apart is welded (no leak through the corner)', () => {
    const objects = [
      wall([
        [5, 5],
        [15, 5],
      ]),
      wall([
        [15.00004, 4.99997],
        [15, 15],
      ]),
      wall([
        [15, 15],
        [5, 15],
        [5, 5],
      ]),
    ];
    for (const [x, y] of [
      [14.9, 5.1],
      [10, 10],
      [14.99, 14.99],
    ] as const) {
      expect(leaks(poly(objects, x, y), flatOf(ROOM))).toEqual([]);
    }
  });

  it('T joint whose stem stops 3e-5 short of the bar does not leak', () => {
    const objects = [
      wall(ROOM, true),
      // Stem from the bottom wall up to just below the top wall.
      wall([
        [10, 15],
        [10, 5.00003],
      ]),
    ];
    const left = flatOf([
      [5, 5],
      [10, 5],
      [10, 15],
      [5, 15],
    ]);
    for (const [x, y] of [
      [9.99, 5.01],
      [7, 10],
      [9.5, 6],
    ] as const) {
      expect(leaks(poly(objects, x, y), left)).toEqual([]);
    }
  });

  it('X joint: crossing walls split the room in four', () => {
    const objects = [
      wall(ROOM, true),
      wall([
        [5, 10],
        [15, 10],
      ]),
      wall([
        [10, 5],
        [10, 15],
      ]),
    ];
    const quarter = flatOf([
      [5, 5],
      [10, 5],
      [10, 10],
      [5, 10],
    ]);
    for (const [x, y] of [
      [9.99, 9.99],
      [6, 6],
      [9.9, 5.1],
    ] as const) {
      expect(leaks(poly(objects, x, y), quarter)).toEqual([]);
    }
  });

  it('walls crossing past their ends (overshoot) still close the room', () => {
    const objects = [
      wall([
        [4, 5],
        [16, 5],
      ]),
      wall([
        [15, 4],
        [15, 16],
      ]),
      wall([
        [16, 15],
        [4, 15],
      ]),
      wall([
        [5, 16],
        [5, 4],
      ]),
    ];
    for (const [x, y] of [
      [14.99, 5.01],
      [5.01, 14.99],
      [10, 10],
    ] as const) {
      expect(leaks(poly(objects, x, y), flatOf(ROOM))).toEqual([]);
    }
  });
});

describe('cones', () => {
  it('limits the polygon to the cone (0° = east, clockwise)', () => {
    const p = poly([], 10, 10, 5, 'light', { cone: { angle: 90, direction: 90 } });
    expect(p[0]).toBeCloseTo(10);
    expect(p[1]).toBeCloseTo(10);
    for (let i = 2; i < p.length; i += 2) {
      const a = (Math.atan2(p[i + 1]! - 10, p[i]! - 10) * 180) / Math.PI;
      expect(a).toBeGreaterThanOrEqual(45 - 1e-3);
      expect(a).toBeLessThanOrEqual(135 + 1e-3);
    }
    // Direction 90° points down on screen (Y down).
    expect(inside(p, 10, 13)).toBe(true);
    expect(inside(p, 10, 7)).toBe(false);
    expect(inside(p, 13, 10.5)).toBe(false);
    expect(area(p)).toBeCloseTo((Math.PI * 25) / 4, 0);
  });

  it('a cone across the ±180° direction is clipped by walls', () => {
    const w = wall([
      [7, 0],
      [7, 20],
    ]);
    const p = poly([w], 10, 10, 8, 'light', { cone: { angle: 60, direction: 180 } });
    expect(inside(p, 8, 10)).toBe(true);
    expect(inside(p, 6, 10)).toBe(false);
    for (let i = 0; i < p.length; i += 2) expect(p[i]!).toBeGreaterThanOrEqual(7 - 1e-4);
  });
});

describe('cache and revisions', () => {
  it('returns the cached polygon for the same rounded position, radius and cone', () => {
    const core = new VisionCoreImpl();
    const w = wall([
      [8, 0],
      [8, 20],
    ]);
    core.setScene(scene([w]));
    const a = core.compute('vision', [{ id: 'a', x: 4, y: 4, radius: 10 }]).get('a');
    const b = core.compute('vision', [{ id: 'b', x: 4.0002, y: 4, radius: 10 }]).get('b');
    expect(b).toBe(a);
    const c = core.compute('vision', [{ id: 'c', x: 4, y: 4, radius: 11 }]).get('c');
    expect(c).not.toBe(a);
    const d = core.compute('light', [{ id: 'd', x: 4, y: 4, radius: 10 }]).get('d');
    expect(d).not.toBe(a);
    // New revision, same occluders (e.g. a token moved): cache and occluders kept.
    const rebuilds = core.rebuilds;
    core.setScene(scene([w], 20, 20, 'gm', 2));
    expect(core.compute('vision', [{ id: 'a', x: 4, y: 4, radius: 10 }]).get('a')).toBe(a);
    expect(core.rebuilds).toBe(rebuilds);
    // Occluders changed: recomputed.
    core.setScene(
      scene(
        [
          w,
          wall([
            [6, 0],
            [6, 20],
          ]),
        ],
        20,
        20,
        'gm',
        3,
      ),
    );
    const e = core.compute('vision', [{ id: 'a', x: 4, y: 4, radius: 10 }]).get('a')!;
    expect(e).not.toBe(a);
    expect(inside(e, 7, 4)).toBe(false);
  });

  it('opening a door updates the polygon', () => {
    const core = createVisionCore();
    const w = wall(ROOM, true);
    core.setScene(scene([w, door([9, 5], [11, 5])], 20, 20, 'gm', 1));
    const closed = core.compute('vision', [{ id: 't', x: 10, y: 10, radius: 20 }]).get('t')!;
    core.setScene(scene([w, door([9, 5], [11, 5], { state: 'open' })], 20, 20, 'gm', 2));
    const open = core.compute('vision', [{ id: 't', x: 10, y: 10, radius: 20 }]).get('t')!;
    expect(inside(closed, 10, 2)).toBe(false);
    expect(inside(open, 10, 2)).toBe(true);
  });
});

describe('firstHit (move occluders)', () => {
  it('returns the first wall hit, ignores a start contact, null when free', () => {
    const core = createVisionCore();
    core.setScene(
      scene([
        wall([
          [5, 0],
          [5, 10],
        ]),
        wall([
          [7, 0],
          [7, 10],
        ]),
        wall(
          [
            [3, 0],
            [3, 10],
          ],
          false,
          { blocks_move: false },
        ),
      ]),
    );
    expect(core.firstHit('move', [1, 5], [9, 5])).toEqual([5, 5]);
    expect(core.firstHit('move', [5, 5], [6, 5])).toBeNull();
    expect(core.firstHit('move', [5.5, 5], [6.5, 5])).toBeNull();
    expect(core.firstHit('vision', [1, 5], [4, 5])).toEqual([3, 5]);
    expect(core.firstHit('move', [1, 5], [4, 5])).toBeNull();
    // Leaving the map is blocked by the border.
    const out = core.firstHit('move', [1, 5], [-3, 5])!;
    expect(out[0]).toBeCloseTo(0);
  });
});
