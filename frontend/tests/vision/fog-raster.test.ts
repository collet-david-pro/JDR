import { describe, expect, it } from 'vitest';
import type { ChunkKey, Point, VisibleScene } from '../../src/editor/contracts';
import {
  FOG_SIDE,
  FOG_SUBCELLS,
  decodeFog,
  encodeFog,
  getFogBit,
} from '../../src/formats/fog-codec';
import { createVisionCore, fogRasterizers } from '../../src/vision';
import type { FogRaster, VisionCore } from '../../src/vision/types';
import { door, flatOf, inside, rng, scene, wall } from './helpers';

/** Reference: every sub-cell of the map tested point by point. */
function reference(
  width: number,
  height: number,
  test: (x: number, y: number) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (let sy = 0; sy < height * FOG_SUBCELLS; sy++) {
    for (let sx = 0; sx < width * FOG_SUBCELLS; sx++) {
      if (test((sx + 0.5) / FOG_SUBCELLS, (sy + 0.5) / FOG_SUBCELLS)) out.add(`${sx},${sy}`);
    }
  }
  return out;
}

function bitsOf(raster: FogRaster): Set<string> {
  const out = new Set<string>();
  for (const [key, bits] of raster) {
    const [cx, cy] = key.split(':').map(Number) as [number, number];
    for (let sy = 0; sy < FOG_SIDE; sy++) {
      for (let sx = 0; sx < FOG_SIDE; sx++) {
        if (getFogBit(bits, sx, sy)) out.add(`${cx * FOG_SIDE + sx},${cy * FOG_SIDE + sy}`);
      }
    }
  }
  return out;
}

const W = 40;
const H = 36;

describe('fog rasterisers vs point-by-point reference', () => {
  it('rect (centres inside [x, x+w) × [y, y+h)), clipped to the map', () => {
    expect(bitsOf(fogRasterizers.rect(2, 3, 5, 4, W, H))).toEqual(
      reference(W, H, (x, y) => x >= 2 && x < 7 && y >= 3 && y < 7),
    );
    expect(bitsOf(fogRasterizers.rect(30.3, 28.9, 20, 20, W, H))).toEqual(
      reference(W, H, (x, y) => x >= 30.3 && y >= 28.9),
    );
    expect(fogRasterizers.rect(1, 1, 0, 3, W, H).size).toBe(0);
  });

  it('disc', () => {
    const r = rng(3);
    for (let k = 0; k < 20; k++) {
      const x = r() * W;
      const y = r() * H;
      const rad = 0.2 + r() * 12;
      expect(bitsOf(fogRasterizers.disc(x, y, rad, W, H))).toEqual(
        reference(W, H, (px, py) => (px - x) ** 2 + (py - y) ** 2 <= rad * rad),
      );
    }
  });

  it('polygon (random, possibly self-intersecting: even-odd rule)', () => {
    const r = rng(11);
    for (let k = 0; k < 20; k++) {
      const n = 3 + Math.floor(r() * 9);
      const pts: Point[] = Array.from({ length: n }, () => [r() * (W + 4) - 2, r() * (H + 4) - 2]);
      const flat = flatOf(pts);
      expect(bitsOf(fogRasterizers.polygon(pts, W, H))).toEqual(
        reference(W, H, (x, y) => inside(flat, x, y)),
      );
    }
  });

  it('visible: viewer polygon AND (lit OR darkvision OR darkness < 0.3)', () => {
    const r = rng(5);
    const objects = [
      wall(
        [
          [10, 5],
          [30, 5],
          [30, 25],
          [10, 25],
        ],
        true,
      ),
      wall([
        [20, 5],
        [20, 18],
      ]),
      door([10, 12], [10, 14], { state: 'open' }),
    ];
    const core = createVisionCore();
    core.setScene(scene(objects, W, H));
    for (let k = 0; k < 12; k++) {
      const viewers = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => {
        const x = 11 + r() * 18;
        const y = 6 + r() * 18;
        const p = core.compute('vision', [{ id: 'v', x, y, radius: 6 + r() * 20 }]).get('v')!;
        return { uid: `v${i}`, x, y, polygon: p, dark: r() < 0.5 ? 0 : r() * 6 };
      });
      const lights = Array.from({ length: Math.floor(r() * 4) }, () => {
        const x = r() * W;
        const y = r() * H;
        const dimRadius = 1 + r() * 10;
        const cone = r() < 0.3 ? { angle: 90, direction: r() * 360 } : null;
        const polygon = core
          .compute('light', [{ id: 'l', x, y, radius: dimRadius, cone }])
          .get('l')!;
        return { x, y, polygon, dimRadius };
      });
      const darkness = k % 3 === 0 ? 0.1 : 0.8;
      const vs: VisibleScene = { floor: 'f1', sceneRevision: 1, darkness, viewers, lights };
      const expected = reference(W, H, (x, y) =>
        viewers.some(
          (v) =>
            inside(v.polygon, x, y) &&
            (darkness < 0.3 ||
              (x - v.x) ** 2 + (y - v.y) ** 2 <= v.dark * v.dark ||
              lights.some(
                (l) =>
                  (x - l.x) ** 2 + (y - l.y) ** 2 <= l.dimRadius * l.dimRadius &&
                  inside(l.polygon, x, y),
              )),
        ),
      );
      expect(bitsOf(fogRasterizers.visible(vs, W, H))).toEqual(expected);
    }
  });

  it('spans crossing chunk borders land in both chunks', () => {
    const raster = fogRasterizers.rect(30, 30, 4, 4, 64, 64);
    expect([...raster.keys()].sort()).toEqual(['0:0', '0:1', '1:0', '1:1']);
    expect(bitsOf(raster).size).toBe(16 * 16);
  });

  it('round-trips through the fog codec', async () => {
    const raster = fogRasterizers.disc(16.3, 12.7, 9.4, 64, 64);
    for (const [, bits] of raster) {
      const packed = await encodeFog(bits, { forceJs: true });
      expect(packed).not.toBeNull();
      expect(await decodeFog(packed!, { forceJs: true })).toEqual(bits);
    }
  });
});

describe('room fill (bounded by the vision occluders)', () => {
  const objects = [
    wall(
      [
        [4, 4],
        [10, 4],
        [10, 9],
        [4, 9],
      ],
      true,
    ),
  ];

  function roomOf(core: VisionCore, x: number, y: number, max = 100) {
    return fogRasterizers.room(core, x, y, W, H, max);
  }

  it('fills exactly the inside of a closed room', () => {
    const core = createVisionCore();
    core.setScene(scene(objects, W, H));
    const raster = roomOf(core, 6.2, 6.7)!;
    expect(bitsOf(raster)).toEqual(reference(W, H, (x, y) => x > 4 && x < 10 && y > 4 && y < 9));
  });

  it('returns null when the area is larger than maxCells (open room)', () => {
    const core = createVisionCore();
    core.setScene(scene([...objects, door([6, 4], [8, 4], { state: 'open' })], W, H));
    expect(roomOf(core, 6.2, 6.7)).toBeNull();
    // Large enough limit: the whole map minus the walls' blocked parts.
    expect(roomOf(core, 6.2, 6.7, W * H)).not.toBeNull();
    // A closed door closes the room again.
    const closed = createVisionCore();
    closed.setScene(scene([...objects, door([6, 4], [8, 4])], W, H));
    expect(bitsOf(roomOf(closed, 6.2, 6.7)!).size).toBe(6 * 5 * 16);
  });

  it('works with any VisionCore (firstHit fallback) and refuses points outside', () => {
    const core = createVisionCore();
    core.setScene(scene(objects, W, H));
    const generic: VisionCore = {
      setScene: (s) => core.setScene(s),
      compute: (k, s) => core.compute(k, s),
      segments: (m) => core.segments(m),
      firstHit: (m, p, q) => core.firstHit(m, p, q),
    };
    expect(bitsOf(roomOf(generic, 6.2, 6.7)!)).toEqual(bitsOf(roomOf(core, 6.2, 6.7)!));
    expect(roomOf(core, -1, 3)).toBeNull();
  });

  it('only returns chunks with bits set', () => {
    const core = createVisionCore();
    core.setScene(scene(objects, W, H));
    const keys: ChunkKey[] = [...roomOf(core, 6.2, 6.7)!.keys()];
    expect(keys).toEqual(['0:0']);
  });
});
