import { describe, expect, it } from 'vitest';
import type { MapObject, Point } from '../../src/editor/contracts';
import { createVisionCore } from '../../src/vision';
import { distToBoundary, door, flatOf, inside, leaks, rng, scene, wall } from './helpers';

/**
 * Fuzzing of the joints (projet.md 23 P5: no leak at joints): random closed rooms built in
 * several ways (one closed polyline, one wall per edge with ends jittered below ε, edges cut
 * in collinear pieces, closed / secret doors on the edges, walls overshooting the corners),
 * random sources inside ⇒ no point of the visibility polygon lies outside the room.
 */

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Smallest corner angle of a polygon (radians). */
function minCorner(room: readonly Point[]): number {
  let best = Math.PI;
  room.forEach((v, i) => {
    const p = room[(i + room.length - 1) % room.length]!;
    const q = room[(i + 1) % room.length]!;
    const a = Math.atan2(p[1] - v[1], p[0] - v[0]);
    const b = Math.atan2(q[1] - v[1], q[0] - v[0]);
    let d = Math.abs(a - b);
    if (d > Math.PI) d = 2 * Math.PI - d;
    best = Math.min(best, d);
  });
  return best;
}

/**
 * Random star-shaped room. Corners sharper than ~8° are rejected: there two walls run closer
 * than ε over a visible length, which the welding legitimately treats as one wall.
 */
function randomRoom(r: () => number): Point[] {
  for (;;) {
    const room = starRoom(r);
    if (minCorner(room) > 0.15) return room;
  }
}

function starRoom(r: () => number): Point[] {
  const cx = 15 + r() * 10;
  const cy = 15 + r() * 10;
  const n = 3 + Math.floor(r() * 10);
  const angles = Array.from({ length: n }, () => r() * Math.PI * 2).sort((a, b) => a - b);
  // Avoid nearly coincident angles (degenerate spikes).
  for (let i = 1; i < n; i++) angles[i] = Math.max(angles[i]!, angles[i - 1]! + 0.05);
  return angles.map((a) => {
    const rad = 2 + r() * 8;
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as Point;
  });
}

function edges(room: readonly Point[]): [Point, Point][] {
  return room.map((p, i) => [p, room[(i + 1) % room.length]!]);
}

const lerp = (a: Point, b: Point, f: number): Point => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
];

function build(room: Point[], style: number, r: () => number): MapObject[] {
  const jitter = (p: Point): Point => [p[0] + (r() - 0.5) * 6e-5, p[1] + (r() - 0.5) * 6e-5];
  const maybeReverse = (a: Point, b: Point): [Point, Point] => (r() < 0.5 ? [a, b] : [b, a]);
  switch (style) {
    case 0:
      return [
        wall(
          room.map(([x, y]) => [round3(x), round3(y)] as Point),
          true,
        ),
      ];
    case 1:
      return edges(room).map(([a, b]) => wall(maybeReverse(jitter(a), jitter(b))));
    case 2:
      return edges(room).flatMap(([a, b]) => {
        const cuts = [0, ...Array.from({ length: 1 + Math.floor(r() * 2) }, () => r()), 1].sort();
        return cuts.slice(1).map((f, i) => wall(maybeReverse(lerp(a, b, cuts[i]!), lerp(a, b, f))));
      });
    case 3: {
      const out: MapObject[] = [wall(room, true)];
      for (const [a, b] of edges(room)) {
        if (r() < 0.5) continue;
        const f = 0.1 + r() * 0.5;
        const g = Math.min(0.95, f + 0.05 + r() * 0.3);
        const secret = r() < 0.3;
        out.push(door(lerp(a, b, f), lerp(a, b, g), { state: secret ? 'open' : 'closed', secret }));
      }
      return out;
    }
    default:
      return edges(room).map(([a, b]) =>
        wall([lerp(a, b, -0.05 * r()), lerp(a, b, 1 + 0.05 * r())]),
      );
  }
}

function sourceIn(room: Point[], r: () => number): Point {
  const flat = flatOf(room);
  const xs = room.map((p) => p[0]);
  const ys = room.map((p) => p[1]);
  for (;;) {
    const x = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs));
    const y = Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys));
    if (inside(flat, x, y) && distToBoundary(flat, x, y) > 2e-3) return [x, y];
  }
}

describe('fuzzing: no leak at joints', () => {
  it('closed random rooms keep vision and light inside (500 rooms × 4 sources)', () => {
    const r = rng(20261026);
    let checked = 0;
    for (let k = 0; k < 500; k++) {
      const room = randomRoom(r);
      const style = k % 5;
      const objects = build(room, style, r);
      const core = createVisionCore();
      core.setScene(scene(objects, 40, 40, 'player', k));
      const flat = flatOf(room);
      const sources: Point[] = [sourceIn(room, r), sourceIn(room, r), sourceIn(room, r)];
      // One source right next to a corner.
      const c = room[Math.floor(r() * room.length)]!;
      const centre = sourceIn(room, r);
      let near = lerp(c, centre, 0.002);
      if (!inside(flat, near[0], near[1]) || distToBoundary(flat, near[0], near[1]) < 2e-3) {
        near = centre;
      }
      sources.push(near);
      for (const kind of ['vision', 'light'] as const) {
        const list = sources.map(([x, y], i) => ({ id: String(i), x, y, radius: 3 + r() * 30 }));
        const result = core.compute(kind, list);
        for (const [id, polygon] of result) {
          const bad = leaks(polygon, flat);
          if (bad.length > 0) {
            throw new Error(
              `leak: room ${k} style ${style} source ${JSON.stringify(list[Number(id)])} ${kind} at ${JSON.stringify(bad[0])} room ${JSON.stringify(room)} walls ${JSON.stringify(objects.map((o) => o.geometry))}`,
            );
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(500 * 4 * 2);
  });

  it('rooms split by an inner wall in T joints keep each part separate', () => {
    const r = rng(7);
    for (let k = 0; k < 200; k++) {
      const x0 = 2 + r() * 5;
      const y0 = 2 + r() * 5;
      const w = 4 + r() * 10;
      const h = 4 + r() * 10;
      const split = x0 + w * (0.2 + r() * 0.6);
      const gap = (r() - 0.5) * 6e-5;
      const objects = [
        wall(
          [
            [x0, y0],
            [x0 + w, y0],
            [x0 + w, y0 + h],
            [x0, y0 + h],
          ],
          true,
        ),
        wall([
          [split, y0 + gap],
          [split + gap, y0 + h - gap],
        ]),
      ];
      const left = flatOf([
        [x0, y0],
        [split, y0],
        [split, y0 + h],
        [x0, y0 + h],
      ]);
      const core = createVisionCore();
      core.setScene(scene(objects, 30, 30, 'gm', k));
      const src: Point = [x0 + (split - x0) * (0.01 + r() * 0.98), y0 + h * (0.01 + r() * 0.98)];
      const p = core.compute('vision', [{ id: 's', x: src[0], y: src[1], radius: 40 }]).get('s')!;
      expect(leaks(p, left, 3e-3)).toEqual([]);
    }
  });
});
