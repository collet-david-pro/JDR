import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../src/editor/contracts';
import {
  INERTIA_MAX_SPEED,
  INERTIA_TIME_CONSTANT_MS,
  MAX_ZOOM,
  MIN_ZOOM,
  cellAt,
  clampCenter,
  clampZoom,
  fitCamera,
  inertiaStep,
  isMoving,
  normalizeCamera,
  panByScreen,
  releaseVelocity,
  screenToWorld,
  worldToScreen,
  worldTransform,
  zoomAround,
} from '../../src/engine/camera';

const grid: GridSpec = { width: 200, height: 100, cellPx: 70, unitLabel: 'ft', unitPerCell: 5 };
const vp = { width: 1600, height: 900 };

describe('zoom limits', () => {
  it('clamps to 0.05..8 and rejects non-finite values', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(MIN_ZOOM).toBe(0.05);
    expect(MAX_ZOOM).toBe(8);
  });
});

describe('screen ⇄ world', () => {
  const cam = { x: 50, y: 20, zoom: 0.5 };

  it('maps the viewport centre to the camera position', () => {
    expect(screenToWorld(cam, vp, 70, 800, 450)).toEqual({ x: 50, y: 20 });
  });

  it('round-trips', () => {
    for (const [sx, sy] of [
      [0, 0],
      [123.5, 877],
      [1600, 900],
    ] as const) {
      const w = screenToWorld(cam, vp, 70, sx, sy);
      const s = worldToScreen(cam, vp, 70, w.x, w.y);
      expect(s.x).toBeCloseTo(sx, 9);
      expect(s.y).toBeCloseTo(sy, 9);
    }
  });

  it('one cell is cellPx * zoom pixels', () => {
    const a = worldToScreen(cam, vp, 70, 10, 10);
    const b = worldToScreen(cam, vp, 70, 11, 10);
    expect(b.x - a.x).toBeCloseTo(35, 9);
  });

  it('gives integer cells, also outside the map', () => {
    expect(cellAt({ x: 3.99, y: 0 })).toEqual({ x: 3, y: 0 });
    expect(cellAt({ x: -0.2, y: -1.5 })).toEqual({ x: -1, y: -2 });
  });

  it('world transform matches worldToScreen', () => {
    const t = worldTransform(cam, vp, 70);
    const s = worldToScreen(cam, vp, 70, 12, 7);
    expect(12 * 70 * t.scale + t.tx).toBeCloseTo(s.x, 9);
    expect(7 * 70 * t.scale + t.ty).toBeCloseTo(s.y, 9);
  });
});

describe('zoomAround', () => {
  it('keeps the world point under the pointer', () => {
    const cam = { x: 50, y: 20, zoom: 0.5 };
    const before = screenToWorld(cam, vp, 70, 300, 200);
    const next = zoomAround(cam, vp, 70, 1.7, 300, 200);
    expect(next.zoom).toBeCloseTo(0.85, 9);
    const after = screenToWorld(next, vp, 70, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('respects the limits (anchor still fixed)', () => {
    const cam = { x: 50, y: 20, zoom: 7 };
    const next = zoomAround(cam, vp, 70, 4, 100, 100);
    expect(next.zoom).toBe(MAX_ZOOM);
    const a = screenToWorld(cam, vp, 70, 100, 100);
    const b = screenToWorld(next, vp, 70, 100, 100);
    expect(b.x).toBeCloseTo(a.x, 9);
  });

  it('ignores invalid factors', () => {
    const cam = { x: 1, y: 2, zoom: 1 };
    expect(zoomAround(cam, vp, 70, 0, 10, 10).zoom).toBe(1);
    expect(zoomAround(cam, vp, 70, Number.NaN, 10, 10).zoom).toBe(1);
  });
});

describe('pan and bounds', () => {
  it('moves the map with the pointer', () => {
    const next = panByScreen({ x: 10, y: 10, zoom: 2 }, 50, 100, -50);
    expect(next).toEqual({ x: 9, y: 10.5, zoom: 2 });
  });

  it('keeps the centre over the map', () => {
    expect(clampCenter({ x: -5, y: 500, zoom: 1 }, grid)).toEqual({ x: 0, y: 100, zoom: 1 });
    expect(clampCenter({ x: Number.NaN, y: 3, zoom: 1 }, grid).x).toBe(100);
    expect(normalizeCamera({ x: 300, y: 50, zoom: 20 }, grid)).toEqual({ x: 200, y: 50, zoom: 8 });
  });

  it('fit shows the whole map, centred, within the padding', () => {
    const cam = fitCamera(grid, vp, 24);
    expect(cam.x).toBe(100);
    expect(cam.y).toBe(50);
    const tl = worldToScreen(cam, vp, grid.cellPx, 0, 0);
    const br = worldToScreen(cam, vp, grid.cellPx, grid.width, grid.height);
    expect(tl.x).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(br.x).toBeLessThanOrEqual(vp.width - 24 + 1e-9);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.y).toBeLessThanOrEqual(vp.height);
    // Limited by the width here.
    expect(br.x - tl.x).toBeCloseTo(vp.width - 48, 6);
  });

  it('fit clamps huge maps to the minimum zoom', () => {
    expect(fitCamera({ ...grid, width: 5000, height: 5000 }, vp).zoom).toBe(MIN_ZOOM);
  });
});

describe('inertia', () => {
  it('measures the release velocity on the last samples', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 0, y: 0 },
      { t: 120, x: 10, y: 0 },
      { t: 140, x: 20, y: 5 },
    ];
    const v = releaseVelocity(samples, 145);
    expect(v.vx).toBeCloseTo(0.5, 9);
    expect(v.vy).toBeCloseTo(0.125, 9);
  });

  it('gives no velocity after a pause or without movement', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }], 0)).toEqual({ vx: 0, vy: 0 });
    expect(
      releaseVelocity(
        [
          { t: 0, x: 0, y: 0 },
          { t: 10, x: 50, y: 0 },
        ],
        200,
      ),
    ).toEqual({ vx: 0, vy: 0 });
  });

  it('caps the speed', () => {
    const v = releaseVelocity(
      [
        { t: 0, x: 0, y: 0 },
        { t: 1, x: 1000, y: 0 },
      ],
      1,
    );
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(INERTIA_MAX_SPEED, 9);
  });

  it('decays and travels v * tau in total', () => {
    let v = { vx: 1, vy: 0 };
    let travel = 0;
    let steps = 0;
    while (isMoving(v) && steps < 1000) {
      const s = inertiaStep(v, 16);
      travel += s.dx;
      v = s.velocity;
      steps++;
    }
    expect(steps).toBeLessThan(60);
    expect(travel).toBeGreaterThan(0.9 * INERTIA_TIME_CONSTANT_MS);
    expect(travel).toBeLessThanOrEqual(INERTIA_TIME_CONSTANT_MS);
  });
});
